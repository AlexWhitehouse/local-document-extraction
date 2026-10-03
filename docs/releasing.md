# Releasing

This guide describes release qualification and publication.

A release is qualified only after every required check passes **for its exact commit and pinned Bun version**. A script or CI job alone is not evidence of success. The [qualification log](releases/qualification-log.md) records previous results.

## 1. Qualify the candidate

For the commit to be tagged, verify these conditions:

- [ ] CI passes on Linux x64, Linux arm64, and macOS arm64. It includes typecheck, lint, tests, coverage, build, dependency hygiene, native PDF rendering, and installer tests. Intel macOS requires a separate manual qualification run.
- [ ] Browser journeys pass with `bun run test:e2e` or the Linux Chromium CI job.
- [ ] The complete Git history passes the secret scan.
- [ ] A clean checkout without `.env` or `.local/` installs frozen dependencies and passes the root checks.
- [ ] Fixtures pass installation, migration, email verification, and Workspace model setup. PDF and image extraction, export, shutdown, and restart also pass.
- [ ] The installer passes on macOS and glibc Linux. Cases include first and repeated installs, custom directories, and paths with spaces. They also include occupied ports, invalid archives or checksums, download or build failures, and upgrades that preserve data.
- [ ] Native canvas and PDF rendering pass on **each** advertised architecture. Results for x64 do not qualify arm64, or the reverse.
- [ ] Stop, backup, and restore checks pass. Upgrades preserve both generated secrets.
- [ ] The README and configuration guides match the settings and installer.

If release notes claim verified external integrations, also verify these conditions:

- [ ] Google sign-in works with real credentials.
- [ ] Verification and password-reset email reach a real inbox through the configured Cloudflare account and domain.

CI results qualify only the operating systems used by their runners. Record the runner and workflow run for each result. Installer recognition does not qualify older operating systems or other Linux distributions.

## 2. Build the release locally (optional)

```bash
bun run package:release --version vX.Y.Z
```

This command requires a clean, committed checkout. It writes `install.sh`, `document-extraction.tar.gz`, and `document-extraction.tar.gz.sha256` to `dist/release/` for review.

Without `--version`, the release name is `development`. This mode permits uncommitted changes for local installer tests and records them in release metadata. Never publish a `development` build.

## 3. Publish

1. Write release notes in `docs/releases/vX.Y.Z.md`. Include supported and tested platforms, configuration changes, migrations, known limits, and backup instructions.
2. Tag the reviewed commit and push the tag:

   ```bash
   git tag vX.Y.Z <commit>
   git push origin vX.Y.Z
   ```

3. Wait for the [release workflow](../.github/workflows/release.yml). It reruns CI on the tag, verifies `LICENSE`, builds release files, and publishes a GitHub release. If `docs/releases/<tag>.md` exists, its notes precede the generated change list. A manual workflow run produces artifacts without publishing a release.

## 4. Verify the published release

- [ ] Verify asset names and checksums.
- [ ] Run the exact README installation command against the published release in an isolated installation.
- [ ] Run `document-extraction update vX.Y.Z` from the previous release.
- [ ] If possible, repeat installation on new macOS and Linux machines. No release has completed this check yet.

Record completed and omitted tests in the [qualification log](releases/qualification-log.md).

## Good to know

- Automatic PR CI runs only for branches in this repository. Fork PRs skip these jobs. Require approval for all external contributors in GitHub Actions settings. This prevents a fork PR from bypassing the restriction through workflow changes.
- Checksums establish that a download matches its published checksum file. They do not protect against a compromised repository, workflow, or maintainer account.
- Published files remain associated with their tagged commit. Later README and documentation corrections go to `main`.
- Never commit `.scratch/` content. This includes local PRDs, issues, research, and generated CI output. CI shares reports as workflow artifacts.

## One-time steps already done

These checks occurred before the repository became public. They do not require repetition for each release:

- Added the MIT license and matching README, contribution guidance, and package metadata.
- Scanned Git history and the working tree with Gitleaks. Recorded reviewed false positives in `.gitleaksignore`.
- Kept the existing commit history. Cleanup changed current files, not historical commits or authors.
- Verified that tracked files exclude `.env`, `config.env`, local state, backups, CI reports, personal documents, and deployment-specific settings.
- Reviewed dependency licenses and the production security audit.
- Made the repository public and enabled [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-for-a-repository). Added its link to `SECURITY.md`.
- Tested fork installation with `--repo OWNER/REPO` and controlled release files.
