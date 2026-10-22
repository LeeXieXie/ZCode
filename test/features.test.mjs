import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';

const cli = resolve('scripts/verify-features.mjs');
const plugins = ['android-emulator', 'documents', 'image-search', 'ios-simulator', 'pdf',
  'plugin-creator', 'presentations', 'restore-legacy-sessions', 'skill-creator',
  'spreadsheets', 'visualize', 'zcode-guide', 'computer-use', 'browser-use', 'node-repl-host'];
const folder = (name) => name === 'computer-use' ? 'zcode-cua-plugin'
  : name === 'node-repl-host' ? name : `${name}-plugin`;
const extras = {
  documents: ['dist/server.mjs', 'dist/ui/assets.json', 'dist/ui/panel.html', 'skills/docx/SKILL.md', 'skills/docx-viewer/SKILL.md'],
  pdf: ['dist/server.mjs', 'dist/ui/assets.json', 'dist/ui/panel.html', 'skills/pdf/SKILL.md', 'skills/pdf-viewer/SKILL.md'],
  presentations: ['dist/server.mjs', 'dist/ui/assets.json', 'dist/ui/panel.html', 'skills/pptx/SKILL.md', 'skills/pptx-viewer/SKILL.md'],
  spreadsheets: ['dist/server.mjs', 'dist/ui/assets.json', 'dist/ui/panel.html', 'skills/xlsx/SKILL.md', 'skills/xlsx-viewer/SKILL.md'],
  'android-emulator': ['dist/mcp/server.js', 'skills/android-dev/SKILL.md'],
  'ios-simulator': ['dist/mcp/server.js', 'skills/ios-dev/SKILL.md'],
  'skill-creator': ['skills/skill-creator/SKILL.md'],
  'zcode-guide': ['zcode-configuration-guide', 'diagnosing-skills', 'diagnosing-plugins',
    'diagnosing-commands', 'diagnosing-hooks', 'diagnosing-mcp'].map((name) => `skills/${name}/SKILL.md`),
  'restore-legacy-sessions': ['skills/restore-legacy-sessions/SKILL.md',
    'skills/restore-legacy-sessions/scripts/scan-legacy-sessions.mjs',
    'skills/restore-legacy-sessions/scripts/restore-conversation.mjs', 'commands/restore-legacy-sessions.md'],
  'plugin-creator': ['SKILL.md', 'references/plugin-json-spec.md', 'references/installing-and-updating.md',
    ...['create-basic-plugin', 'scaffold-files', 'marketplace-files', 'validate-plugin', 'upsert-dev-marketplace']
      .map((name) => `scripts/${name}.mjs`)].map((path) => `skills/plugin-creator/${path}`),
  'node-repl-host': ['dist/mcp/server.js'], 'image-search': ['.mcp.json'],
  'computer-use': ['skills/computer-use/SKILL.md', 'scripts/computer-use-client.mjs', 'docs/computer-use.md'],
  'browser-use': ['skills/control-browser/SKILL.md', 'scripts/browser-client.mjs', 'docs/overview.md', 'docs/api.json'],
  visualize: ['skills/visualize/SKILL.md', 'skills/visualize/scripts/render.py',
    'skills/visualize/assets/vendor/manifest.json', 'skills/visualize/assets/vendor/chart.js.LICENSE',
    'skills/visualize/assets/vendor/chart.js'],
};
const mcpServers = { image_search: { type: 'http', url: '${ZCODE_BASE_URL}/api/v1/mcp/server/image_search',
  auth: { type: 'zcode_official', provider: 'jwt_token' }, timeoutMs: 90000 } };
