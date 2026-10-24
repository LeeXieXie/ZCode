import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const upstreamRepository = 'zai-org/ZCode';
const targets = [
  ['win', 'x64', ['exe']],
  ['mac', 'arm64', ['dmg', 'zip']],
  ['mac', 'x64', ['dmg', 'zip']],
  ['linux', 'x64', ['AppImage', 'deb', 'rpm', 'pkg.tar.zst']],
];
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const pinPattern = /^\d+\.\d+\.\d+$/;
const noticeNames = ['LICENSE.txt', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md', 'UPSTREAM-LICENSE-REVIEW.md'];
const featureNames = ['android-emulator', 'computer-use', 'documents', 'image-search', 'ios-simulator',
  'pdf', 'plugin-creator', 'presentations', 'restore-legacy-sessions', 'skill-creator',
  'spreadsheets', 'visualize', 'zcode-guide', 'browser-use', 'node-repl-host'];

function validatePlan(plan) {
  if (!versionPattern.test(plan.version)) throw new Error('Invalid application version');
  if (!/^[0-9a-f]{40}$/.test(plan.sha)) throw new Error('Invalid full upstream commit SHA');
  if (!pinPattern.test(plan.node) || !pinPattern.test(plan.pnpm)) throw new Error('Invalid tool version pin');
  const expectedTag = `v${plan.version}-upstream.${plan.sha.slice(0, 12)}`;
  if (plan.tag !== expectedTag) throw new Error('Release tag does not match source snapshot');
}

async function readSourceMetadata(source) {
  const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  const mise = await readFile(join(source, 'mise.toml'), 'utf8');
  const tools = mise.match(/^\[tools\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] ?? '';
  const pin = (name) => tools.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"\\s*$`, 'm'))?.[1];
  const node = pin('node');
  const pnpm = pin('pnpm');
  if (pkg.packageManager !== `pnpm@${pnpm}`) throw new Error('pnpm version mismatch between package.json and mise.toml');
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  const sha = git('rev-parse', 'HEAD');
  const plan = {
    version: pkg.version,
    sha,
    node,
    pnpm,
    tag: `v${pkg.version}-upstream.${sha.slice(0, 12)}`,
    title: `ZCode ${pkg.version} Community (${sha.slice(0, 12)})`,
    sourceRepository: upstreamRepository,
    sourceDate: git('show', '-s', '--format=%cI', 'HEAD'),
  };
  validatePlan(plan);
  return plan;
}

async function planSource(source) {
  const plan = await readSourceMetadata(source);
  await writeFile('release-plan.json', `${JSON.stringify(plan, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) {
    const outputs = ['sha', 'version', 'node', 'pnpm', 'tag', 'title'].map((key) => `${key}=${plan[key]}\n`).join('');
    await appendFile(process.env.GITHUB_OUTPUT, outputs);
  }
  console.log(JSON.stringify(plan, null, 2));
}

function installerNames(version, os, arch) {
  const target = targets.find(([targetOs, targetArch]) => os === targetOs && arch === targetArch);
  if (!target) throw new Error(`Unsupported release target: ${os}/${arch}`);
  return target[2].map((extension) => {
    const packageArch = os === 'linux'
      ? ({ AppImage: 'x86_64', deb: 'amd64', rpm: 'x86_64' }[extension] ?? arch) : arch;
    return `ZCode-${version}-${os}-${packageArch}.${extension}`;
  });
}

async function requireFiles(directory, names) {
  const entries = new Map((await readdir(directory, { withFileTypes: true })).map((entry) => [entry.name, entry]));
  for (const name of names) {
    if (!entries.get(name)?.isFile()) throw new Error(`Missing required file: ${name}`);
    if ((await stat(join(directory, name))).size === 0) throw new Error(`Empty file: ${name}`);
  }
}

async function collect(source, output, os, arch) {
  const { sha, version, node, pnpm, sourceRepository } = await readSourceMetadata(source);
  const names = installerNames(version, os, arch);
  const directory = join(source, 'packages', 'desktop', 'dist');
  await requireFiles(directory, names);
  await mkdir(output, { recursive: true });
  const installers = [];
  for (const name of names) {
    await copyFile(join(directory, name), join(output, name));
    installers.push(await fileRecord(output, name));
    console.log(`Collected ${name}`);
  }
  const receipt = { sha, version, node, pnpm, sourceRepository, os, arch, installers };
  await writeFile(join(output, `receipt-${os}-${arch}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
}

async function harden(source) {
  const path = join(source, 'packages', 'desktop', 'scripts', 'bundle.mjs');
  const original = await readFile(path, 'utf8');
  const invocation = /const buildArgs = \[\r?\n    "exec",\r?\n    "electron-builder",\r?\n/;
  const patched = 'const buildArgs = [\n    "exec",\n    "electron-builder",\n    "--publish",\n    "never",\n';
  if (!original.includes(patched) && (original.match(new RegExp(invocation.source, 'g')) ?? []).length !== 1) {
    throw new Error('Upstream build invocation changed; review the no-publish patch before building');
  }
  const cleanupPath = join(source, 'packages', 'desktop', 'scripts', 'packaged-sourcemap-cleanup.mjs');
  const cleanup = (await readFile(cleanupPath, 'utf8')).replaceAll('\r\n', '\n');
  const walker = '    const entryPath = resolve(rootDir, entry);\n    const stat = statSync(entryPath);';
  const protectedWalker = '    const entryPath = resolve(rootDir, entry);\n'
    + '    const normalizedEntryPath = entryPath.replaceAll("\\\\", "/");\n'
    + '    if ((normalizedEntryPath + "/").includes("/visualize-plugin/skills/visualize/assets/vendor/")) {\n'
    + '      continue;\n    }\n    const stat = statSync(entryPath);';
  if (!cleanup.includes(protectedWalker) && cleanup.split(walker).length !== 2) {
    throw new Error('Upstream sourcemap walker changed; review the visualize vendor protection before building');
  }
  if (!original.includes(patched)) await writeFile(path, original.replace(invocation, patched));
  if (!cleanup.includes(protectedWalker)) await writeFile(cleanupPath, cleanup.replace(walker, protectedWalker));
  console.log('Applied build-only patches: electron-builder --publish never; preserve visualize vendor hashes; upstream audits retained');
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function fileRecord(directory, name) {
  const path = join(directory, name);
  return { name, size: (await stat(path)).size, sha256: await sha256(path) };
}

async function finalize(directory, planFile) {
  const plan = JSON.parse(await readFile(planFile, 'utf8'));
  validatePlan(plan);
  const names = targets.flatMap(([os, arch]) => installerNames(plan.version, os, arch));
  const receiptNames = targets.map(([os, arch]) => `receipt-${os}-${arch}.json`);
  const featureReportNames = targets.map(([os, arch]) => `feature-report-${os}-${arch}.json`);
  await requireFiles(directory, [...names, ...noticeNames, ...receiptNames, ...featureReportNames]);
  const installers = [];
  for (const name of names) {
    installers.push(await fileRecord(directory, name));
  }
  for (const [os, arch] of targets) {
    const receiptName = `receipt-${os}-${arch}.json`;
    const receipt = JSON.parse(await readFile(join(directory, receiptName), 'utf8'));
    const expected = { sha: plan.sha, version: plan.version, node: plan.node, pnpm: plan.pnpm,
      sourceRepository: plan.sourceRepository, os, arch };
    for (const [key, value] of Object.entries(expected)) {
      if (receipt?.[key] !== value) throw new Error(`Receipt ${receiptName} mismatched ${key}`);
    }
    const targetNames = installerNames(plan.version, os, arch);
    if (!Array.isArray(receipt.installers) || receipt.installers.length !== targetNames.length) {
      throw new Error(`Receipt ${receiptName} installer set mismatch`);
    }
    for (const name of targetNames) {
      const recorded = receipt.installers.find((entry) => entry?.name === name);
      const actual = installers.find((entry) => entry.name === name);
      if (recorded?.size !== actual.size || recorded?.sha256 !== actual.sha256) {
        throw new Error(`Receipt ${receiptName} installer integrity mismatch: ${name}`);
      }
    }
  }
  const featureReports = [];
  for (const [os, arch] of targets) {
    const name = `feature-report-${os}-${arch}.json`;
    const report = JSON.parse(await readFile(join(directory, name), 'utf8'));
    if (report?.source?.sha !== plan.sha || report.source?.version !== plan.version
      || report.os !== os || report.arch !== arch) {
      throw new Error(`Feature-report source/target mismatch: ${name}`);
    }
    if (!Array.isArray(report.features) || report.features.length !== featureNames.length
      || new Set(report.features.map((entry) => entry?.name)).size !== featureNames.length
      || report.features.some((entry) => !featureNames.includes(entry?.name)
        || typeof entry.version !== 'string' || !versionPattern.test(entry.version))) {
      throw new Error(`Feature-report must contain 15 unique expected plugins with valid versions: ${name}`);
    }
    if (report.computerUse?.available !== false) {
      throw new Error(`Feature-report cannot claim native Computer Use availability: ${name}`);
    }
    featureReports.push(await fileRecord(directory, name));
  }
  const repository = process.env.GITHUB_REPOSITORY ?? 'LeeXieXie/ZCode';
  const runId = process.env.GITHUB_RUN_ID;
  const provenance = {
    upstream: { repository: upstreamRepository, sha: plan.sha, version: plan.version, date: plan.sourceDate },
    builder: {
      repository,
      sha: process.env.BUILDER_SHA ?? process.env.GITHUB_SHA ?? null,
      triggerSha: process.env.GITHUB_SHA ?? null,
      run: runId ? `https://github.com/${repository}/actions/runs/${runId}` : null,
      attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    },
    tools: { node: plan.node, pnpm: plan.pnpm },
    signed: false,
    notarized: false,
    buildPatches: ['Disable implicit publishing: electron-builder --publish never',
      'Preserve visualize vendor snapshots during packaged sourcemap cleanup'],
    licenseReview: 'Upstream records unresolved third-party license-material gaps; see UPSTREAM-LICENSE-REVIEW.md. This build is not a complete redistribution-compliance audit.',
    installers,
    featureReports,
  };
  await writeFile(join(directory, 'build-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== 'SHA256SUMS.txt')
    .map((entry) => entry.name).sort();
  const sums = [];
  for (const name of files) sums.push(`${await sha256(join(directory, name))}  ${name}\n`);
  await writeFile(join(directory, 'SHA256SUMS.txt'), sums.join(''));
  const sourceUrl = `https://github.com/${upstreamRepository}/tree/${plan.sha}`;
  const notes = `# ${plan.title}

Unofficial community build from public upstream source. Not an official Z.ai release.

- Upstream version: \`${plan.version}\`
- Exact source commit: [\`${plan.sha}\`](${sourceUrl})
- Node.js: \`${plan.node}\`; pnpm: \`${plan.pnpm}\`
- Build workflow: ${provenance.builder.run ?? 'local verification'}
- Signing: **unsigned and not notarized**. Windows SmartScreen and macOS Gatekeeper may warn or block installation.
- The public **Computer Use** package is a placeholder, not the official Computer Use implementation.
- 15 packaged plugin assets verified, not end-to-end feature parity; see feature-report files and docs/zcodepro-assessment.md.
- Upstream automatic updates remain disabled. Get subsequent community builds from this repository.
- Build-only patches force \`electron-builder --publish never\` and preserve hash-pinned visualize vendor snapshots during sourcemap cleanup; application/runtime source is unchanged.
- Upstream records **unresolved third-party license-material gaps**. See \`UPSTREAM-LICENSE-REVIEW.md\`; build success does not establish complete redistribution compliance.

## Downloads

| Platform | Architecture | Packages |
| --- | --- | --- |
| Windows | x64 | EXE installer |
| macOS | Apple Silicon ARM64 | DMG, ZIP |
| macOS | Intel x64 | DMG, ZIP |
| Linux | x64 | AppImage, DEB, RPM, Arch package |

Verify downloads against \`SHA256SUMS.txt\`. Source/build details and individual installer
hashes are in \`build-provenance.json\`. Upstream licenses and notices are included
as release assets and retained inside the application by upstream packaging.

These checks verify packaging and the bundled Agent help command, not a logged-in
model session or the complete desktop UI. Review upstream notices before use.
`;
  await writeFile('release-notes.md', notes);
  console.log(`Validated ${installers.length} installers and wrote SHA256SUMS.txt`);
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'plan' && args.length === 1) await planSource(resolve(args[0]));
  else if (command === 'harden' && args.length === 1) await harden(resolve(args[0]));
  else if (command === 'collect' && args.length === 4) await collect(...args);
  else if (command === 'finalize' && args.length === 2) await finalize(...args);
  else throw new Error('Usage: release.mjs plan SOURCE | harden SOURCE | collect SOURCE OUTPUT OS ARCH | finalize ARTIFACTS PLAN');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
