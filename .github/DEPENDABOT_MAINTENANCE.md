# Dependency maintenance

Dependabot updates GitHub Actions, Docker and Go dependencies on `dev`. Each PR
must pass PR Validation, including the candidate build, smoke tests and CodeQL.
The merger rechecks the author, repository, labels, branch, current head and base
before a SHA-conditional squash merge. GitHub branch rules remain enforced.

`auto-merge-dependabot.yml` runs from the default branch after PR Validation or
CodeQL completes, and reconciles the queue every six hours. It requests an
official Dependabot rebase for an outdated branch and explicitly dispatches
CodeQL after a merge. Missed post-merge dispatches are repaired on the next
reconciliation. Failed or deliberately stopped runs are not retried automatically.

PR builds and tagged releases use the committed dependency snapshot and Go module
graph. Container publication is handled only by `release.yml` for version tags,
with AMD64 and ARM64 smoke tests before promotion to GHCR. Dependency maintenance
does not publish development images or refresh upstream dependencies weekly.

Controls:

- Repository variable `DEPENDABOT_AUTOMERGE_MODE`: `off`, `observe`, or `active`.
- Manual maintenance run with `dry_run=true`: read-only queue inspection.

The merge operation uses `GITHUB_TOKEN`. Dependabot requires a user with push
access for rebase commands, so only that command uses `PAT_TOKEN`. The manual
`Sync Dev to Master` workflow also uses `PAT_TOKEN` so its tag pushes can trigger
the release workflow. GHCR publication uses `GITHUB_TOKEN` with `packages: write`.

Scheduled Actions are best effort and GitHub can disable them after prolonged
repository inactivity. Maintenance refreshes its active schedule through the
Actions API without dummy commits and preserves deliberate disablement.

Validate changes with `node --test .github/scripts/dependabot-maintenance.test.cjs`,
`bash tests/ci_delivery_scripts_test.sh`, and `actionlint`. Keep the maintenance
workflow and script synchronized to the default branch when changing them on dev.
