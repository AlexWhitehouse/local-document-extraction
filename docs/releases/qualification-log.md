# Release qualification log

This log records release verification for audit purposes. Each entry states the tested scope and its exclusions. Historical results do not qualify later code. Verify each release against its own commit with the [release checklist](../releasing.md).

## Secret scanning before the repository went public (2026-09-22)

On 2026-09-22, Gitleaks 8.30.1 scanned reachable history with `--redact --log-opts=--all`. Its upstream checksum was verified. The scan covered 98 non-merge commits and approximately 9.22 MB in a repository with 128 reachable commits. Review identified four findings as synthetic documentation placeholders or test idempotency identifiers. `.gitleaksignore` records their exact immutable fingerprints and reasons. The later history scan was clean.

This scan does not cover future changes or prove detection of all secret formats.

Gitleaks 8.30.1 scanned the proposed tracked tree on 2026-09-22: 599 files and approximately 4.54 MB, with no findings. Production dependency hygiene passed with zero reported advisories and zero duplicate package versions.

The clean `76bea27` candidate archive also passed: 354 entries and approximately 2.30 MB. It excluded state, configuration secrets, dependencies, and generated CI evidence. Its SHA256 is `8c9281aee74af9a42192ef38a0c81df88525186227aab8359bc62e2132f31dd6`. Reachable history at that commit passed: 104 non-merge commits and approximately 9.46 MB. This archive predates the license addition. Before publication, scan the final named archive and verify that it includes `LICENSE`.

## Initial audit

The initial audit used a clean exported copy on the existing macOS host with Bun 1.4.2. At that time, `package.json` pinned 1.4.1. Install, typecheck, tests, build, migration, and startup passed. This audit did **not** qualify a fresh Linux machine, the exact pinned runtime, installer, OAuth, or live email.

The local scratch report is not distributed. Record later implementation verification separately. Do not use these results as evidence for changed code.

## Installer verification (2026-09-22)

Installer verification on 2026-09-22 passed ten integration tests and 73 assertions on macOS arm64. The harness and installed apps used pinned Bun 1.4.1. The installer downloaded the application-owned runtime from its official release and verified its checksum.

Coverage included custom paths with spaces, repeated installation, private configuration and state preservation, and backup. Reinstallation preserved a real local account and both machine secrets. Startup, status, doctor, native PDF, mail, and shutdown passed. Tests also covered running-upgrade refusal, checksum/download/build failures, occupied-port failure, and safe retry. A deterministic shutdown test covered disappearing command-line text while the signaled process exits.

Linked and nonregular `config.env` files were rejected without changes to outside contents or permissions. The extracted app passed root typecheck and lint with its own Bun and no Node on PATH. A separate restoration from the generated pre-migration backup started successfully. It decrypted the original Workspace gateway credential and accepted the original verification token and account password.

A controlled curl substitute exercised a fork’s production GitHub download URLs for `v1.2.3` and launcher `update v1.2.4`. Configuration, account data, and the authentication secret remained intact. This test verified URL construction and release/update behavior against controlled archive and checksum responses. It did not use published GitHub release assets.

The implementation passed `bun run ci:quality` with Bun 1.4.1. This included root typecheck, lint, 282 backend tests, the product smoke test, 279 frontend tests, frontend coverage, and build. Five Playwright journeys passed on macOS arm64.

Focused auth, mail, and permission verification passed 28 tests and 129 assertions. Another 27 vault/product-store/runtime tests covered linked model-secret files, directories, and Workspace SQLite sidecars. They verified rejection without changes to outside permissions or contents. `.env.example` passed shared-loader validation. It contained no personal account, endpoint, or credential values.

## Four-platform CI qualification of `76bea27`

