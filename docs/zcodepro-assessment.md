# ZcodePro Integration Assessment

Assessed on 2026-10-22 against:

- ZCode: `3c5b227649371507ddc4eb46ac5133afe6db1cab` (3.16.2).
- ZcodePro: `c81950cb6dbdb4e1529879174632b3909cca26f8`.

## Plugin Coverage

All thirteen ZcodePro marketplace plugins are already present in the newer
upstream source and registered in its desktop runtime staging list. Do not copy
the older plugin snapshots over newer source and generated office viewers.

| Plugin | ZcodePro | Upstream 3.16.2 |
| --- | --- | --- |
| android-emulator | 0.1.0 | 0.1.0 |
| documents | 0.1.8 | 0.2.0 |
| image-search | 0.1.1 | 0.1.1 |
| ios-simulator | 0.1.0 | 0.1.0 |
| pdf | 0.1.8 | 0.2.1 |
| plugin-creator | 0.1.1 | 0.1.1 |
| presentations | 0.1.8 | 0.2.0 |
| restore-legacy-sessions | 0.1.0 | 0.1.0 |
| skill-creator | 0.1.0 | 0.1.0 |
| spreadsheets | 0.1.8 | 0.2.0 |
| visualize | 0.1.0 | 0.1.0 |
| computer-use | 0.6.4 | 0.6.5 |
| zcode-guide | 0.3.0 | 0.3.0 |

An installed plugin manifest alone does not prove the associated feature runs.
The build must check staged skill files and required MCP/viewer runtime outputs.
The first actual Windows installer contained all 15 plugin/host packages, but
the stronger vendor-hash check exposed an upstream packaging defect: the
sourcemap cleanup hook removes Lucide's sourceMappingURL comment while its
vendor manifest still contains the original byte hash. That can break Visualize
runtime integrity checks despite a successful installer build. Protecting the
vendored Visualize snapshot from that cleanup is a disclosed build-only patch;
the verifier continues to require the original manifest hashes.
Image search still needs official service authentication. Mobile-emulator skills
still need the target platform's emulator/SDK. Office tools can require separate
system tools and model access. Do not claim these have been tested end-to-end.

## Computer Use Is A Separate Runtime Gap

The upstream `packages/zcode-cua` is explicitly marked
`zcodeCuaPlaceholder: true`. The Computer Use plugin can be present while desktop
automation remains unavailable.

ZcodePro's `runtimes/zcode-cua/vendor/dist-index.js` describes itself as a
rehydrated shipped compiled artifact. Its package declares Apache-2.0, but the
directory does not contain a full source-to-binary provenance or a dedicated
LICENSE/NOTICE chain. Its Windows `ax_native.node` has a hash and Electron ABI
manifest but no native source or explicit component license. The helper package
itself has no license field. These facts do not prove infringement; they do not
establish sufficient redistribution evidence either.

The Windows helper also sets
`WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN = true`. Its startup warning states
that any local process can drive Computer Use, and its broker accepts connections
without a supplied peer-verification callback. This is a local broker trust
failure, not Windows UAC bypass. Removing a user environment flag does not repair
the compiled-open gate. It is a release blocker for default integration, separate
from the incomplete redistribution evidence.

Current upstream Windows producer staging also expects the package name
`@zcode/zcode-cua` and a `zcodeCuaRuntime.schema=1` Windows entry/nativeAddon
contract. The Pro helper manifest does not meet that contract as-is. Version
numbers alone do not establish compatibility: its producer uses broker IPC v2,
its helper exposes v3, and some exported/type surfaces differ from current
upstream. Any future adapter must validate these interfaces rather than bypass
upstream asset checks.

Its macOS installer downloads an official application archive, extracts the
helper, flips the embedded `allowUnsignedLauncherLocalDev` trust gate, ad-hoc
re-signs the helper, and changes persistent per-user launch environment settings.
The vendored runtime also suppresses `--launcher-pid`. These are changes to
the helper trust chain, not simply missing plugin resources.

Therefore the default automated public release does not redistribute those
native/rehydrated components, execute the ZcodePro installers, weaken helper
signature checks, or modify user security settings. Full Computer Use parity is
not claimed. Integrating it requires documented redistribution authorization,
matching source/runtime interfaces, a supported signing or independently built
helper path, and real desktop screenshot/input/permission tests.

## Evidence

- [Upstream plugin definitions](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts)
- [Upstream desktop plugin staging](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/desktop/scripts/prepare-agent-node-bundle.mjs)
- [ZcodePro marketplace](https://github.com/luxi233/ZcodePro/blob/c81950cb6dbdb4e1529879174632b3909cca26f8/marketplace.json)
- [ZcodePro native helper manifest](https://github.com/luxi233/ZcodePro/blob/c81950cb6dbdb4e1529879174632b3909cca26f8/runtimes/cua-helper/runtime-manifest.json)
- [ZcodePro macOS installer](https://github.com/luxi233/ZcodePro/blob/c81950cb6dbdb4e1529879174632b3909cca26f8/install.sh)
- [ZcodePro runtime source notice](https://github.com/luxi233/ZcodePro/blob/c81950cb6dbdb4e1529879174632b3909cca26f8/runtimes/zcode-cua/vendor/dist-index.js)
