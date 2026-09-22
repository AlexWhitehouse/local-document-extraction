# Public release readiness review

This is the original pre-implementation audit. For the implemented setup, configuration, and current qualification evidence, see [README](../../README.md), [configuration](../../docs/configuration.md), and [release checklist](../../docs/releasing.md). Statements below about missing functionality describe the reviewed commit.

Reviewed 2026-09-22 at commit `438feb6`. Three independent agents reviewed portability/publication, configuration, and installation/documentation. The parent reviewed Git history and verified a clean exported copy. This is a review and implementation proposal; application code, configuration, README, and installer have not been changed.

The local runtime is functional without the maintainer's configuration, but the repository is not yet ready for the intended public onboarding experience. Fix the owner-specific auth configuration, first-run auth/mail behavior, local-state protections, and missing distribution documentation before launch.

**Verification completed**

- Exported tracked `HEAD` into a temporary directory, excluding the working checkout's `.env`, `.local`, and untracked files. Child processes received only basic host path/home/temp variables plus explicit test controls.
- Frozen dependency installation, root typecheck, root build, and migration passed.
- Root tests passed: 260 backend tests, one complete local-product smoke test, and 273 frontend tests; 534 total.
- Separate startup returned HTTP 200 for `/v1/health` and the built SPA `/`; SIGTERM shutdown exited successfully.
- The existing build passed with both Bun and bunx available but no Node executable on `PATH`. An explicit `bun x --bun vite build` also passed. An initially suspected missing-Node blocker was therefore not reproduced.
- Tests ran on the current macOS host with Bun 1.4.2. The repository declares Bun 1.4.1. Dependency installation could reuse the host's package cache; this was not a brand-new machine or Linux validation. No real external model, Google OAuth, or email delivery was exercised.
- A targeted history scan covered 128 reachable commits and 1,675 blobs. No tracked environment/state/key-file paths or real credentials matching the selected token/private-key/credential-URL patterns were found. Four credential-URL candidates were synthetic test fixtures. This is not a complete secret-scanner certification.

**Findings to address before launch**

