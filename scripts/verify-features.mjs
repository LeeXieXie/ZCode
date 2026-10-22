import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';

const plugins = ['android-emulator', 'documents', 'image-search', 'ios-simulator', 'pdf',
  'plugin-creator', 'presentations', 'restore-legacy-sessions', 'skill-creator',
  'spreadsheets', 'visualize', 'zcode-guide', 'computer-use', 'browser-use', 'node-repl-host'];
const packageFolder = (name) => name === 'computer-use' ? 'zcode-cua-plugin'
  : name === 'node-repl-host' ? name : `${name}-plugin`;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const officeFiles = ['dist/server.mjs', 'dist/ui/assets.json', 'dist/ui/panel.html'];
const runtimeFiles = {
  documents: [...officeFiles, 'skills/docx/SKILL.md', 'skills/docx-viewer/SKILL.md'],
  pdf: [...officeFiles, 'skills/pdf/SKILL.md', 'skills/pdf-viewer/SKILL.md'],
  presentations: [...officeFiles, 'skills/pptx/SKILL.md', 'skills/pptx-viewer/SKILL.md'],
  spreadsheets: [...officeFiles, 'skills/xlsx/SKILL.md', 'skills/xlsx-viewer/SKILL.md'],
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
    'skills/visualize/assets/vendor/manifest.json'],
};

async function requireFile(root, path) {
  const absolute = resolve(root, path);
  const inside = relative(root, absolute);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || resolve(root, inside) !== absolute) {
    throw new Error(`Unsafe feature path: ${path}`);
  }
  for (const segment of inside.split(sep).slice(0, -1)) {
    root = join(root, segment);
    if (!(await lstat(root)).isDirectory()) throw new Error(`Invalid feature directory: ${root}`);
  }
  let info;
  try {
    info = await lstat(absolute);
  } catch (error) {
    error.message = `Required feature file ${path}: ${error.message}`;
    throw error;
  }
  if (!info.isFile() || info.size === 0) throw new Error(`Missing, empty, or non-regular feature file: ${absolute}`);
  return absolute;
}

async function jsonFile(root, path) {
  return JSON.parse(await readFile(await requireFile(root, path), 'utf8'));
}

function identity(metadata, expectedName, label) {
  if (metadata?.name !== expectedName || typeof metadata?.version !== 'string'
    || !versionPattern.test(metadata.version)) {
    throw new Error(`Invalid feature name/version: ${label}`);
  }
}

async function verify(source, os, arch) {
  if (![['win', 'x64'], ['linux', 'x64'], ['mac', 'x64'], ['mac', 'arm64']]
    .some(([targetOs, targetArch]) => os === targetOs && arch === targetArch)) {
    throw new Error(`Unsupported target: ${os}/${arch}`);
  }
  source = resolve(source);
  const sha = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Invalid source SHA');
  const { version } = await jsonFile(source, 'package.json');
  if (typeof version !== 'string' || !versionPattern.test(version)) throw new Error('Invalid source version');
  const sourcePackages = join(source, 'apps/zcode-cli/packages');
  const resources = os === 'mac' ? `${arch === 'arm64' ? 'mac-arm64' : 'mac'}/ZCode.app/Contents/Resources`
    : `${os === 'win' ? 'win' : 'linux'}-unpacked/resources`;
  const packaged = join(source, 'packages/desktop/dist', resources, 'glm/packages');
  const features = [];
  for (const name of plugins) {
    const folder = packageFolder(name);
    const packagePath = `${folder}/package.json`;
    const sourcePackage = await jsonFile(sourcePackages, packagePath);
    const actualPackage = await jsonFile(packaged, packagePath);
    identity(sourcePackage, `@zcode/${folder}`, packagePath);
    identity(actualPackage, sourcePackage.name, packagePath);
    if (sourcePackage.version !== actualPackage.version) throw new Error(`Package version mismatch: ${packagePath}`);
    const files = [packagePath];
    const manifestPath = `${folder}/.zcode-plugin/plugin.json`;
    let sourceManifest;
    try {
      sourceManifest = await jsonFile(sourcePackages, manifestPath);
    } catch (error) {
      if (name !== 'node-repl-host' || error.code !== 'ENOENT') throw error;
    }
    if (sourceManifest !== undefined) {
      const actualManifest = await jsonFile(packaged, manifestPath);
      identity(sourceManifest, name, manifestPath);
      identity(actualManifest, sourceManifest.name, manifestPath);
      if (sourceManifest.version !== actualManifest.version) throw new Error(`Plugin version mismatch: ${manifestPath}`);
      if (!isDeepStrictEqual(sourceManifest.mcpServers, actualManifest.mcpServers)) {
        throw new Error(`Plugin MCP configuration mismatch: ${manifestPath}`);
      }
      files.push(manifestPath);
    }
    for (const path of runtimeFiles[name] ?? []) {
      await requireFile(packaged, `${folder}/${path}`);
      files.push(`${folder}/${path}`);
    }
    if (name === 'image-search') {
      const path = `${folder}/.mcp.json`;
      const expected = await jsonFile(sourcePackages, path);
      const actual = await jsonFile(packaged, path);
      if (!expected?.mcpServers || typeof expected.mcpServers !== 'object'
        || Array.isArray(expected.mcpServers) || Object.keys(expected.mcpServers).length === 0
        || !isDeepStrictEqual(expected, actual)
        || !isDeepStrictEqual(expected.mcpServers, sourceManifest?.mcpServers)) {
        throw new Error(`Image-search MCP configuration mismatch: ${path}`);
      }
    }
    if (name === 'visualize') {
      const vendor = `${folder}/skills/visualize/assets/vendor`;
      const manifest = await jsonFile(sourcePackages, `${vendor}/manifest.json`);
      if (!Array.isArray(manifest.resources) || manifest.resources.length === 0) {
        throw new Error('Missing visualize vendor licenses');
      }
      const actualManifest = await jsonFile(packaged, `${vendor}/manifest.json`);
      if (!isDeepStrictEqual(manifest.resources, actualManifest?.resources)) {
        throw new Error(`Visualize vendor manifest records mismatch: ${vendor}/manifest.json`);
      }
      for (const entry of manifest.resources) {
        for (const [fileKey, hashKey] of [['file', 'sha256'], ['licenseFile', 'licenseSha256']]) {
          const filename = entry?.[fileKey];
          const expectedHash = entry?.[hashKey];
          if (typeof filename !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(filename)
            || typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) {
            throw new Error(`Invalid visualize vendor ${fileKey}/${hashKey}`);
          }
          const path = `${vendor}/${filename}`;
          const bytes = await readFile(await requireFile(packaged, path));
          if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) {
            throw new Error(`Visualize vendor integrity mismatch: ${path}`);
          }
          files.push(path);
        }
      }
    }
    features.push({ name, version: sourceManifest?.version ?? sourcePackage.version,
      packageVersion: sourcePackage.version, files });
  }
  const report = {
    source: { sha, version }, os, arch, features,
    computerUse: { available: false,
      reason: 'Public upstream runtime is a placeholder; ZcodePro native runtime licensing and trust-chain compatibility are unresolved.' },
  };
  await mkdir('artifacts', { recursive: true });
  const output = join('artifacts', `feature-report-${os}-${arch}.json`);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Verified ${features.length} packaged features: ${output}`);
}

try {
  const [source, os, arch, ...extra] = process.argv.slice(2);
  if (!source || !os || !arch || extra.length) throw new Error('Usage: verify-features.mjs SOURCE OS ARCH');
  await verify(source, os, arch);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
