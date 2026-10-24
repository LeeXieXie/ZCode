import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
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
  const scripts = join(source, 'packages/desktop/scripts');
  await mkdir(scripts, { recursive: true });
  await writeFile(join(scripts, 'bundle.mjs'), 'const buildArgs = [\n    "exec",\n    "electron-builder",\n];\n');
  await writeFile(join(scripts, 'packaged-sourcemap-cleanup.mjs'), `
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
function walkFiles(rootDir, visitor) {
  if (!existsSync(rootDir)) {
    return;
  }
  for (const entry of readdirSync(rootDir)) {
    const entryPath = resolve(rootDir, entry);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      walkFiles(entryPath, visitor);
      continue;
    }
    if (stat.isFile()) {
      visitor(entryPath);
    }
  }
}
export function stripSourceMappingUrlCommentsInDirectory(rootDir) {
  walkFiles(rootDir, (path) => {
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\\n\\/\\/[#@] sourceMappingURL=[^\\r\\n]*/g, ''));
  });
}
`);
  execFileSync('git', ['-C', source, 'add', '.']);
  execFileSync('git', ['-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  const sha = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return { root, source, sha, artifacts: join(root, 'artifacts') };
}
function run(root, ...args) {
  return runWithEnv(root, {}, ...args);
}
function runWithEnv(root, overrides, ...args) {
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...env, ...overrides } });
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
  const { root, source, sha, artifacts } = await fixture(t);
  await installer(source, 'ZCode-3.16.2-win-x64.exe');
  await installer(source, 'ZCode-3.16.2-win-arm64.exe');
  await installer(source, 'latest.yml');
  await installer(source, 'ZCode-3.16.2-win-x64.exe.blockmap');
  const output = join(root, 'github-output');
  const result = runWithEnv(root, { GITHUB_OUTPUT: output }, 'collect', source, artifacts, 'win', 'x64');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readdir(artifacts)).sort(), ['ZCode-3.16.2-win-x64.exe', 'receipt-win-x64.json']);
  const receipt = JSON.parse(await readFile(join(artifacts, 'receipt-win-x64.json'), 'utf8'));
  assert.equal(receipt.sha, sha);
  assert.equal(receipt.version, '3.16.2');
  assert.equal(receipt.node, '24.14.0');
  assert.equal(receipt.pnpm, '10.33.2');
  assert.equal(receipt.sourceRepository, 'zai-org/ZCode');
  assert.equal(receipt.os, 'win');
  assert.equal(receipt.arch, 'x64');
  assert.deepEqual(receipt.installers, [{
    name: 'ZCode-3.16.2-win-x64.exe',
    size: Buffer.byteLength('installer payload'),
    sha256: createHash('sha256').update('installer payload').digest('hex'),
  }]);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
  await assert.rejects(readFile(join(root, 'release-plan.json')), { code: 'ENOENT' });
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

test('collect preserves native Linux package architecture aliases', async (t) => {
  const { root, source, artifacts } = await fixture(t);
  const names = ['ZCode-3.16.2-linux-x86_64.AppImage', 'ZCode-3.16.2-linux-amd64.deb',
    'ZCode-3.16.2-linux-x86_64.rpm', 'ZCode-3.16.2-linux-x64.pkg.tar.zst'];
  for (const name of names) await installer(source, name);
  const result = run(root, 'collect', source, artifacts, 'linux', 'x64');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readdir(artifacts)).sort(), [...names, 'receipt-linux-x64.json'].sort());
  const receipt = JSON.parse(await readFile(join(artifacts, 'receipt-linux-x64.json'), 'utf8'));
  assert.deepEqual(receipt.installers.map(({ name }) => name).sort(), names.sort());
  assert.equal(receipt.arch, 'x64');
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
  const firstPass = await readFile(script);
  assert.equal(run(root, 'harden', source).status, 0, 'Patch must be idempotent');
  assert.deepEqual(await readFile(script), firstPass, 'Repeated hardening must preserve bundle bytes');
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