| Priority | Finding and evidence | Recommended change |
| --- | --- | --- |
| High | Every installation trusts the maintainer's deployed origin. `backend/src/localAuth.ts:196-203` includes a personal domain alongside fixed development origins. | Derive trust from the configured application origin, with an explicit additional-origin list. Update tests that expect the personal origin. |
| High | Sensitive local state relies on ambient filesystem permissions. `backend/src/localRuntime.ts:11-18`, `backend/src/localAuthRuntime.ts:31-40`, and `backend/src/localMailSink.ts:47-48` do not restrict all state directories/files. The clean install produced a 0755 state directory and 0644 control database. | Use owner-only state directories and sensitive files, including sensible handling of existing installations. The auth secret and model-credential secret already have restrictive permissions. Parent directory permissions can mitigate exposure, but should not be assumed. |
| High | The documented backup command creates a secret-bearing `.local-backup-*` directory inside the checkout, which `.gitignore` does not ignore. `backend/README.md:111-115`; `.gitignore:27-28`. | Document backups outside the checkout and defensively ignore backup directories. Preserve databases and their matching machine secrets together. |
| High | New users are told to check their email even though the active runtime only captures mail to files and logs. `backend/src/localAuthRuntime.ts:47`; `frontend/src/features/auth/AuthScreen.jsx:54`. | Make mail mode explicit in setup and UI. Provide clear local verification instructions or a local mail command. Implement a real transport for optional external delivery. |
| High | No root README, `.env.example`, installer/setup command, or project license is present. Existing quick-start instructions are buried in `backend/README.md:5`. | Add the root onboarding path, complete configuration reference, owner-selected license, and tested installer. Security-reporting and contribution guidance should accompany the public repo. |
| High | Published first-extraction instructions omit mandatory Workspace model setup. `mkdocs/docs/getting-started/first-extraction.md:3`; required setup is described in `backend/README.md:46-75`. | Include account verification, Workspace gateway/model/credential setup, template selection, upload, and results in one complete walkthrough. Explain that documents are sent to the configured model endpoint, which may be local or remote. |
| Medium | Google login is displayed when unavailable. Backend enablement depends on both credentials, but frontend rendering is unconditional. `backend/src/localAuth.ts:46-56`; `frontend/src/features/auth/AuthScreen.jsx:193-196`. | Add explicit provider enablement and a secret-free runtime capabilities response for the UI. Reject incomplete enabled-provider configuration. |
| Medium | Verification and reset email templates hard-code the maintainer's sender domain. `backend/src/lib/email/accountEmailVerification.ts:17`; `accountPasswordReset.ts:17`. | Configure sender name/address; use a neutral address for local capture and a verified sender for real delivery. |
| Medium | Configuration parsing is inconsistent and can silently hide mistakes. `backend/src/server.ts:357-391`, `backend/src/migrate.ts:24-26`, and `backend/src/consumer/modelGateway.ts:55-65`. | Share one validated configuration loader across start, migrate, and setup/doctor. Validate safe integers, booleans, URLs, credential pairs, and relationships between limits. |
| Medium | Increasing upload size can exceed the independent submission reservation budget and cause persistent capacity errors. `backend/src/localSubmissionAdmission.ts:51-58`. | Ensure the reservation budget can admit the largest permitted request, including multipart overhead; explain memory implications and expose the file limit in the UI. |
| Medium | 312 tracked `.scratch/` files include generated CI reports/screenshots, absolute home paths, historical deployment details, and a personal gateway hostname. | Keep intentional issue tracking, sanitize published research, and untrack/ignore generated evidence. Audit history as well as the current tree. Adding ignore rules does not remove already tracked files or historical content. |
| Medium | Auth assumes Cloudflare's client-IP header, and the Vite proxy assumes backend port 8787. `backend/src/localAuth.ts:58-60`; `frontend/vite.config.js:17-21`. | Make trusted-proxy/IP behavior explicit and let development proxy configuration follow the chosen backend origin. |
| Medium | There is no tested release installation/upgrade path. CI covers Ubuntu and macOS quality, but does not exercise an installer or releases. `.github/workflows/ci.yml:22-25`. | Add clean installer smoke coverage and a versioned release process; test repeat installs, custom paths, failures, and state-preserving upgrades. |
| Low | The UI downloads Google Fonts. `frontend/src/styles.css:1`. | Self-host fonts or use system fonts if offline/private operation is promised. |

No maintainer home directory was found in active runtime paths. Paths are mostly repository-relative or configurable. Binding to `127.0.0.1` in `backend/src/server.ts:135` is a suitable local default, not itself a portability bug. Make it configurable only if LAN/container/server use is included in the support contract.

For publication cleanup, inspect ` .scratch/high-throughput-local-pdf-extraction/research/low-memory-pdf-data-path.md:18`, `.scratch/performance-audit-2026-09-04/REPORT.md:28`, historical billing/email plans, and `.scratch/ci/`. The reviewed browser screenshot contains synthetic test data. The audit did not identify a real credential requiring rotation; if a full scanner later finds one, removing the current file alone will not revoke it or remove historical copies.

**Existing runtime environment variables**

There are 25 active runtime variables. The main configuration table in the backend README covers 12. Sources: `backend/src/server.ts:29-103`, `:165-168`, `:230`, and `backend/src/localMemoryLimits.ts:8-33`.

