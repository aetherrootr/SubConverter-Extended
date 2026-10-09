# Fork release identity

The fork publishes containers to `ghcr.io/aetherrootr/subconverter-extended`.
`release.yml` runs when a version tag such as `v1.9.14` or `v1.9.14-aether.1` is
pushed. The checkout commit, version tag and UTC build date are passed to the
Docker build and recorded in OCI labels and the compiled `/version` response.
Builds use the committed dependency snapshot, Go module graph and headers.

## Release flow

1. Merge changes into `dev` after PR Validation passes.
2. Run `Sync Dev to Master` with `operation=sync_only` to merge without releasing,
   or `operation=new` to merge and create an annotated version tag. For `new`,
   leave `version` empty to increment the latest stable patch version, or provide
   an unused stable version. Prerelease tags can be pushed manually.
3. The tag workflow builds AMD64 and ARM64 images and pushes a run-scoped
   candidate to GHCR.
4. Both architectures must pass image identity and HTTP conversion smoke tests.
5. The tested digest is promoted to the version tag, and a GitHub Release records
   the container reference and digest.
6. Stable releases advance `latest`. Tags containing a hyphen create prereleases
   and leave `latest` unchanged.

The workflow does not build standalone release packages or publish development
images. The fork has no scheduled container registry cleanup workflow.

## Credentials and settings

- GHCR publication uses `GITHUB_TOKEN` with `packages: write`; GitHub Release
  creation uses `contents: write`.
- The manual branch synchronization workflow uses `PAT_TOKEN` to allow pushed
  tags to trigger the separate release workflow.
- Protect version tags against updates and deletion, and keep branch rules aligned
  with the actual PR Validation and CodeQL job names.
- A published version should receive a new version number for later corrections.

## Resume a built candidate

If testing fails after the candidate image is built, use the manual release
workflow with the existing `release_tag`, `candidate_digest` and original UTC
`build_date`. It checks out the tagged source, skips rebuilding, verifies both
platform-specific image digests against the version, revision and build date,
then promotes the original multi-platform digest. AMD64 and ARM64 tests pull
separate platform manifests so Docker does not overwrite one platform with
another under the same multi-platform digest. The recovery path must only be
used for a version whose image and GitHub Release have not been published.
