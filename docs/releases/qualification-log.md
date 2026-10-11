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

## Bun 1.4.3 qualification (2026-10-10)

Bun 1.4.3 qualification passed on the existing Ubuntu 26.04.1 x64 host on 2026-10-10. Root runtime and root/backend `bun-types` pins all used 1.4.3. Bun reports SQLite 3.53.4. Typechecks, lint, 673 backend tests, the runtime smoke test, and build passed. Three browser-evidence tests and all 19 Chromium journeys also passed.

In the full frontend run, 850 of 853 tests passed. Three tests in `EvaluationJourneys.test.jsx` exceeded the 5-second timeout. The file passed 14 of 14 tests when run alone twice. Vitest runs on Node, so the Bun version does not affect it.

All 20 installer tests passed with 141 assertions. They verified that the installed application-owned Bun matched 1.4.3.

Typechecks now use `bun check` instead of `tsc`. Both checkers checked the same 230 backend, 23 e2e and 53 scripts files. They reported identical diagnostics for injected errors. The root typecheck went from about 27 seconds to about 1 second.

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

## v1.3.1 release qualification (2026-10-05)

[v1.3.1](https://github.com/AlexWhitehouse/local-document-extraction/releases/tag/v1.3.1) was published from `25165d7c404061cef3b01d24abc5dedc6c9144b5`. [Release workflow 37245841764](https://github.com/AlexWhitehouse/local-document-extraction/actions/runs/37245841764) passed for that exact commit with Bun 1.4.2. Platform verification covered quality, dependency hygiene, coverage, build, native PDF rendering, and installer tests on Ubuntu 24.04 x64 and arm64, and macOS 15 arm64. Linux Chromium journeys, the complete-history secret scan, the license gate, and packaging passed. The scheduled/manual randomized backend lane was skipped as configured.

A clean detached checkout without local configuration or state passed frozen dependency installation, typechecks, lint, 598 backend tests, the runtime smoke test, and the production build with Bun 1.4.2 on the existing macOS 27.0 arm64 host. The lockfile remained unchanged. 597 of 598 frontend tests passed. `App.workspace-toasts.test.jsx` › "revalidates a second browser's Workspace context after a live access invalidation" failed in the full file run on this host, as it also did on `main` before this release's changes. It passed when run alone and passed in every CI runner. The frontend coverage gate was not run locally.

All three published assets downloaded without GitHub authentication. The archive SHA256 was `69e00d6271fc2667bfcf9cc4a72fee5ae6a2c6c80fa424d00f12f39a9cb05432` and matched the published checksum file. Its 593 entries included the project license and clean metadata identifying v1.3.1 and the tagged commit. The archive excluded private configuration, runtime state, dependencies, and scratch files. The published installer matched the copy inside the archive.

The exact README installation command passed on the existing macOS 27.0 arm64 host, using empty isolated XDG directories with spaces, a separate loopback port, and a PATH without Bun. Health, SPA fallback, `doctor`, native PDF rendering, private configuration and state permissions, shutdown, and restart passed. The served stylesheet included this release's summary-row change.

A separate installation downloaded published v1.3.0 and created a local account. Its installed `document-extraction update v1.3.1` command refused to run while the application was running, then upgraded after `document-extraction stop`. Configuration bytes, the generated authentication secret, the account, and a pre-upgrade browser session survived, and password sign-in succeeded. The update wrote a pre-upgrade backup. Health and the new stylesheet were served after the upgrade.

Both installations were stopped, and their temporary application, configuration, and state directories were removed.

These published-download checks used noninteractive defaults on an existing macOS host. They did not qualify fresh machines, published downloads on Linux, Intel macOS, older operating systems, Workspace model credentials, documents, or live model routes. Live Google sign-in and Cloudflare email delivery were not tested. CI separately qualified its three listed runners.

Local verification results remain in `.scratch/release-v1.3.1/`. They are not distributed.

## v2.0.0 release qualification (2026-10-06)

[v2.0.0](https://github.com/AlexWhitehouse/local-document-extraction/releases/tag/v2.0.0) was published from `921143474c851443727e456d75a53427fe209a9d`. [Release workflow 37397162171](https://github.com/AlexWhitehouse/local-document-extraction/actions/runs/37397162171) passed for that exact commit with Bun 1.4.2. Platform verification covered quality, dependency hygiene, coverage, build, native PDF rendering, and installer tests on Ubuntu 24.04 x64 and arm64, and macOS 15 arm64. Go race checks and integration tests, Linux Chromium journeys, the complete-history secret scan, the license gate, and packaging passed. The scheduled/manual randomized backend lane was skipped as configured.

A clean detached checkout without local configuration or state passed frozen dependency installation, typechecks, lint, 627 backend tests, the runtime smoke test, all 598 frontend tests, the frontend coverage gate, and the production build with Bun 1.4.2 on the existing Ubuntu 26.04.1 x64 host. The lockfile remained unchanged. The temporary checkout and its Go build cache were removed after verification.

All three published assets downloaded without GitHub authentication. The archive SHA256 was `de77455a755beeb34ed650356819c470901147d912cd68c305b6834d6a37da98` and matched the published checksum file. Its 651 entries included the project license, executable Go processors for Linux/macOS x64/arm64, and clean metadata identifying v2.0.0 and the tagged commit. The archive excluded private configuration, runtime state, dependencies, scratch files, and generated raw benchmark results. The published installer matched the copy inside the archive.

The exact README installation command passed using empty isolated XDG directories with spaces, an ephemeral loopback port, and a PATH without the host's Bun or Go toolchain. Health diagnostics confirmed a running Go processor. SPA fallback, native PDF rendering, private configuration and state permissions, shutdown, and restart passed.

A separate installation downloaded published v1.3.1 and upgraded through its installed `document-extraction update v2.0.0` command. Configuration bytes, account login, Workspace membership, a saved Template, a completed Document and its extraction result, and both generated secrets survived. The synthetic model credential remained decryptable, and the Document's reported USD 0.25 cost and Template label were preserved. All four pre-upgrade state files matched the pre-migration backup. Health, Go processor startup, SPA fallback, native PDF rendering, shutdown, and restart passed.

Both installations matched the published archive checksum and tagged revision. Both were stopped, and their temporary application, configuration, and state directories were removed. Downloaded verification assets were removed after inspection; small logs and verification results remain in `.scratch/release-v2.0.0/` and are not distributed.

These published-download checks used noninteractive defaults on an existing Linux host. They did not qualify fresh machines, published downloads on macOS, Intel macOS, older operating systems, or live model routes. Live Google sign-in and Cloudflare email delivery were not tested. CI separately qualified its three listed runners. Downgrades from logical PDF Sources to v1.x were not tested or supported.

## v2.1.1 release qualification (2026-10-06)

[v2.1.1](https://github.com/AlexWhitehouse/local-document-extraction/releases/tag/v2.1.1) was published from `f477df5f1bdf014606ca3fbe740df505e09ef77d`. [Release workflow 37519937317](https://github.com/AlexWhitehouse/local-document-extraction/actions/runs/37519937317) passed for that exact commit with Bun 1.4.2. Platform verification covered quality, dependency hygiene, coverage, build, native PDF rendering, and installer tests on Ubuntu 24.04 x64 and arm64, and macOS 15 arm64. Go document processing, Linux Chromium journeys, the complete-history secret scan, the license gate, and packaging passed. The scheduled/manual randomized backend lane was skipped as configured.

A clean detached checkout without local configuration or state passed frozen dependency installation, typechecks, lint, 623 backend tests, the runtime smoke test, all 601 frontend tests, and the production build with Bun 1.4.2 on the existing Ubuntu 26.04.1 x64 host. The lockfile remained unchanged. The frontend coverage gate was not run locally. The temporary checkout was removed after verification.

All three published assets downloaded without GitHub authentication. The archive SHA256 was `78dfcb16c54e19ae8c6d1e785b6e8047aeb238af1fe9310e40c31af84f485d1a` and matched the published checksum file. Its 743 entries included the project license, Go processors and PDFium renderers for Linux/macOS x64/arm64, and clean metadata identifying v2.1.1 and the tagged commit. The archive excluded private configuration, runtime state, dependencies, and scratch files. The published installer matched the copy inside the archive.

The exact README installation command passed using empty isolated XDG directories with spaces, the default loopback port, and a PATH without the host's Bun or Go toolchain. Status, health diagnostics with a running Go processor, SPA fallback, `doctor`, PDFium availability, private configuration and state permissions, shutdown, and restart passed. The served assets included this release's Evaluation cost display.

A separate installation downloaded published v2.1.0 and created a local account with a browser session. Its installed `document-extraction update v2.1.1` command refused to run while the application was running, then upgraded after `document-extraction stop`. Configuration bytes, the generated authentication secret, the account, and the pre-upgrade session survived, and password sign-in succeeded. The update wrote a pre-upgrade backup. Health was served after the upgrade.

Both installations were stopped, and their temporary application, configuration, and state directories were removed. Small logs remain in `.scratch/release-v2.1.1/` and are not distributed.

These published-download checks used noninteractive defaults on an existing Linux host. They did not qualify fresh machines, published downloads on macOS, Intel macOS, older operating systems, Workspace model credentials, documents, or live model routes. Live Google sign-in and Cloudflare email delivery were not tested. CI separately qualified its three listed runners.

## v2.4.0 release qualification (2026-10-11)

[v2.4.0](https://github.com/AlexWhitehouse/local-document-extraction/releases/tag/v2.4.0) was published from `c0b158fb4d43b5230429be02188ce8da10afc1b5`. [Release workflow 38103585538](https://github.com/AlexWhitehouse/local-document-extraction/actions/runs/38103585538) passed for that exact commit with Bun 1.4.3. Platform verification covered quality, dependency hygiene, coverage, build, native PDF rendering, and installation and upgrade tests on Ubuntu 24.04 x64 and arm64, and macOS 15 arm64. Packaging built the archive once; the three installer jobs tested that archive, and publication verified its checksum and published it without rebuilding. Go document processing, Linux Chromium journeys, the complete-history secret scan, and packaging passed. The scheduled/manual randomized backend lane and worker benchmark were skipped as configured.

A clean checkout of the release notes PR head `5b2330278099952e708eb6c9d828e5d81d789044`, without local configuration or state, passed frozen dependency installation, typechecks, lint, 702 backend tests, the runtime smoke test, all 932 frontend tests, and the production build with Bun 1.4.3 on the existing Ubuntu 26.04.1 x64 host. The lockfile remained unchanged. That commit has the same tree as the tagged merge commit. The frontend coverage gate was not run locally. The temporary checkout was removed.

All three published assets downloaded without GitHub authentication. The archive SHA256 was `bfc394d38959dbb8bfc9940a6386ad2424298a71b0cfb377d33d88cb378b0ba8` and matched the published checksum file. Its 885 entries included the project license, Go processors and PDFium libraries for Linux/macOS x64/arm64, the release notes, the MCP guide, `.env.example` with both MCP settings off, and clean metadata identifying v2.4.0 and the tagged commit. The archive excluded private configuration, runtime state, dependencies, and scratch files. The published installer matched the copy inside the archive.

The exact README installation command passed using empty isolated XDG directories with spaces, an ephemeral loopback port, and a PATH without the host's Bun or Go toolchain. The installer downloaded Bun 1.4.3. Health diagnostics with a running Go processor, SPA fallback, `doctor` with the PDFium check, owner-only configuration and state permissions, shutdown, and restart passed. With MCP disabled by default, both discovery endpoints, `/mcp` and client registration returned 404 rather than the SPA.

A separate installation used the published v2.3.1 installer to install v2.3.1 with Bun 1.4.2, created a local account, and seeded a Workspace with a saved Template, a completed Document with its result and USD 0.25 cost, and an encrypted synthetic model credential. Its installed `document-extraction update v2.4.0` command refused to run while the application was running, then upgraded after `document-extraction stop`. Configuration bytes, both generated secrets, account and session rows, password sign-in, Workspace membership, the Template, the Document, its result and cost all survived, and the credential remained decryptable. All six pre-upgrade state files matched the pre-migration backup. The runtime moved to Bun 1.4.3. Migration only added tables: the control database gained `jwks`, `mcp_grants`, `mcp_operations`, `mcp_security_activity`, `mcp_uploads`, and seven `oauth*` tables, and the Workspace database gained `mcp_operation_receipts` on first open. MCP stayed disabled after the upgrade. Setting `MCP_ENABLED=true` on the loopback installation served JSON protected-resource and authorization-server metadata, and an unauthenticated `/mcp` request received 401 with a `resource_metadata` challenge. Restoring the original configuration disabled discovery again. Health, SPA fallback, `doctor`, shutdown, and restart passed.

Both installations matched the published archive checksum and tagged revision. Both were stopped, and their temporary application, configuration, and state directories were removed. The downloaded archive was removed after inspection; small logs and verification results remain in `.scratch/release-v2.4.0/` and are not distributed.

These published-download checks used noninteractive defaults on an existing Linux host. They did not qualify fresh machines, published downloads on macOS, Intel macOS, older operating systems, or live model routes. Live Google sign-in and Cloudflare email delivery were not tested. MCP checks covered only disabled behaviour, loopback discovery and the unauthenticated challenge; no MCP client connected through a published installation, and ChatGPT web, Claude Desktop and other clients were not qualified here. CI separately qualified its three listed runners.
