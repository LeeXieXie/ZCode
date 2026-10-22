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

- [ ] Write behavioral tests with temporary source/dist fixtures. Check that
  rejecting malformed SHA/tool pins and missing installers fails before code.
- [ ] Implement metadata reading and installer checks using Node.js built-ins.
- [ ] Run `node --test` and `node --check scripts/release.mjs`.

### Task 2: Native Build and Publishing Workflow

**Files:** `.github/workflows/release.yml`.

**Interfaces:** Consume the Task 1 CLI and immutable upstream SHA. Upload an
artifact per platform plus a release-metadata artifact. Publish from a separate
job only after the complete matrix succeeds.

- [ ] Configure schedule, dispatch, concurrency, and least-privilege jobs.
- [ ] Resolve upstream ref using checkout; read pins; update the main gitlink;
  skip already-published releases without suppressing API errors.
- [ ] Build native Windows/macOS/Linux installers and collect actual outputs.
- [ ] Generate release manifests and publish a draft with `gh release` before
  setting it public. Never execute upstream code in the privileged publish job.
- [ ] Run actionlint and inspect the full workflow for expression injection,
  unchecked API errors, missing artifacts, and publishing/signing side effects.

### Task 3: Documentation and Live Verification

**Files:** `README.md`, `LICENSE`, tracked plan checkboxes.

- [ ] Document download links, synchronization cadence, manual rebuilds,
  platform support, unsigned-build warnings, and public-source feature limits.
- [ ] Run all tests and static checks; independently review implementation.
- [ ] Create the public repository, push a Lore-protocol commit, and enable
  Actions if necessary. Dispatch or observe the initial build.
- [ ] Inspect each build job and fix recoverable failures. Verify Release asset
  names, checksums, upstream SHA, and repository state before reporting success.
