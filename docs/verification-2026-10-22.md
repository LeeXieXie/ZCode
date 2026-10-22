# Verified Community Release: 2026-10-22

## Published Snapshot

- [Release](https://github.com/LeeXieXie/zcode-releases/releases/tag/v3.16.2-upstream.3c5b22764937)
- [Successful workflow](https://github.com/LeeXieXie/zcode-releases/actions/runs/39767198922)
- Source: `zai-org/ZCode@3c5b227649371507ddc4eb46ac5133afe6db1cab`.
- Builder: `LeeXieXie/zcode-releases@5a79fc0b3634dea99a008b85cfbe6d68fe0a597d`.
- Upstream app version: `3.16.2`.
- Tool pins: Node.js `24.14.0`, pnpm `10.33.2`.

## Executed Checks

- Local behavior tests: 54 release tests and 81 feature tests pass.
- Both production JavaScript files pass `node --check`; actionlint 1.7.12 passes.
- Independent source/feature/pipeline reviews close all identified implementation
  findings. No new package dependencies are added.
- Native Windows x64, macOS ARM64, macOS x64, and Linux x64 jobs succeed.
- Every target uses frozen dependency installation, the upstream bundler and its
  runtime/size audits, and packaged Electron to run the bundled Agent `--help`.
- Every target verifies 15 packaged plugin/host asset sets against source
  metadata, required skill/MCP/viewer files, vendor hashes/licenses, and MCP
  configuration.
- Publication validates four source-bound installer receipts, four feature
  reports, and four license/notice assets before making the draft public.
- The public release has 23 uploaded assets, including 9 installers. All 22
  checksum entries match GitHub's published asset digests.
- A fresh download of the Windows EXE matches its checksum:

```text
441d65585aaad2ec72fdc3841a2af405ef0eed63d79470650466ece06045fb19  ZCode-3.16.2-win-x64.exe
```

- [Repeat-dispatch check](https://github.com/LeeXieXie/zcode-releases/actions/runs/39770717943)
  succeeds: the already-published SHA is detected, native builds/publication are
  skipped, and no duplicate release is created.

## Fixed Packaging Defects

The initial run built all native installers and passed the packaged Agent smoke
checks, but Linux collection used `x64` where electron-builder actually writes
`x86_64` or `amd64` for some formats. Collection now preserves actual filenames.

Static inspection of that Windows installer exposed a Visualize vendor mismatch:
upstream sourcemap cleanup changed Lucide bytes without changing its integrity
manifest. A targeted build-only patch preserves that vendored snapshot. The
repaired native builds pass the original byte-hash verifier; no integrity check
is weakened. A regression test also proves other JS still receives cleanup.

## Explicit Limits

- These are unsigned, unnotarized community binaries, not official releases.
- Packaged asset verification is not end-to-end feature verification. No signed
  helper trust chain, logged-in model conversation, real MCP service request,
  emulator automation, or full desktop UI workflow is claimed as tested.
- Computer Use remains unavailable. The ZcodePro native runtime is not included:
  see [source, licensing, and peer-identity findings](zcodepro-assessment.md).
- Upstream retains unresolved third-party license-material gaps; attaching its
  notices and building successfully do not establish complete redistribution
  compliance. The upstream review document is attached to the release.
