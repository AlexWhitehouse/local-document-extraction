# Release qualification log

A record of the checks run for past releases, kept for audit purposes. Each entry describes exactly what was tested, and what wasn't. None of it is evidence for later code: every release is qualified again against its own commit using the [release checklist](../releasing.md).

## Secret scanning before the repository went public (2026-09-22)

On 2026-09-22, Gitleaks 8.30.1 (upstream checksum verified) scanned reachable Git history with `--redact --log-opts=--all`: 98 non-merge commits, approximately 9.22 MB, across a repository with 128 reachable commits. Four findings were reviewed as synthetic documentation placeholders/test idempotency identifiers. `.gitleaksignore` records only their exact immutable fingerprints and rationale; the subsequent history scan was clean. This does not cover future changes or prove that every possible secret format is detectable.

The proposed tracked working tree was scanned again with Gitleaks 8.30.1 on 2026-09-22: 599 files, approximately 4.54 MB, with no findings. Production dependency hygiene also passed with zero reported advisories and zero duplicate package versions. The clean `76bea27` candidate archive passed a further scan (354 entries, approximately 2.30 MB), with no state, configuration secrets, dependencies, or generated CI evidence included. Its SHA256 is `8c9281aee74af9a42192ef38a0c81df88525186227aab8359bc62e2132f31dd6`. Reachable history at that commit also passed: 104 non-merge commits, approximately 9.46 MB. This archive predates the license addition; scan the final named release archive again before publication and verify that it contains `LICENSE`.

## Initial audit

The initial audit verified a clean exported copy on the current macOS host using Bun 1.4.2, while `package.json` pinned 1.4.1. That earlier check passed install, typecheck, tests, build, migration, and startup, but it was **not** a fresh-machine Linux, exact-pinned-version, installer, OAuth, or live email qualification. Its scope is summarized here because the local scratch report is not distributed. Subsequent implementation checks must be recorded separately; do not reuse the earlier results as evidence for changed code.

## Installer verification (2026-09-22)

Installer implementation verification on 2026-09-22 passed ten integration tests with 73 assertions on macOS arm64. Both the test harness and installed applications used pinned Bun 1.4.1; the application-owned runtime was downloaded from the official release and checksum verified. Coverage included custom paths/spaces, repeated installs, private config/state preservation and backup, a real local account and both machine secrets preserved across reinstall, startup/status/doctor/native PDF/mail/shutdown, running-upgrade refusal, checksum/download/build failures, occupied-port failure, and safe retry. A deterministic shutdown regression covers command-line text disappearing while the signalled process exits. Linked and nonregular `config.env` files were rejected without changing outside file contents or permissions. The extracted application also passed root typecheck and lint using the application-owned Bun without Node on PATH. A separate restoration from the generated pre-migration backup starts successfully, decrypts the original Workspace gateway credential, and accepts the original verification token and account password.

A controlled curl substitute exercised a fork's exact production GitHub download URLs for `v1.2.3` and the installed launcher's `update v1.2.4` path, preserving configuration, account data, and the authentication secret. This verifies URL construction and the release/update code path against controlled archive/checksum responses; it is not a test against real published GitHub release assets.

The implementation passed `bun run ci:quality` with pinned Bun 1.4.1: root typecheck, lint, 282 backend tests, the complete local-product smoke test, 279 frontend tests, frontend coverage, and build. Five Playwright browser journeys also passed on the macOS arm64 host. Focused auth, mail, and permission checks passed 28 tests with 129 assertions; a further 27 vault/product-store/runtime checks covered linked model-secret files, directories, and workspace SQLite sidecars. These checks verify rejection without changing outside permissions or contents. `.env.example` validates through the shared configuration loader and contains no personal account, endpoint, or credential values.

## Four-platform CI qualification of `76bea27`

