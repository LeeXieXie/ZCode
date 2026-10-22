# ZCode Community Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Synchronize upstream source and publish verified community installers.

**Architecture:** Keep source in an upstream submodule and builder controls on
main. Separate metadata/sync, read-only native builds, and privileged publishing.

**Tech Stack:** Git submodules, Node.js built-ins, GitHub CLI, GitHub Actions,
and upstream pnpm/Electron packaging.

## Global Constraints

- No new application or orchestration package dependencies.
- Source repository is `zai-org/ZCode`; output is `LeeXieXie/zcode-releases`.
- Upstream application/runtime source is not modified; builds use a complete immutable SHA plus a disclosed no-publish build-wrapper patch.
- Build jobs cannot receive publishing credentials or repository write access.
- Releases remain drafts until every installer is present and uploaded.
- Preserve licenses and explicitly disclose unofficial unsigned builds.

---

### Task 1: Snapshot and Artifact Contracts

**Files:** `scripts/release.mjs`, `test/release.test.mjs`, `.gitmodules`, `upstream`.

**Interfaces:** `node scripts/release.mjs plan upstream` writes
`release-plan.json` and outputs `sha`, `version`, `node`, `pnpm`, `tag`, `title`.
`node scripts/release.mjs collect upstream artifacts OS ARCH` copies validated
installers. `node scripts/release.mjs finalize artifacts release-plan.json`
checks the complete platform set and writes checksums, provenance, release notes.

- [x] Write behavioral tests with temporary source/dist fixtures. Check that
  rejecting malformed SHA/tool pins and missing installers fails before code.
- [x] Implement metadata reading and installer checks using Node.js built-ins.
- [x] Run `node --test test/release.test.mjs` and `node --check scripts/release.mjs`.

### Task 2: Native Build and Publishing Workflow

**Files:** `.github/workflows/release.yml`.

**Interfaces:** Consume the Task 1 CLI and immutable upstream SHA. Upload an
artifact per platform plus a release-metadata artifact. Publish from a separate
job only after the complete matrix succeeds.

- [x] Configure schedule, dispatch, concurrency, and least-privilege jobs.
- [x] Resolve upstream ref using checkout; read pins; update the main gitlink;
  skip already-published releases without suppressing API errors.
- [x] Build native Windows/macOS/Linux installers and collect actual outputs.
- [x] Generate release manifests and publish a draft with `gh release` before
  setting it public. Never execute upstream code in the privileged publish job.
- [x] Run actionlint and inspect the full workflow for expression injection,
  unchecked API errors, missing artifacts, and publishing/signing side effects.

### Task 3: Documentation and Live Verification

**Files:** `README.md`, `LICENSE`, tracked plan checkboxes.

- [x] Document download links, synchronization cadence, manual rebuilds,
  platform support, unsigned-build warnings, and public-source feature limits.
- [x] Run all tests and static checks; independently review implementation.
- [x] Create the public repository, push a Lore-protocol commit, and enable
  Actions if necessary. Dispatch or observe the initial build.
- [x] Inspect each build job and fix recoverable failures. Verify Release asset
  names, checksums, upstream SHA, and repository state before reporting success.

### Task 4: ZcodePro Feature Assessment And Packaged Asset Gate

- [x] Compare fixed upstream and ZcodePro commits; retain newer upstream plugins.
- [x] Document CUA license/source and local broker peer-identity blockers.
- [x] Implement per-target reports for 15 plugin/host packages without executing
  plugins or changing user settings.
- [x] Strengthen skill/vendor/config checks with regression fixtures.
- [x] Verify the actual Windows artifact using static NSIS payload extraction.
- [x] Build the new gate on native runners and require matching feature reports,
  four source/hash receipts, and all notices before publication.

## Live Evidence

Initial run `39760618837`: Windows x64, macOS ARM64, and macOS x64 complete
successfully. Linux bundle and Agent help smoke succeed, but collection rejects
the actual electron-builder architecture aliases (`x86_64`/`amd64`). No public
release is created. Regression tests now preserve those original filenames.

Downloaded Windows installer SHA256:
`21ba386c314b544f267acc2261768b2b7690be1ec530671d64dbb274cba8b335`.
Static NSIS extraction finds 15 packaged plugin/host packages. The strengthened
verifier rejects Lucide because upstream afterPack strips its sourceMappingURL,
contradicting the shipped vendor hash. Restoring only the original Lucide bytes
in a temporary extracted inspection copy makes all 15 asset checks pass; this is
a diagnosis, not a verified repaired release. A fail-closed walker patch now
preserves that vendor snapshot, with a test proving ordinary JS is still cleaned.

Repaired run `39767198922` succeeds for all four native targets and the publish
job. Public tag: `v3.16.2-upstream.3c5b22764937`. There are 23 uploaded assets,
including 9 installers. All 22 entries in SHA256SUMS match GitHub asset digests.
The downloaded Windows installer matches SHA256
`441d65585aaad2ec72fdc3841a2af405ef0eed63d79470650466ece06045fb19`.
All four feature reports record 15 verified packaged asset sets and explicitly
report Computer Use unavailable. Local tests: 54 release + 81 feature = 135 pass.
See `docs/verification-2026-10-22.md` for evidence and verification boundaries.