Commit `76bea27` passed [CI run 35792414420](https://github.com/AlexWhitehouse/local-document-extraction/actions/runs/35792414420) on all four targets. Platform quality, coverage, dependency hygiene, native PDF rendering, and ten installer tests passed. Installer coverage included backup restoration. All five Linux Chromium journeys and the full-history secret scan passed. Final local verification passed 286 backend tests, the product smoke test, 279 frontend tests, typecheck, lint, and build.

Earlier Linux browser runs found a hover rule that enlarged compact buttons. With Linux fonts, the save control moved away from the pointer. The corrected rule preserves button size, and the extraction journey passes with a normal click. At that stage, published downloads and real Google/Cloudflare accounts remained untested. Published-download evidence follows below. Live Google/Cloudflare verification remains outstanding.

Qualification found an early upload-cancellation race. Cancellation during temporary-directory initialization could occur before abort-listener registration. The parser now handles cancellation that precedes pipeline startup. Regression tests cover cancellation before parsing, during initialization, and after partial-file writes. Each verifies body cancellation and temporary-file removal. These tests passed in the four-platform run.

Use the final pull request checks for later license and documentation changes. The release workflow also verifies the exact tagged commit.

| Target | Runner | Quality and installer result |
| --- | --- | --- |
| Linux x64 | `ubuntu-24.04` | Passed |
| Linux arm64 | `ubuntu-24.04-arm` | Passed |
| macOS arm64 | `macos-15` | Passed |
| macOS x64 | `macos-15-intel` | Passed |

Record the runner OS, architecture, and workflow run with each result. Installer recognition alone does not qualify older OS versions or other Linux distributions.

## Dependency license review

The raw production inventory reports `buffers@0.1.1` as `Unknown` because its npm archive lacks license metadata. Manual review resolved it to the original author’s `MIT/X11` declaration in the [pinned upstream manifest](https://raw.githubusercontent.com/TooTallNate/node-buffers/1b745ee35d33eb166e15ef1866073a07c6d7de87/package.json). The license-only commit keeps version 0.1.1. Its executable source is byte-identical to the installed package.

Preserve the raw inventory and explicit manual resolution. No package or project license was rewritten. Supporting scratch research remains local and is not distributed.

## Published v0.1.0

[v0.1.0](https://github.com/AlexWhitehouse/local-document-extraction/releases/tag/v0.1.0) was published from merged commit `3d7fe66713fb9de3df2420484f8024f4c408cb3c`. [Release workflow 35796313350](https://github.com/AlexWhitehouse/local-document-extraction/actions/runs/35796313350) passed for that exact commit with Bun 1.4.1. It covered all four listed platform quality/installer jobs and Linux Chromium journeys. The full-history secret scan, license gate, and release packaging also passed.

The published archive has 355 entries, including `LICENSE` and clean tagged revision metadata. Its SHA256 is `957d6861c2c6645c5e11db889f3e7148d0fd3d01f672f5f6713100e47092e933`. The checksum manifest matched. The published installer matched tagged source. The extracted archive passed Gitleaks 8.30.1 with no findings. It excluded `.env`, `config.env`, `.local`, `.scratch`, `.git`, and `node_modules`.

On 2026-09-23, all three assets downloaded without GitHub authentication. The exact README command installed v0.1.0 on the existing macOS arm64 host. It used empty, isolated XDG directories with spaces, an isolated port, and a PATH without Bun or Node. The installer downloaded its pinned runtime. Health, the built SPA, native PDF rendering, and shutdown passed.

An update through the published `v0.1.0` URL staged a new release and created a backup. It preserved configuration and the authentication secret. Startup, doctor, and shutdown passed again. This was an isolated installation on an existing host, not a fresh-machine test of published URLs. Clean CI runners separately tested the tagged installer on all four platforms before publication.

## Bun 1.4.2 qualification (2026-09-23)

Bun 1.4.2 qualification passed on macOS arm64 on 2026-09-23. Root runtime and root/backend `bun-types` pins all used 1.4.2. Frozen installation and `bun run ci` passed. Coverage included typechecks, lint, 317 backend tests, the runtime smoke test, 289 frontend tests, coverage, and build. Three browser-evidence tests and all five browser journeys also passed.

All ten installer tests passed with 73 assertions. They verified that the installed application-owned Bun matched 1.4.2. This is local macOS evidence. Linux qualification remains a CI responsibility.

## v1.0.0 candidate verification (2026-10-02)

The final automatic-processing candidate passed `bun run ci` on macOS arm64 with Bun 1.4.2. Typechecks, lint, 533 backend tests, the runtime smoke test, 480 frontend tests, coverage, and build passed. Three browser-evidence checks and all 13 Chromium journeys passed.

Regressions covered tag routing, split review, blank completion, and single-document presentation. They also covered preview lifetime, packet pagination, child-load retries, and pending settings saves.

All 18 installer/configuration tests passed. They covered clean installation, native PDF rendering, upgrade preservation, backup restoration, and controlled failures. Production package hygiene reported zero advisories and zero compatible duplicates. Strict MkDocs build, documentation links, JSON examples, and Postman request/response script validation passed.

These results qualify the local candidate, not a tagged multi-platform CI run. Before publication, the release workflow verifies the exact tag on Ubuntu 24.04 x64/arm64 and macOS 15 arm64. Published-asset verification and the isolated upgrade from published v0.2.0 are recorded with the [v1.0.0 release](https://github.com/AlexWhitehouse/local-document-extraction/releases/tag/v1.0.0). This local run did not qualify Intel macOS, live Google sign-in, or live Cloudflare email delivery.

## v1.1.0 release qualification (2026-10-03)

[v1.1.0](https://github.com/AlexWhitehouse/local-document-extraction/releases/tag/v1.1.0) was published from `e9fa0c85da07d8558631ac00783982de7b2d8164`. [Release workflow 37095447149](https://github.com/AlexWhitehouse/local-document-extraction/actions/runs/37095447149) passed for that exact commit with Bun 1.4.2. Platform verification covered quality, dependency hygiene, coverage, build, native PDF rendering, and all 18 installer/configuration tests. Runners used Ubuntu 24.04 x64 and arm64, and macOS 15 arm64.

All 13 Linux Chromium journeys, the full-history secret scan, the license gate, and release packaging passed.

A clean Git export of the tagged commit passed verification on the existing macOS 27.0 arm64 host with Bun 1.4.2. Frozen installation, typechecks, lint, 540 backend tests, and the runtime smoke test passed. All 490 frontend tests, the coverage gate, and production build passed. The lockfile remained unchanged. Production dependency hygiene reported zero advisories and zero compatible duplicates. The export excluded local configuration, state, dependencies, and scratch files.

All three published assets downloaded without GitHub authentication. The archive SHA256 was `1e17e0a768e945a3d35566a5dacc1d40d4b6bdf38f91a27248ff26b49f1f0d0d`. Metadata identified v1.1.0 and the exact tagged commit, without uncommitted changes.

The exact README command installed into empty, isolated XDG directories with spaces. It used an ephemeral port and a PATH without Bun or Node. The installer downloaded Bun 1.4.2, installed frozen dependencies, and built the app. Health, SPA fallback, native PDF rendering, private permissions, shutdown, and restart passed. The installation was stopped and temporary files were removed.

An isolated published v1.0.0 installation upgraded through its installed `document-extraction update v1.1.0` command. The result matched the tagged revision and published checksum. It preserved configuration bytes, account login, Workspace membership, a saved Template, and both generated secrets. The synthetic model credential remained decryptable. All eight pre-upgrade state files matched the pre-migration backup.

Health, the built SPA, deep routes, native PDF rendering, restart, and graceful shutdown passed. The test used an ephemeral loopback port and directories with spaces. After shutdown, temporary installation, configuration, and state were removed.

Published-download verification used noninteractive defaults on the existing macOS 27.0 arm64 host. It did not use a fresh machine. CI separately qualified the listed runners. These release tests did not verify Intel macOS, older operating systems, or third-party model routes. They also excluded live Google sign-in and Cloudflare email delivery.

Local evidence remains in `.scratch/release-v1.1.0/` and `.scratch/ci/release-v1.1.0-real-upgrade/`. It is not distributed.

## v1.2.0 release qualification (2026-10-04)

[PR #44](https://github.com/AlexWhitehouse/local-document-extraction/pull/44) passed [CI run 37175471754](https://github.com/AlexWhitehouse/local-document-extraction/actions/runs/37175471754) before merge. The feature branch was then deleted locally and remotely.

[v1.2.0](https://github.com/AlexWhitehouse/local-document-extraction/releases/tag/v1.2.0) was published from merged commit `317149d89a1b34721d4278d9f1226b48b547e4a0`. [Release workflow 37175796160](https://github.com/AlexWhitehouse/local-document-extraction/actions/runs/37175796160) passed for that exact commit with Bun 1.4.2. Platform verification covered quality, dependency hygiene, coverage, build, native PDF rendering, and installer tests on Ubuntu 24.04 x64 and arm64, and macOS 15 arm64. Linux Chromium journeys, the complete-history secret scan, the license gate, and packaging passed. The scheduled/manual randomized backend lane was skipped as configured.

All three published assets downloaded without GitHub authentication. The archive SHA256 was `3ff7a80d4695021cbb4a3fc3c28cc96d2f8695491a7c7bb754ba4b718ec28f51`. Its 502 entries included the project license and clean metadata identifying v1.2.0 and the tagged commit. The archive excluded private configuration, runtime state, dependencies, and scratch files. The published installer matched the copy inside the archive.

The exact README installation command passed on the existing Ubuntu 26.04.1 x64 host, using empty isolated XDG directories with spaces, an ephemeral loopback port, and a PATH without Bun or Node. The installer downloaded Bun 1.4.2. Health, SPA fallback, native PDF rendering, private file permissions, shutdown, and restart passed.

A separate installation downloaded published v1.1.0 and upgraded through its installed `document-extraction update v1.2.0` command. Configuration bytes, account login, Workspace membership, a saved Template, a completed Document and its extraction result, and both generated secrets survived. The synthetic model credential remained decryptable. Migration 12 was present, and the historical Document's cost was unavailable rather than an invented zero. All five pre-upgrade state files matched the pre-migration backup. Health, native PDF rendering, shutdown, and restart passed.

Both installations matched the published archive checksum and tagged revision. Both were stopped, and their temporary application, configuration, and state directories were removed.

These published-download checks used noninteractive defaults on an existing Linux host. They did not qualify fresh machines, published downloads on macOS, Intel macOS, older operating systems, or live model routes. Live Google sign-in and Cloudflare email delivery were not tested. CI separately qualified its three listed runners.

Local logs and verification results remain in `.scratch/release-v1.2.0/`. They are not distributed.

## v1.2.1 release qualification (2026-10-04)

[v1.2.1](https://github.com/AlexWhitehouse/local-document-extraction/releases/tag/v1.2.1) was published from `ea3cac2d435caa11e6a528f8c75778cdf2d05af0`. [Release workflow 37222554428](https://github.com/AlexWhitehouse/local-document-extraction/actions/runs/37222554428) passed for that exact commit with Bun 1.4.2. Platform verification covered quality, dependency hygiene, coverage, build, native PDF rendering, and installer tests on Ubuntu 24.04 x64 and arm64, and macOS 15 arm64. Linux Chromium journeys, the complete-history secret scan, the license gate, and packaging passed. The scheduled/manual randomized backend lane was skipped as configured.

Local candidate checks with Bun 1.4.2 passed typechecks, lint, 589 backend tests, the runtime smoke test, all 563 frontend tests, the frontend coverage gate, and the production build. Local versioned packaging also passed with clean release metadata.

All three published assets downloaded without GitHub authentication. The archive SHA256 was `235c8517d0491db5f21b29a58c2f3139efa19037c9a20f7791e4a34a8886ade8`. Its 528 entries included the project license and clean metadata identifying v1.2.1 and the tagged commit. The archive excluded private configuration, runtime state, dependencies, and scratch files. The published installer matched the copy inside the archive.

The exact README installation command passed on the existing Ubuntu 26.04.1 x64 host, using empty isolated XDG directories with spaces, an ephemeral loopback port, and a PATH without Bun. Health, SPA fallback, native PDF rendering, private configuration and state permissions, shutdown, and restart passed.

A separate installation downloaded published v1.2.0 and upgraded through its installed `document-extraction update v1.2.1` command. Configuration bytes, account login, Workspace membership, a saved Template, a completed Document and its extraction result, and both generated secrets survived. The synthetic model credential remained decryptable. Migration 13 was present, and historical backfill preserved the Document's reported USD 0.25 cost. All four pre-upgrade state files matched the pre-migration backup. Health, SPA fallback, native PDF rendering, shutdown, and restart passed.

Both installations matched the published archive checksum and tagged revision. Both were stopped, and their temporary application, configuration, and state directories were removed.

These published-download checks used noninteractive defaults on an existing Linux host. They did not qualify fresh machines, published downloads on macOS, Intel macOS, older operating systems, or live model routes. Live Google sign-in and Cloudflare email delivery were not tested. CI separately qualified its three listed runners.

Local logs and verification results remain in `.scratch/release-v1.2.1/`. They are not distributed.

## v1.3.0 release qualification (2026-10-04)

[v1.3.0](https://github.com/AlexWhitehouse/local-document-extraction/releases/tag/v1.3.0) was published from `634d6bf8a1b66c8697ea628830e865edeb0c13ad`. [Release workflow 37244864145](https://github.com/AlexWhitehouse/local-document-extraction/actions/runs/37244864145) passed for that exact commit with Bun 1.4.2. Platform verification covered quality, dependency hygiene, coverage, build, native PDF rendering, and installer tests on Ubuntu 24.04 x64 and arm64, and macOS 15 arm64. Linux Chromium journeys, the complete-history secret scan, the license gate, and packaging passed. The scheduled/manual randomized backend lane was skipped as configured.

A clean detached checkout without local configuration or state passed frozen dependency installation, typechecks, lint, 598 backend tests, the runtime smoke test, all 598 frontend tests, the frontend coverage gate, and the production build with Bun 1.4.2. The lockfile remained unchanged. Versioned packaging passed with clean release metadata, and the temporary checkout was removed.

All three published assets downloaded without GitHub authentication. The archive SHA256 was `88213c8f40763b4d1b55f8441983dc8e77007c26668c14cfc65cc1eeea294cd9`. Its 592 entries included the project license and clean metadata identifying v1.3.0 and the tagged commit. The archive excluded private configuration, runtime state, dependencies, and scratch files. The published installer matched the copy inside the archive.

The exact README installation command passed on the existing Ubuntu 26.04.1 x64 host, using empty isolated XDG directories with spaces, an ephemeral loopback port, and a PATH without Bun. Health, SPA fallback, native PDF rendering, private configuration and state permissions, shutdown, and restart passed.

A separate installation downloaded published v1.2.1 and upgraded through its installed `document-extraction update v1.3.0` command. Configuration bytes, account login, Workspace membership, a saved Template, a completed Document and its extraction result, and both generated secrets survived. The synthetic model credential remained decryptable. Migration 14 repaired a seeded stale **Unassigned** cost label to the saved Template name while preserving the Document's reported USD 0.25 cost. All four pre-upgrade state files matched the pre-migration backup. Health, SPA fallback, native PDF rendering, shutdown, and restart passed.

Both installations matched the published archive checksum and tagged revision. Both were stopped, and their temporary application, configuration, and state directories were removed.

These published-download checks used noninteractive defaults on an existing Linux host. They did not qualify fresh machines, published downloads on macOS, Intel macOS, older operating systems, or live model routes. Live Google sign-in and Cloudflare email delivery were not tested. CI separately qualified its three listed runners.

Local logs and verification results remain in `.scratch/release-v1.3.0/`. They are not distributed.
