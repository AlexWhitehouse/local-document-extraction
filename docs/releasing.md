# Public release checklist

This document records publication gates. A script or CI job existing in the repository is not evidence that it passed on a particular platform. Do not advertise a release as qualified until the checks below have completed for its exact commit and pinned Bun version.

## Before making the repository public

- [ ] Select and add the project license; update README/contribution guidance to match it.
- [ ] Enable GitHub private vulnerability reporting and confirm the reporting path in `SECURITY.md`.
- [x] Scan reachable history with Gitleaks and review candidate fixtures (see evidence below).
- [ ] Scan the final working tree/release archive and revoke any real exposed credential before publication.
- [ ] Decide whether to publish the existing commit history or a reviewed clean export. Current-tree cleanup does not sanitize historical files or commit-author metadata.
- [ ] Verify that tracked files exclude `.env`, `config.env`, state, backups, generated CI reports, personal document samples, and owner-specific deployment settings.
- [ ] Review dependency licenses and the production dependency audit.
- [ ] Confirm the public repository identity and update installation links if it changes. Forks must use their own release assets with `--repo`.

Intentional `.scratch/<feature>/PRD.md` and issue files may remain public. Generated `.scratch/ci/` output is untracked and ignored. Historical research examples are anonymized in the current tree; no history rewrite is performed by this cleanup.

On 2026-09-22, Gitleaks 8.30.1 (upstream checksum verified) scanned reachable Git history with `--redact --log-opts=--all`: 98 non-merge commits, approximately 9.22 MB, across a repository with 128 reachable commits. Four findings were reviewed as synthetic documentation placeholders/test idempotency identifiers. `.gitleaksignore` records only their exact immutable fingerprints and rationale; the subsequent history scan was clean. This does not cover future changes or prove that every possible secret format is detectable.

## Qualify the release candidate

- [ ] Install frozen dependencies in a clean exported tree without developer `.env` or state.
- [ ] Run root typecheck, lint, tests, build, package hygiene, and browser tests.
- [ ] Exercise install, migration, auth verification, Workspace model setup, PDF/image extraction, exports, shutdown, and restart against controlled fixtures.
- [ ] Run the installer on macOS and glibc Linux, including first install, repeat install, directories with spaces, custom paths, occupied port, bad archive/checksum, download/build failure, and state-preserving upgrade.
- [ ] Validate native canvas/PDF rendering for each advertised architecture. Do not infer arm64 success from an x64 run or vice versa.
- [ ] Verify stop/backup/restore and preservation of both generated secrets across upgrades.
- [ ] Test Google login with real configured credentials if advertising the integration as verified.
- [ ] Test verification and password-reset delivery through a real Cloudflare account/domain/inbox if advertising delivery as verified.
- [ ] Review README and configuration examples against the final configuration loader and installer.

The initial audit verified a clean exported copy on the current macOS host using Bun 1.4.2, while `package.json` pinned 1.4.1. That earlier check passed install, typecheck, tests, build, migration, and startup, but it was **not** a fresh-machine Linux, exact-pinned-version, installer, OAuth, or live email qualification. See `.scratch/public-release-readiness/REPORT.md` for its scope. Subsequent implementation checks must be recorded separately; do not reuse the earlier results as evidence for changed code.

Installer implementation verification on 2026-09-22 passed nine integration tests with 59 assertions on macOS arm64. The test harness used Bun 1.4.2; installed applications used the pinned, application-owned Bun 1.4.1, downloaded from the official release and checksum verified. Coverage included custom paths/spaces, repeated installs, private config/state preservation and backup, a real local account and auth-secret preservation across reinstall, startup/status/doctor/native PDF/mail/shutdown, running-upgrade refusal, checksum/download/build failures, occupied-port failure, and safe retry. Linked and nonregular `config.env` files were rejected without changing outside file contents or permissions. The extracted application also passed root typecheck and lint using the application-owned Bun without Node on PATH.

A controlled curl substitute exercised a fork's exact production GitHub download URLs for `v1.2.3` and the installed launcher's `update v1.2.4` path, preserving configuration, account data, and the authentication secret. This verifies URL construction and the release/update code path against controlled archive/checksum responses; it is not a test against real published GitHub release assets.

The implementation passed `bun run ci:quality` with pinned Bun 1.4.1: root typecheck, lint, 282 backend tests, the complete local-product smoke test, 279 frontend tests, frontend coverage, and build. Five Playwright browser journeys also passed on the macOS arm64 host. Focused auth, mail, and permission checks passed 28 tests with 129 assertions; a further 27 vault/product-store/runtime checks covered linked model-secret files, directories, and workspace SQLite sidecars. These checks verify rejection without changing outside permissions or contents. `.env.example` validates through the shared configuration loader and contains no personal account, endpoint, or credential values.

The proposed tracked working tree was scanned again with Gitleaks 8.30.1 on 2026-09-22: 599 files, approximately 4.54 MB, with no findings. Production dependency hygiene also passed with zero reported advisories and zero duplicate package versions. Final release archives must still be scanned after packaging.

Ubuntu CI and separate x64 qualification remain pending; real Google and Cloudflare integrations were not exercised by these checks. The external release download/update path remains pending until a release exists. These local results do not check off the multi-platform or live-provider gates above.

Remote qualification is planned for all four installer targets through explicit runner labels. The results below remain pending until the corresponding jobs complete for the reviewed commit:

| Target | Planned runner | Remote result |
| --- | --- | --- |
| Linux x64 | `ubuntu-24.04` | Pending |
| Linux arm64 | `ubuntu-24.04-arm` | Pending |
| macOS arm64 | `macos-15` | Pending |
| macOS x64 | `macos-15-intel` | Pending |

Record the actual runner OS/architecture and workflow run alongside each result. These jobs do not qualify older OS versions or other Linux distributions merely because the installer recognizes their OS/architecture.

## Publish and verify

- [ ] Create the intended version tag from the reviewed commit.
- [ ] Generate and publish the release archive, checksum manifest, and `install.sh` using the release workflow.
- [ ] Verify asset names and hashes, then run the exact README installation command against the published release on a clean machine.
- [ ] Verify `--version TAG` and a fork's `--repo OWNER/REPO` behavior.
- [ ] Publish release notes with supported/tested platform details, configuration changes, migrations, known limits, and backup instructions.
- [ ] Remove the README's first-release availability notice only after the download URLs resolve successfully.

Checksums verify downloaded release content against the published manifest. They are not a substitute for protecting the repository, release workflow, or maintainer account. No release is published merely by adding these files; tag/release publication remains a separate action.

`bun run package:release --version vX.Y.Z` requires a clean committed checkout and builds `dist/release/install.sh`, `document-extraction.tar.gz`, and `document-extraction.tar.gz.sha256` for review. The default `development` version permits working-tree changes for local installer testing and records their presence in release metadata; do not publish that archive as a reviewed named release. The release workflow validates macOS and Ubuntu and requires a project license before publishing assets for a pushed `v*` tag. A manual workflow run creates artifacts without publishing a release. Review and qualify the candidate before pushing its release tag.