| Variable | Current default | Purpose / caveat |
| --- | --- | --- |
| `PORT` | `8787` | Server port; startup also supports `0` for ephemeral test ports. |
| `BETTER_AUTH_URL` | `http://127.0.0.1:<actual port>` | Public origin for auth. |
| `DOCUMENT_EXTRACTION_STATE_DIR` | Repository `.local/` | Persistent local state. |
| `DOCUMENT_EXTRACTION_ASSETS_DIR` | Repository `frontend/dist` | Built SPA assets. |
| `DOCUMENT_EXTRACTION_ADMIN_EMAILS` | Empty | Comma-separated administrator emails; applies when accounts are created, not retroactively. |
| `GOOGLE_CLIENT_ID` | Unset | Optional Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | Unset | Optional Google OAuth secret; both values currently imply enablement. |
| `MAX_SOURCE_FILE_BYTES` | `10485760` (10 MiB) | Maximum uploaded file bytes. |
| `SUBMISSION_MAX_CONCURRENCY` | `8` | Concurrent admitted submissions. |
| `SUBMISSION_MAX_RESERVED_BYTES` | `134217728` (128 MiB) | Shared upload reservation budget. |
| `MODEL_GATEWAY_REQUEST_TIMEOUT_MS` | `300000` | Model request timeout. |
| `EXTRACTION_RETRY_DELAY_MS` | `1000` | Initial retry delay. |
| `EXTRACTION_MAX_CONCURRENCY` | `8` | Initial extraction concurrency. |
| `EXTRACTION_MAX_BUFFERED` | `10000` | In-memory queued metadata limit. |
| `EXTRACTION_RECONCILE_INTERVAL_MS` | `60000` | Durable queue reconciliation interval. |
| `EXTRACTION_ADAPTIVE_CONCURRENCY` | `true` | Adaptive resource controller. |
| `EXTRACTION_MAX_CONCURRENCY_LIMIT` | `32` | Adaptive maximum permits. |
| `LOCAL_CPU_LIMIT_RATIO` | `0.85` | CPU pressure threshold. |
| `LOCAL_MEMORY_LIMIT_RATIO` | `0.8` | Process RSS threshold relative to physical host RAM. |
| `MODEL_PREPARATION_MAX_BYTES` | 90% of process memory allowance | Optional lower preparation budget; does not preallocate RAM. |
| `MEMORY_PRESSURE_LARGE_SUBMISSION_BYTES` | `4194304` (4 MiB) | Large-upload threshold under OS memory warning. |
| `LOCAL_DISK_RESERVE_BYTES` | `1073741824` (1 GiB) | Minimum disk reserve. |
| `SOURCE_RETENTION_SWEEP_INTERVAL_MS` | `3600000` | Source retention sweep interval. |
| `FAILED_SOURCE_RETENTION_MS` | `604800000` (7 days) | Failed-source retention. |
| `LOCAL_SHUTDOWN_TIMEOUT_MS` | `10000` | Graceful shutdown timeout. |

`MAX_SOURCE_FILE_BYTES` is already enforced. The logical multipart cap adds 32 KiB, and the Bun transport cap adds 64 KiB, to the file limit (`backend/src/localDocumentBodyLimit.ts:3-18`). Unknown-length requests reserve the logical maximum. The initial extraction concurrency should also be checked against the configured adaptive maximum. On small or shared hosts, memory-derived limits deserve documented tuning; the current memory allowance is based on host RAM rather than an explicit combined budget for this app and a local model server.

**Proposed configuration additions — these are not implemented settings**

| Proposed setting | Recommended behavior |
| --- | --- |
| `HOST` | Default `127.0.0.1`; optional if broader deployment is supported. |
| `AUTH_TRUSTED_ORIGINS` | Additional explicit origins; no personal domain default. |
| `AUTH_EMAIL_PASSWORD_ENABLED` | Default `true`. |
| `AUTH_GOOGLE_ENABLED` | Default `false`; require both Google credentials when true. |
| `AUTH_SIGNUP_ENABLED` | Default `true`; apply consistently to password and social account creation. |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Default `true` to preserve current behavior; ensure the local verification flow is usable. |
| `EMAIL_PROVIDER` | Default `local`; optional `cloudflare` transport. |
| `EMAIL_FROM_ADDRESS` | Neutral local capture address; required verified sender for external delivery. |
| `EMAIL_FROM_NAME` | Default `Document Extraction`. |
| `CLOUDFLARE_ACCOUNT_ID` | Required only for Cloudflare email. |
| `CLOUDFLARE_EMAIL_API_TOKEN` | Secret, required only for Cloudflare email. |
| `LOCAL_ANALYTICS_ENABLED` | Explicit local-only analytics option. |
| `MAX_JSON_REQUEST_BYTES` | Separate bounded JSON-body cap so document-size changes do not expand all API bodies. |