test('harden preserves vendor hashes while retaining ordinary sourcemap cleanup', async (t) => {
  const { root, source } = await fixture(t);
  const cleanup = join(source, 'packages/desktop/scripts/packaged-sourcemap-cleanup.mjs');
  const resources = join(root, 'resources');
  const vendor = join(resources, 'glm/packages/visualize-plugin/skills/visualize/assets/vendor');
  await mkdir(vendor, { recursive: true });
  const original = 'console.log("vendor");\n//# sourceMappingURL=lucide.js.map\n';
  const vendorPath = join(vendor, 'lucide.js');
  await writeFile(vendorPath, original);
  await writeFile(join(vendor, 'lucide.js.LICENSE'), original);
  await writeFile(join(resources, 'ordinary.js'), original);
  const runner = join(root, 'cleanup-runner.mjs');
  await writeFile(runner, `import { stripSourceMappingUrlCommentsInDirectory } from ${JSON.stringify(new URL(`file:///${cleanup.replaceAll('\\', '/')}`).href)};\nstripSourceMappingUrlCommentsInDirectory(${JSON.stringify(resources)});`);
  const hardened = run(root, 'harden', source);
  assert.equal(hardened.status, 0, hardened.stderr);
  const result = spawnSync(process.execPath, [runner], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(createHash('sha256').update(await readFile(vendorPath)).digest('hex'),
    createHash('sha256').update(original).digest('hex'));
  assert.equal(await readFile(join(vendor, 'lucide.js.LICENSE'), 'utf8'), original);
  assert.doesNotMatch(await readFile(join(resources, 'ordinary.js'), 'utf8'), /sourceMappingURL/);
  assert.equal(run(root, 'harden', source).status, 0);
});

test('harden fails closed on an unrecognized sourcemap walker', async (t) => {
  const { root, source } = await fixture(t);
  await writeFile(join(source, 'packages/desktop/scripts/packaged-sourcemap-cleanup.mjs'), 'export function changedWalker() {}');
  const result = run(root, 'harden', source);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sourcemap.*changed/i);
});

const assetNames = [
  'ZCode-3.16.2-win-x64.exe',
  'ZCode-3.16.2-mac-arm64.dmg', 'ZCode-3.16.2-mac-arm64.zip',
  'ZCode-3.16.2-mac-x64.dmg', 'ZCode-3.16.2-mac-x64.zip',
  'ZCode-3.16.2-linux-x86_64.AppImage', 'ZCode-3.16.2-linux-amd64.deb',
  'ZCode-3.16.2-linux-x86_64.rpm', 'ZCode-3.16.2-linux-x64.pkg.tar.zst',
];
const noticeNames = ['LICENSE.txt', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md', 'UPSTREAM-LICENSE-REVIEW.md'];
const receiptTargets = [['win', 'x64'], ['mac', 'arm64'], ['mac', 'x64'], ['linux', 'x64']];
const receiptNames = receiptTargets.map(([os, arch]) => `receipt-${os}-${arch}.json`);
const featureNames = ['android-emulator', 'computer-use', 'documents', 'image-search', 'ios-simulator',
  'pdf', 'plugin-creator', 'presentations', 'restore-legacy-sessions', 'skill-creator',
  'spreadsheets', 'visualize', 'zcode-guide', 'browser-use', 'node-repl-host'];
const featureReportNames = receiptTargets.map(([os, arch]) => `feature-report-${os}-${arch}.json`);
async function featureReports(root, artifacts) {
  const plan = JSON.parse(await readFile(join(root, 'release-plan.json'), 'utf8'));
  for (const [os, arch] of receiptTargets) {
    await writeFile(join(artifacts, `feature-report-${os}-${arch}.json`), JSON.stringify({
      source: { sha: plan.sha, version: plan.version }, os, arch,
      features: featureNames.map((name) => ({ name, version: '0.6.1' })),
      computerUse: { available: false, reason: 'Public runtime placeholder' },
    }));
  }
}
async function completeFixture(t) {
  const context = await fixture(t);
  const { root, source, artifacts } = context;
  assert.equal(run(root, 'plan', source).status, 0);
  const plan = JSON.parse(await readFile(join(root, 'release-plan.json'), 'utf8'));
  await mkdir(artifacts);
  for (const name of assetNames) await writeFile(join(artifacts, name), `payload:${name}`);
  for (const name of noticeNames) await writeFile(join(artifacts, name), `notice:${name}`);
  for (const [os, arch] of receiptTargets) {
    const names = assetNames.filter((name) => os === 'linux'
      ? name.includes('-linux-') : name.includes(`-${os}-${arch}.`));
    const receipt = {
      sha: plan.sha, version: plan.version, node: plan.node, pnpm: plan.pnpm,
      sourceRepository: plan.sourceRepository, os, arch,
      installers: names.map((name) => ({
        name, size: Buffer.byteLength(`payload:${name}`),
        sha256: createHash('sha256').update(`payload:${name}`).digest('hex'),
      })),
    };
    await writeFile(join(artifacts, `receipt-${os}-${arch}.json`), JSON.stringify(receipt));
  }
  await featureReports(root, artifacts);
  return context;
}
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
  const { root, sha, artifacts } = await completeFixture(t);
  const result = run(root, 'finalize', artifacts, join(root, 'release-plan.json'));
  assert.equal(result.status, 0, result.stderr);
  const sums = await readFile(join(artifacts, 'SHA256SUMS.txt'), 'utf8');
  for (const name of [...assetNames, ...noticeNames, ...receiptNames, ...featureReportNames, 'build-provenance.json']) {
    const bytes = await readFile(join(artifacts, name));
    assert.ok(sums.includes(`${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`));
  }
  const provenance = JSON.parse(await readFile(join(artifacts, 'build-provenance.json'), 'utf8'));
  assert.equal(provenance.upstream.sha, sha);
  assert.equal(provenance.signed, false);
  assert.equal(provenance.installers.length, 9);
  assert.ok(provenance.buildPatches.some((patch) => /preserve.*visualize.*vendor/i.test(patch)));
  assert.deepEqual(provenance.featureReports.map(({ name }) => name).sort(), [...featureReportNames].sort());
  for (const record of provenance.featureReports) {
    const bytes = await readFile(join(artifacts, record.name));
    assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  const notes = await readFile(join(root, 'release-notes.md'), 'utf8');
  assert.match(notes, /unofficial/i);
  assert.match(notes, /unsigned/i);
  assert.match(notes, new RegExp(sha));
  assert.match(notes, /Computer Use/i);
  assert.match(notes, /15 packaged plugin assets verified, not end-to-end feature parity/);
  assert.match(notes, /docs\/zcodepro-assessment.md/);
});

for (const name of noticeNames) {
  for (const failure of ['missing', 'empty', 'directory']) {
    test(`finalize rejects ${failure} license material ${name}`, async (t) => {
      const { root, artifacts } = await completeFixture(t);
      const path = join(artifacts, name);
      await rm(path);
      if (failure === 'empty') await writeFile(path, '');
      if (failure === 'directory') await mkdir(path);
      const result = run(root, 'finalize', artifacts, join(root, 'release-plan.json'));
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(name), result.stderr);
      await assert.rejects(readFile(join(artifacts, 'build-provenance.json')), { code: 'ENOENT' });
    });
  }
}

