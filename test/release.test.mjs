import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';

const cli = resolve('scripts/release.mjs');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'zcode-release-test-'));
  assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'upstream');
  await mkdir(source);
  execFileSync('git', ['-c', 'core.autocrlf=false', 'init', '-q', source]);
  execFileSync('git', ['-C', source, 'config', 'core.autocrlf', 'false']);
  await writeFile(join(source, 'package.json'), JSON.stringify({ version: '3.16.2', packageManager: 'pnpm@10.33.2' }));
  await writeFile(join(source, 'mise.toml'), '[tools]\nnode = "24.14.0"\npnpm = "10.33.2"\n');
  execFileSync('git', ['-C', source, 'add', '.']);
  execFileSync('git', ['-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  const sha = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return { root, source, sha, artifacts: join(root, 'artifacts') };
}
function run(root, ...args) {
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env });
}
async function installer(source, name, content = 'installer payload') {
  const dist = join(source, 'packages', 'desktop', 'dist');
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, name), content);
}

test('plan pins the full source SHA, tool versions, and a unique snapshot tag', async (t) => {
  const { root, source, sha } = await fixture(t);
  const result = run(root, 'plan', source);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(await readFile(join(root, 'release-plan.json'), 'utf8'));
  assert.equal(plan.sha, sha);
  assert.equal(plan.node, '24.14.0');
  assert.equal(plan.pnpm, '10.33.2');
  assert.equal(plan.version, '3.16.2');
  assert.equal(plan.tag, `v3.16.2-upstream.${sha.slice(0, 12)}`);
});

test('plan rejects tool-version disagreement instead of silently changing the lockfile', async (t) => {
  const { root, source } = await fixture(t);
  await writeFile(join(source, 'mise.toml'), '[tools]\nnode = "24.14.0"\npnpm = "9.0.0"\n');
  const result = run(root, 'plan', source);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pnpm.*mismatch/i);
});

test('plan rejects metadata containing workflow-output injection', async (t) => {
  const { root, source } = await fixture(t);
  await writeFile(join(source, 'package.json'), JSON.stringify({ version: '3.16.2\ninjected=true', packageManager: 'pnpm@10.33.2' }));
  const result = run(root, 'plan', source);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid.*version/i);
});

test('collect copies only the requested platform installers, not updater metadata', async (t) => {
  const { root, source, artifacts } = await fixture(t);
  await installer(source, 'ZCode-3.16.2-win-x64.exe');
  await installer(source, 'ZCode-3.16.2-win-arm64.exe');
  await installer(source, 'latest.yml');
  await installer(source, 'ZCode-3.16.2-win-x64.exe.blockmap');
  const result = run(root, 'collect', source, artifacts, 'win', 'x64');
  assert.equal(result.status, 0, result.stderr);
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(artifacts), ['ZCode-3.16.2-win-x64.exe']);
});

test('collect fails when any required macOS installer is missing', async (t) => {
  const { root, source, artifacts } = await fixture(t);
  await installer(source, 'ZCode-3.16.2-mac-arm64.dmg');
  const result = run(root, 'collect', source, artifacts, 'mac', 'arm64');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing.*zip/i);
});

test('collect rejects empty installers', async (t) => {
  const { root, source, artifacts } = await fixture(t);
  await installer(source, 'ZCode-3.16.2-win-x64.exe', '');
  const result = run(root, 'collect', source, artifacts, 'win', 'x64');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /empty/i);
});

test('harden disables implicit Electron publishing without bypassing wrapper audits', async (t) => {
  const { root, source } = await fixture(t);
  const dir = join(source, 'packages', 'desktop', 'scripts');
  await mkdir(dir, { recursive: true });
  const script = join(dir, 'bundle.mjs');
  await writeFile(script, 'const buildArgs = [\n    "exec",\n    "electron-builder",\n    "--config",\n    "electron-builder.config.js",\n    osBuilderFlagMap[os],\n    archBuilderFlagMap[arch],\n  ];\nconsole.log(buildArgs);\n');
  const result = run(root, 'harden', source);
  assert.equal(result.status, 0, result.stderr);
  const patched = (await readFile(script, 'utf8'))
    .replace('osBuilderFlagMap[os]', '"--win"').replace('archBuilderFlagMap[arch]', '"--x64"');
  const executable = join(root, 'patched.mjs');
  await writeFile(executable, patched.replace('console.log(buildArgs)', 'console.log(JSON.stringify(buildArgs))'));
  const actual = spawnSync(process.execPath, [executable], { encoding: 'utf8' });
  assert.equal(actual.status, 0, actual.stderr);
  assert.deepEqual(JSON.parse(actual.stdout), ['exec', 'electron-builder', '--publish', 'never', '--config', 'electron-builder.config.js', '--win', '--x64']);
  assert.equal(run(root, 'harden', source).status, 0, 'Patch must be idempotent');
});

test('harden fails closed when upstream changes the build invocation', async (t) => {
  const { root, source } = await fixture(t);
  const dir = join(source, 'packages', 'desktop', 'scripts');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'bundle.mjs'), 'const buildArgs = ["new-builder"];');
  const result = run(root, 'harden', source);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /upstream.*changed/i);
});

const assetNames = [
  'ZCode-3.16.2-win-x64.exe',
  'ZCode-3.16.2-mac-arm64.dmg', 'ZCode-3.16.2-mac-arm64.zip',
  'ZCode-3.16.2-mac-x64.dmg', 'ZCode-3.16.2-mac-x64.zip',
  'ZCode-3.16.2-linux-x64.AppImage', 'ZCode-3.16.2-linux-x64.deb',
  'ZCode-3.16.2-linux-x64.rpm', 'ZCode-3.16.2-linux-x64.pkg.tar.zst',
];
test('finalize rejects a partial build matrix', async (t) => {
  const { root, source, artifacts } = await fixture(t);
  assert.equal(run(root, 'plan', source).status, 0);
  await mkdir(artifacts);
  await writeFile(join(artifacts, assetNames[0]), 'windows only');
  const result = run(root, 'finalize', artifacts, join(root, 'release-plan.json'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing/i);
});

test('finalize writes verifiable checksums, complete provenance, and honest release notes', async (t) => {
  const { root, source, sha, artifacts } = await fixture(t);
  assert.equal(run(root, 'plan', source).status, 0);
  await mkdir(artifacts);
  for (const name of assetNames) await writeFile(join(artifacts, name), `payload:${name}`);
  await writeFile(join(artifacts, 'LICENSE.txt'), 'Apache-2.0');
  const result = run(root, 'finalize', artifacts, join(root, 'release-plan.json'));
  assert.equal(result.status, 0, result.stderr);
  const sums = await readFile(join(artifacts, 'SHA256SUMS.txt'), 'utf8');
  for (const name of [...assetNames, 'LICENSE.txt', 'build-provenance.json']) {
    const bytes = await readFile(join(artifacts, name));
    assert.ok(sums.includes(`${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`));
  }
  const provenance = JSON.parse(await readFile(join(artifacts, 'build-provenance.json'), 'utf8'));
  assert.equal(provenance.upstream.sha, sha);
  assert.equal(provenance.signed, false);
  assert.equal(provenance.installers.length, 9);
  const notes = await readFile(join(root, 'release-notes.md'), 'utf8');
  assert.match(notes, /unofficial/i);
  assert.match(notes, /unsigned/i);
  assert.match(notes, new RegExp(sha));
  assert.match(notes, /Computer Use/i);
});