Use one schema to drive validation, `.env.example`, and the configuration reference. Fail clearly on invalid values without printing secrets. A public, secret-free capabilities endpoint should give the SPA only the enabled login methods, registration state, local-mail guidance, password requirements, and upload limit. Keep deployment settings at runtime so users do not rebuild the frontend just to change SSO or payload limits. Validate that at least one login method remains enabled, and provide an administrator/bootstrap path when registration is disabled.

The implemented social login is **Google OAuth only**. Generic OIDC or SAML would be additional functionality, not an environment-file change. Decide whether public release means configurable Google login or enterprise SSO before promising support. Better Auth documents the relevant base auth policy controls in its [configuration reference](https://better-auth.com/docs/reference/options).

Cloudflare email is **absent from the active Bun delivery path**. It needs a transport implementation with bounded requests, delivery error handling, and correct signup/reset feedback. The [Cloudflare Email REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/) supports HTTP sending from an ordinary backend without a Workers binding, using an account identifier and a send-capable API token. Keep local capture as the zero-credential default. External email mode should not also log usable password-reset or verification links by default.

Additional constants worth evaluating are extraction attempt count/retry ceiling/stale recovery (`backend/src/localExtractionRunner.ts:39`), PDF rendering allowance/scale/dimensions (`backend/src/consumer/pdfPageRenderer.ts:5`), export concurrency and selected-document cap (`backend/src/localApplication.ts:763`), invitation lifetime (`backend/src/localWorkspaceControl.ts:228`), and mail/analytics retention. Expose operational controls with clear user value; keep parser/protocol invariants internal. PDF rendering changes must agree with memory-reservation estimates.

**Existing configuration decisions to preserve**

- Model gateway URL, model name, encrypted credential, and capability switches are intentionally configured per Workspace in the UI. Global `MODEL_GATEWAY_URL`, `AI_MODEL`, `LITELLM_KEY`, and related variables were retired (`backend/src/retireGlobalModelConfiguration.ts:4-12`). Do not reintroduce them as part of an environment cleanup.
- Auth uses a generated, persistent, per-installation secret (`backend/src/localAuthRuntime.ts:48-79`). `BETTER_AUTH_SECRET` is not the current application's override, because code explicitly supplies the disk secret. This default supports zero-configuration local installation.
- Workspace gateway credentials use a separate machine secret. Backups and upgrades must preserve that secret with the Workspace databases.
- The application runs locally but extraction sends document input to the user's chosen gateway. Local analytics are file-based, not a remote telemetry service. Explain these boundaries plainly.

**One-command installation proposal**

A single macOS/Linux bootstrap command is practical. No working public installer exists yet; do not publish a command pointing to a nonexistent script. The first implementation should install a versioned source release with a frozen build, rather than assume that Bun compilation will automatically package native canvas and PDF.js assets correctly.

1. Publish a small versioned `scripts/install.sh`, a release archive, and checksums. The documented command downloads the installer completely before executing it; provide inspect-then-run and manual alternatives.
2. Detect supported OS/architecture and prerequisites. Select the qualified Bun version from one maintained release definition. Install an application-owned Bun when necessary, without sudo or replacing unrelated runtimes.
3. Download into a temporary directory, verify the selected archive, install locked dependencies, and build the frontend. A release archive avoids requiring Git on the target machine.
4. Separate application releases from persistent configuration and state. Respect platform conventions and explicit path overrides; support paths with spaces. Use owner-only directories. Re-runs must not overwrite configuration, credentials, accounts, or uploaded data.
5. Validate config and paths, initialize state, start on loopback, wait for `LOCAL_RUNTIME_READY`, and check both `/v1/health` and the SPA before reporting success. Handle occupied ports explicitly.
6. Provide a user-owned launcher and documented start/stop/status/doctor/update commands. Print the actual URL, state/config paths, and local account-verification instructions. Automatic startup can be an explicit option.
7. Stage and verify upgrades before switching releases; stop and back up before state migration. Preserve secrets/state on failure and uninstall unless data removal is explicitly requested. Do not promise rollback across incompatible database migrations.
8. Test the exact installer in fresh macOS/Linux CI: first install, repeat install, custom paths, occupied port, failed download/build, state-preserving upgrade, native PDF rendering, and the account-to-extraction journey with a controlled gateway.

The repository already has macOS/Ubuntu quality jobs and a Linux browser journey. These are a useful foundation, but their existence is not proof that all operating-system versions and architectures are supported. Establish an explicit support matrix and qualify the exact pinned Bun version. Bun documents runtime-selection behavior in [bunx](https://bun.sh/docs/pm/bunx); the observed Bun-only build result is stronger evidence for this checkout than the initial assumption that a Node shebang made Node mandatory.

**README and setup documentation outline**

1. What the project does: reusable extraction templates for PDFs/images, structured results, Workspaces, API access, and exports; screenshot or short walkthrough.
2. Supported macOS/Linux versions/architectures, prerequisites, and model-gateway requirements.
3. One-command install and a complete manual installation path using the qualified Bun version and frozen dependencies.
4. First successful extraction: start, create/verify an account, configure a Workspace model, choose/create a template, upload, inspect results.
5. Minimal local configuration plus optional Google login and external email setup, including callback URLs and complete configuration-reference link.
6. What remains on disk, what is sent to the gateway, data locations, state permissions, backup/restore, updates, and uninstall.
7. Troubleshooting: local verification, no model configured, missing build, port conflicts, payload/resource limits, and provider failures.
8. Developer commands, architecture overview, license, contribution guide, and vulnerability-reporting instructions.

**Recommended implementation order**

1. Publication hygiene and local-state protection: personal origin/sender, generated tracked evidence, backup guidance, permissions, and dedicated full-history secret scan.
2. Shared configuration schema and runtime capabilities: `.env.example`, auth/provider policy, payload cross-validation, networking, and complete reference.
3. Optional email transport and accurate first-run UI; retain the credential-free local mode.
4. Root README and synchronized first-extraction docs; choose license and supported-platform/SSO scope.
5. Versioned installer/launcher and release automation, followed by fresh macOS/Linux installation and upgrade qualification.

The review leaves application behavior unchanged. License choice and the intended SSO/platform support scope are product decisions; the concrete engineering fixes above can be prepared without waiting for them.

**Implementation addendum: release CI qualification**

The initial review above is historical. The implemented release workflow now calls the same reusable `ci.yml` as pull requests. Every checkout explicitly selects `github.sha`, so a tag release must pass quality, installer/native-PDF tests, production dependency hygiene, the full-history Gitleaks scan, and the Linux Chromium journey for its exact commit before packaging. A separate nonempty `LICENSE` check also gates packaging and publication. The release workflow does not duplicate a weaker subset of CI.

Quality and installation checks run on `ubuntu-24.04` (x64), `ubuntu-24.04-arm` (ARM64), `macos-15` (ARM64), and `macos-15-intel` (x64). GitHub's current [hosted-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) lists these labels for both public and private repositories. Artifact names use the full matrix label so OS/architecture results cannot collide. Worker-cap performance comparisons remain on Ubuntu x64 and macOS ARM64; all four targets run the complete quality, installation, native-PDF, and hygiene checks.

Both workflows passed checksum-verified Actionlint 1.7.12 and structural YAML checks locally. Subsequent [CI run 35790453260](https://github.com/AlexWhitehouse/local-document-extraction/actions/runs/35790453260) passed all four platform jobs, the Linux browser journey, and the history secret scan for implementation commit `32a95ea`; see the [release checklist](../../docs/releasing.md) for detailed qualification evidence and remaining publication gates. No release tag or public assets were published by these changes.