test('finalize rejects a missing platform receipt', async (t) => {
  const { root, artifacts } = await completeFixture(t);
  await rm(join(artifacts, 'receipt-mac-arm64.json'));
  const result = run(root, 'finalize', artifacts, join(root, 'release-plan.json'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing.*receipt-mac-arm64/i);
});

for (const [field, value] of [
  ['sha', 'a'.repeat(40)], ['version', '9.9.9'], ['node', '24.15.0'],
  ['pnpm', '10.34.0'], ['os', 'linux'], ['arch', 'arm64'],
  ['sourceRepository', 'other/source'],
]) {
  test(`finalize rejects a platform receipt with mismatched ${field}`, async (t) => {
    const { root, artifacts } = await completeFixture(t);
    const path = join(artifacts, 'receipt-win-x64.json');
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    receipt[field] = value;
    await writeFile(path, JSON.stringify(receipt));
    const result = run(root, 'finalize', artifacts, join(root, 'release-plan.json'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`receipt.*${field}`, 'i'));
  });
}

for (const corruption of ['hash', 'size', 'missing-installer', 'unexpected-installer']) {
  test(`finalize rejects ${corruption} mismatch in a platform receipt`, async (t) => {
    const { root, artifacts } = await completeFixture(t);
    const path = join(artifacts, 'receipt-win-x64.json');
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    if (corruption === 'hash') receipt.installers[0].sha256 = '0'.repeat(64);
    if (corruption === 'size') receipt.installers[0].size += 1;
    if (corruption === 'missing-installer') receipt.installers = [];
    if (corruption === 'unexpected-installer') receipt.installers[0].name = '../untrusted.exe';
    await writeFile(path, JSON.stringify(receipt));
    const result = run(root, 'finalize', artifacts, join(root, 'release-plan.json'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /receipt.*installer/i);
  });
}

test('finalize detects installer bytes changed after collection', async (t) => {
  const { root, artifacts } = await completeFixture(t);
  await writeFile(join(artifacts, assetNames[0]), 'tampered installer');
  const result = run(root, 'finalize', artifacts, join(root, 'release-plan.json'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /receipt.*installer/i);
});

test('finalize rejects installers collected from a different actual source HEAD', async (t) => {
  const { root, source, artifacts } = await completeFixture(t);
  execFileSync('git', ['-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    'commit', '--allow-empty', '-qm', 'different source snapshot']);
  await installer(source, assetNames[0]);
  const collected = run(root, 'collect', source, artifacts, 'win', 'x64');
  assert.equal(collected.status, 0, collected.stderr);
  const result = run(root, 'finalize', artifacts, join(root, 'release-plan.json'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /receipt.*sha/i);
});

test('all four real collection receipts finalize successfully together', async (t) => {
  const { root, source, artifacts } = await fixture(t);
  assert.equal(run(root, 'plan', source).status, 0);
  for (const name of assetNames) await installer(source, name, `payload:${name}`);
  for (const [os, arch] of receiptTargets) {
    const result = run(root, 'collect', source, artifacts, os, arch);
    assert.equal(result.status, 0, result.stderr);
  }
  for (const name of noticeNames) await writeFile(join(artifacts, name), `notice:${name}`);
  await featureReports(root, artifacts);
  const result = run(root, 'finalize', artifacts, join(root, 'release-plan.json'));
  assert.equal(result.status, 0, result.stderr);
  const sums = await readFile(join(artifacts, 'SHA256SUMS.txt'), 'utf8');
  for (const name of receiptNames) assert.ok(sums.includes(`  ${name}\n`));
});

for (const repository of [undefined, 'example/custom-builder']) {
  test(`provenance uses ${repository ?? 'the canonical repository fallback'}`, async (t) => {
    const { root, artifacts } = await completeFixture(t);
    const expected = repository ?? 'LeeXieXie/ZCode';
    const result = runWithEnv(root, { GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: '12345' },
      'finalize', artifacts, join(root, 'release-plan.json'));
    assert.equal(result.status, 0, result.stderr);
    const provenance = JSON.parse(await readFile(join(artifacts, 'build-provenance.json'), 'utf8'));
    assert.equal(provenance.builder.repository, expected);
    assert.equal(provenance.builder.run, `https://github.com/${expected}/actions/runs/12345`);
    assert.equal(provenance.upstream.repository, 'zai-org/ZCode');
  });
}

test('provenance records the immutable builder separately from the workflow trigger', async (t) => {
  const { root, artifacts } = await completeFixture(t);
  const builder = 'b'.repeat(40);
  const trigger = 'c'.repeat(40);
  const result = runWithEnv(root, { BUILDER_SHA: builder, GITHUB_SHA: trigger },
    'finalize', artifacts, join(root, 'release-plan.json'));
  assert.equal(result.status, 0, result.stderr);
  const provenance = JSON.parse(await readFile(join(artifacts, 'build-provenance.json'), 'utf8'));
  assert.equal(provenance.builder.sha, builder);
  assert.equal(provenance.builder.triggerSha, trigger);
});

test('provenance falls back to the workflow trigger when builder SHA is unavailable', async (t) => {
  const { root, artifacts } = await completeFixture(t);
  const trigger = 'd'.repeat(40);
  const result = runWithEnv(root, { BUILDER_SHA: undefined, GITHUB_SHA: trigger },
    'finalize', artifacts, join(root, 'release-plan.json'));
  assert.equal(result.status, 0, result.stderr);
  const provenance = JSON.parse(await readFile(join(artifacts, 'build-provenance.json'), 'utf8'));
  assert.equal(provenance.builder.sha, trigger);
  assert.equal(provenance.builder.triggerSha, trigger);
});

for (const failure of ['missing', 'empty', 'directory', 'sha', 'source-version', 'os', 'arch',
  'missing-feature', 'duplicate-feature', 'unexpected-feature', 'invalid-version', 'computer-use']) {
  test(`finalize rejects ${failure} feature report`, async (t) => {
    const { root, artifacts } = await completeFixture(t);
    const path = join(artifacts, 'feature-report-win-x64.json');
    const report = JSON.parse(await readFile(path, 'utf8'));
    if (failure === 'missing') await rm(path);
    else if (failure === 'empty') await writeFile(path, '');
    else if (failure === 'directory') { await rm(path); await mkdir(path); }
    else {
      if (failure === 'sha') report.source.sha = 'f'.repeat(40);
      if (failure === 'source-version') report.source.version = '0.0.1';
      if (failure === 'os') report.os = 'mac';
      if (failure === 'arch') report.arch = 'arm64';
      if (failure === 'missing-feature') report.features.pop();
      if (failure === 'duplicate-feature') report.features[0] = report.features[1];
      if (failure === 'unexpected-feature') report.features[0].name = 'untrusted';
      if (failure === 'invalid-version') report.features[0].version = '';
      if (failure === 'computer-use') report.computerUse.available = true;
      await writeFile(path, JSON.stringify(report));
    }
    const result = run(root, 'finalize', artifacts, join(root, 'release-plan.json'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /feature-report/i);
    await assert.rejects(readFile(join(artifacts, 'build-provenance.json')), { code: 'ENOENT' });
  });
}
