# ZCode Community Releases

## Objective

Maintain a dedicated public repository at `LeeXieXie/zcode-releases` that
tracks `zai-org/ZCode` and publishes installable community builds. The official
release currently stops at v3.14.3 while main reports version 3.16.2.

## Approach

A source fork with workflow overlays risks synchronization conflicts. A bare
mirror cannot retain independent workflows. This repository instead keeps the
upstream source as a Git submodule named `upstream`, with the original repository
URL and a complete commit SHA. Only the gitlink moves during synchronization.
The builder never rewrites upstream application/runtime source. It applies one
fail-closed build-wrapper patch to pass `--publish never` to electron-builder,
while retaining the wrapper's packaged-runtime and bundle-size audits.

## Pipeline

- Check upstream main every six hours and support manual source-ref selection.
- Resolve one immutable upstream SHA, read tool versions from its `mise.toml`,
  and validate those versions against its package metadata.
- Update the tracked submodule only for main builds, not historical manual refs.
- Skip snapshots with an already published release unless force is requested.
- Build Windows x64, macOS ARM64/x64, and Linux x64 on native hosted runners.
- Run the upstream desktop packaging entry point with signing and automatic
  publishing disabled. Preserve its dependency and packaged-resource audits.
- Validate expected installers, then publish only after every target succeeds.
- Give every release a version-and-source-SHA tag; retain a draft if upload fails.
- Include SHA256 checksums, build provenance, and upstream license/notice files.

## Trust Boundaries

Build jobs have read-only repository permissions, no persisted checkout
credentials, and no signing or publishing secrets. A separate publish job has
write permission and consumes only artifacts, never upstream build scripts.
The sync job only reads upstream metadata and updates the gitlink. A GitHub
Actions concurrency group serializes release workflows.

## Distribution Limits

Builds are unofficial and unsigned/unnotarized. They do not claim full feature
equivalence with official binaries: the public Computer Use package is a stub.
Keep upstream update defaults disabled and retain third-party notices. Do not
enable paid services, request model access, or add dependencies.
The upstream third-party materials document unresolved evidence gaps; attach
that document and disclose that packaging success is not a full license audit.

## Acceptance

Behavior tests cover metadata validation, installer selection, missing/empty
artifacts, release completeness, checksum correctness, and provenance output.
Validate the workflow with actionlint. Create and push the dedicated repository,
run the workflow, inspect all jobs, and verify the published asset list and
downloaded checksums. A queued workflow is not a successful release.
