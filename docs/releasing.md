# Releasing

How to publish a new version, and what has to be checked first.

A release only counts as qualified once every check below has passed **for its exact commit and pinned Bun version**. The existence of a script or CI job isn't evidence that it passed. Past results are recorded in the [qualification log](releases/qualification-log.md).

## 1. Qualify the candidate

For the commit you plan to tag:

- [ ] CI passes on all four targets (Linux x64 and arm64, macOS arm64 and x64). This covers typecheck, lint, tests, coverage, build, dependency hygiene, native PDF rendering, and the installer tests.
- [ ] The browser journeys pass (`bun run test:e2e`, or the Linux Chromium job in CI).
- [ ] The full-history secret scan passes.
- [ ] A clean copy of the tree, without your `.env` or `.local/`, installs with frozen dependencies and passes the root checks.
- [ ] Install, migration, email verification, Workspace model setup, PDF and image extraction, export, shutdown, and restart work against test fixtures.
- [ ] The installer works on macOS and glibc Linux: a first install, a repeat install, folders with spaces, custom folders, an occupied port, a bad archive or checksum, download or build failure, and an upgrade that keeps data.
- [ ] Native canvas and PDF rendering work on **each** architecture you advertise. A pass on x64 says nothing about arm64, and vice versa.
- [ ] Stop, back up, and restore work, and both generated secrets survive an upgrade.
- [ ] The README and configuration docs match the actual settings and installer.

Only needed if the release notes claim these integrations are verified:

- [ ] Google sign-in works with real credentials.
- [ ] Verification and password-reset emails arrive through a real Cloudflare account, domain, and inbox.

CI runners only qualify the OS versions they actually run. Record the runner and workflow run for each result. Don't assume older OS versions or other Linux distributions work just because the installer recognises them.

## 2. Build the release locally (optional)

```bash
bun run package:release --version vX.Y.Z
```

This needs a clean, committed checkout. It writes `install.sh`, `document-extraction.tar.gz`, and `document-extraction.tar.gz.sha256` to `dist/release/` for review.

Without `--version`, the release is named `development`. That allows uncommitted changes, which is useful for testing the installer locally, and records them in the release metadata. Never publish a `development` build.

## 3. Publish

1. Write release notes in `docs/releases/vX.Y.Z.md`. Cover the supported and tested platforms, configuration changes, migrations, known limits, and backup instructions.
2. Tag the reviewed commit and push the tag:

   ```bash
   git tag vX.Y.Z <commit>
   git push origin vX.Y.Z
   ```

3. The [release workflow](../.github/workflows/release.yml) reruns CI on the tag, checks that `LICENSE` exists, builds the release files, and publishes them to a GitHub release. Running the workflow by hand builds the files as an artifact without publishing anything.

## 4. Verify the published release

- [ ] The asset names and checksums are correct.
- [ ] The exact install command from the README works against the published release, in an isolated installation.
- [ ] `document-extraction update vX.Y.Z` works from the previous release.
- [ ] If possible, repeat the install on fresh macOS and Linux machines. This hasn't been done yet for any release.

Add what you tested, and what you didn't, to the [qualification log](releases/qualification-log.md).

## Good to know

- Checksums only prove that a download matches the published checksum file. They don't protect against a compromised repository, workflow, or maintainer account.
- Published release files stay tied to their tagged commit. Later README or documentation fixes go to `main`.
- `.scratch/` is never committed, including local PRDs, issues, research, and generated CI output. CI reports are shared as workflow artifacts.

## One-time steps already done

These were done before the repository went public and don't need repeating for each release:

- Added the MIT license, and matching README, contribution guidance, and package metadata.
- Scanned the Git history and working tree for secrets with Gitleaks, and recorded the reviewed false positives in `.gitleaksignore`.
- Kept the existing commit history. The clean-up changed the current files only, not old commits or authors.
- Checked that tracked files exclude `.env`, `config.env`, local state, backups, CI reports, personal documents, and deployment-specific settings.
- Reviewed dependency licenses and the production security audit.
- Made the repository public, turned on [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository), and linked it from `SECURITY.md`.
- Tested the `--repo OWNER/REPO` install path for forks against controlled release files.