const payloadHash = createHash('sha256').update('fixture payload').digest('hex');
async function put(root, name, content = 'fixture payload') {
  const path = join(root, name);
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, content);
}
async function fixture(t, os = 'win', arch = 'x64') {
  const root = await mkdtemp(join(tmpdir(), 'zcode-features-'));
  assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'upstream');
  await mkdir(source);
  await put(source, 'package.json', JSON.stringify({ version: '3.16.2' }));
  execFileSync('git', ['init', '-q', source]);
  execFileSync('git', ['-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    'commit', '--allow-empty', '-qm', 'fixture']);
  const sha = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const resources = os === 'mac' ? `${arch === 'arm64' ? 'mac-arm64' : 'mac'}/ZCode.app/Contents/Resources`
    : `${os === 'win' ? 'win' : 'linux'}-unpacked/resources`;
  const packaged = join(source, 'packages/desktop/dist', resources, 'glm/packages');
  for (const name of plugins) {
    const dir = folder(name);
    for (const base of [join(source, 'apps/zcode-cli/packages'), packaged]) {
      await put(base, `${dir}/package.json`, JSON.stringify({ name: `@zcode/${dir}`, version: '0.6.1' }));
      await put(base, `${dir}/.zcode-plugin/plugin.json`, JSON.stringify({ name, version: '0.6.1',
        ...(name === 'image-search' ? { mcpServers } : {}) }));
      for (const path of extras[name] ?? []) {
        const contents = path.endsWith('vendor/manifest.json')
          ? JSON.stringify({ resources: [{ file: 'chart.js', licenseFile: 'chart.js.LICENSE',
            sha256: payloadHash, licenseSha256: payloadHash }] })
          : path === '.mcp.json' ? JSON.stringify({ mcpServers }) : 'fixture payload';
        await put(base, `${dir}/${path}`, contents);
      }
    }
  }
  return { root, source, packaged, sha };
}
function run(context, os = 'win', arch = 'x64') {
  return spawnSync(process.execPath, [cli, context.source, os, arch], { cwd: context.root, encoding: 'utf8' });
}
for (const [os, arch] of [['win', 'x64'], ['linux', 'x64'], ['mac', 'x64'], ['mac', 'arm64']]) {
  test(`verifies packaged features on ${os}/${arch} without executing plugin code`, async (t) => {
    const context = await fixture(t, os, arch);
    const result = run(context, os, arch);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(join(context.root, `artifacts/feature-report-${os}-${arch}.json`), 'utf8'));
    assert.equal(report.source.sha, context.sha);
    assert.equal(report.source.version, '3.16.2');
    assert.equal(report.os, os);
    assert.equal(report.arch, arch);
    assert.deepEqual(report.features.map((feature) => feature.name).sort(), [...plugins].sort());
    assert.ok(report.features.every((feature) => feature.version === '0.6.1' && feature.files.length > 0));
    assert.equal(report.computerUse.available, false);
    assert.match(report.computerUse.reason, /placeholder.*licensing.*trust-chain/i);
  });
}
for (const [name, paths] of Object.entries(extras)) {
  for (const path of paths) {
    test(`rejects missing ${name}/${path}`, async (t) => {
      const context = await fixture(t);
      await rm(join(context.packaged, folder(name), path));
      const result = run(context);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(path), result.stderr);
      await assert.rejects(readFile(join(context.root, 'artifacts/feature-report-win-x64.json')), { code: 'ENOENT' });
    });
  }
}
for (const kind of ['empty', 'directory', 'mismatch-name', 'mismatch-version', 'invalid-json']) {
  test(`rejects ${kind} packaged plugin manifest`, async (t) => {
    const context = await fixture(t);
    const path = join(context.packaged, 'documents-plugin/.zcode-plugin/plugin.json');
    await rm(path);
    if (kind === 'directory') await mkdir(path);
    else await writeFile(path, kind === 'empty' ? '' : kind === 'invalid-json' ? 'not json'
      : JSON.stringify({ name: kind === 'mismatch-name' ? 'wrong' : 'documents', version: kind === 'mismatch-version' ? '0.1.0' : '0.6.1' }));
    assert.notEqual(run(context).status, 0);
  });
}
test('rejects mismatched node-repl-host package metadata', async (t) => {
  const context = await fixture(t);
  await put(context.packaged, 'node-repl-host/package.json', JSON.stringify({ name: '@zcode/node-repl-host', version: '0.1.0' }));
  assert.notEqual(run(context).status, 0);
});
for (const kind of ['empty', 'directory']) {
  test(`rejects ${kind} office runtime file`, async (t) => {
    const context = await fixture(t);
    const path = join(context.packaged, 'pdf-plugin/dist/server.mjs');
    await rm(path);
    if (kind === 'directory') await mkdir(path);
    else await writeFile(path, '');
    const result = run(context);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-regular feature file/);
  });
}
test('rejects a missing required plugin manifest even when package metadata exists', async (t) => {
  const context = await fixture(t);
  await rm(join(context.packaged, 'zcode-guide-plugin/.zcode-plugin/plugin.json'));
  assert.notEqual(run(context).status, 0);
});
test('supports node-repl-host without a source plugin manifest', async (t) => {
  const context = await fixture(t);
  await rm(join(context.source, 'apps/zcode-cli/packages/node-repl-host/.zcode-plugin/plugin.json'));
  await rm(join(context.packaged, 'node-repl-host/.zcode-plugin/plugin.json'));
  const result = run(context);
  assert.equal(result.status, 0, result.stderr);
});
test('rejects unsupported target arguments', async (t) => {
  const context = await fixture(t);
  assert.notEqual(run(context, 'win', 'arm64').status, 0);
});
test('rejects a null source manifest instead of treating it as absent', async (t) => {
  const context = await fixture(t);
  await put(join(context.source, 'apps/zcode-cli/packages'), 'documents-plugin/.zcode-plugin/plugin.json', 'null');
  assert.notEqual(run(context).status, 0);
});
for (const kind of ['bad-js-hash', 'bad-license-hash', 'packaged-manifest', 'file-traversal', 'license-traversal']) {
  test(`rejects visualize vendor ${kind}`, async (t) => {
    const context = await fixture(t);
    const vendor = 'visualize-plugin/skills/visualize/assets/vendor/';
    if (kind === 'bad-js-hash') await put(context.packaged, `${vendor}chart.js`, 'tampered');
    else if (kind === 'bad-license-hash') await put(context.packaged, `${vendor}chart.js.LICENSE`, 'tampered');
    else {
      const sourcePackages = join(context.source, 'apps/zcode-cli/packages');
      const manifest = JSON.parse(await readFile(join(sourcePackages, vendor, 'manifest.json'), 'utf8'));
      if (kind === 'packaged-manifest') manifest.resources[0].sha256 = '0'.repeat(64);
      if (kind === 'file-traversal') manifest.resources[0].file = '../chart.js';
      if (kind === 'license-traversal') manifest.resources[0].licenseFile = '../chart.js.LICENSE';
      if (kind !== 'packaged-manifest') await put(sourcePackages, `${vendor}manifest.json`, JSON.stringify(manifest));
      await put(context.packaged, `${vendor}manifest.json`, JSON.stringify(manifest));
    }
    assert.notEqual(run(context).status, 0);
  });
}
for (const kind of ['invalid-json', 'wrong-structure', 'manifest-mcp']) {
  test(`rejects image-search ${kind}`, async (t) => {
    const context = await fixture(t);
    if (kind === 'manifest-mcp') {
      await put(context.packaged, 'image-search-plugin/.zcode-plugin/plugin.json',
        JSON.stringify({ name: 'image-search', version: '0.6.1', mcpServers: {} }));
    } else await put(context.packaged, 'image-search-plugin/.mcp.json', kind === 'invalid-json' ? '{invalid' : '{}');
    assert.notEqual(run(context).status, 0);
  });
}