Platform quality, coverage, dependency hygiene, native PDF rendering and all ten installer tests, including backup restoration, passed on all four targets for commit `76bea27` in [CI run 35792414420](https://github.com/AlexWhitehouse/local-document-extraction/actions/runs/35792414420). All five Linux Chromium journeys and the full-history secret scan also passed. The final local root checks passed 286 backend tests, the complete product smoke test, 279 frontend tests, typecheck, lint, and build. Earlier Linux browser runs exposed a hover rule that enlarged compact buttons, causing the save control to wrap away from the pointer with Linux system fonts. The corrected rule preserves button size; the extraction journey passes with its normal click. At that point, real Google/Cloudflare accounts and published-release downloads had not been tested. The published-download check is recorded below; live Google/Cloudflare verification remains outstanding.

Qualification also exposed an early upload-cancellation race: a request aborted during temporary-directory initialization could miss the newly registered abort listener. The parser now handles cancellation that already happened before the pipeline starts. Regression tests cover cancellation before parsing, during initialization, and after data reaches a partial file; each checks body cancellation and removal of temporary files. These checks passed in the four-platform run above. Consult the final pull request checks for qualification of subsequent license/documentation changes; the release workflow also rechecks the exact tagged commit.

| Target | Runner | Quality and installer result |
| --- | --- | --- |
| Linux x64 | `ubuntu-24.04` | Passed |
| Linux arm64 | `ubuntu-24.04-arm` | Passed |
| macOS arm64 | `macos-15` | Passed |
| macOS x64 | `macos-15-intel` | Passed |

Record the actual runner OS/architecture and workflow run alongside each result. These jobs do not qualify older OS versions or other Linux distributions merely because the installer recognizes their OS/architecture.

## Dependency license review

The raw production inventory reports `buffers@0.1.1` as `Unknown` because its npm archive omits license metadata. This was manually resolved to the original author's `MIT/X11` declaration in the [pinned upstream manifest](https://raw.githubusercontent.com/TooTallNate/node-buffers/1b745ee35d33eb166e15ef1866073a07c6d7de87/package.json). The license-only commit retains version 0.1.1; executable source is byte-identical to the installed package. Preserve raw inventory output and the explicit manual resolution; no package or project license was rewritten. The supporting scratch research is retained locally and is not distributed.

## Published v0.1.0

[v0.1.0](https://github.com/AlexWhitehouse/local-document-extraction/releases/tag/v0.1.0) was published from merged commit `3d7fe66713fb9de3df2420484f8024f4c408cb3c`. [Release workflow 35796313350](https://github.com/AlexWhitehouse/local-document-extraction/actions/runs/35796313350) passed for that exact commit with pinned Bun 1.4.1: all four platform quality/installer jobs listed above, the Linux Chromium journeys, full-history secret scan, license gate, and release packaging.

The published archive contains 355 entries and includes `LICENSE` and clean tagged revision metadata. Its SHA256 is `957d6861c2c6645c5e11db889f3e7148d0fd3d01f672f5f6713100e47092e933`. The checksum manifest matched, the published installer matched the tagged source, and the extracted archive passed Gitleaks 8.30.1 without findings. No `.env`, `config.env`, `.local`, `.scratch`, `.git`, or `node_modules` entries were included.

On 2026-09-23, all three assets downloaded without GitHub authentication. The exact README command installed v0.1.0 on the current macOS arm64 host using empty, isolated XDG directories with spaces, an isolated port, and a PATH without Bun or Node. The installer downloaded its pinned runtime, and health, the built SPA, native PDF rendering, and shutdown checks passed. Updating through the published `v0.1.0` URL staged a new release, created a backup, preserved configuration and the authentication secret, and passed startup/doctor/shutdown again. This was an isolated installation on an existing host, not a fresh-machine test of the published URLs. Clean CI runners separately tested the tagged installer on all four platforms before publication.

## Bun 1.4.2 qualification (2026-09-23)

Bun 1.4.2 qualification on 2026-09-23 passed on macOS arm64 with the root runtime declaration and root/backend `bun-types` pins aligned at 1.4.2. The frozen install and complete `bun run ci` passed (typechecks, lint, 317 backend tests plus the runtime smoke test, 289 frontend tests, coverage, build, three browser-evidence tests, and all five browser journeys). All ten installer integration tests passed with 73 assertions, including verification that the installed application-owned Bun matches the 1.4.2 pin. This is local macOS evidence; Linux qualification remains the CI lane's responsibility.

## v1.0.0 candidate verification (2026-10-02)

The final automatic-processing candidate passed `bun run ci` on macOS arm64 with pinned Bun 1.4.2: typechecks, lint, 533 backend tests plus the runtime smoke test, 480 frontend tests, coverage, build, three browser-evidence checks, and all 13 Chromium journeys. Regression coverage includes tag routing, split review, blank completion, single-document presentation, preview lifetime, packet pagination, child-load retries, and pending settings saves.

All 18 installer/configuration tests passed, including clean installation, native PDF rendering, upgrade preservation, backup restoration, and controlled failures. Production package hygiene reported zero advisories and zero compatible duplicates. The strict MkDocs build, documentation links and JSON examples, and Postman request/response scripts also passed validation.

These are local candidate checks, not a claim that a tag has already passed multi-platform CI. The release workflow rechecks the exact tag on Ubuntu 24.04 x64/arm64 and macOS 15 arm64 before publication. Published-asset checks and the isolated upgrade from the published v0.2.0 release are recorded with the [v1.0.0 release](https://github.com/AlexWhitehouse/local-document-extraction/releases/tag/v1.0.0). Intel macOS, live Google sign-in, and live Cloudflare email delivery were not qualified in this local run.
