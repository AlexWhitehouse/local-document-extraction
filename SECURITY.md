# Security

## Reporting a vulnerability

Report vulnerabilities through the private [vulnerability reporting form](https://github.com/AlexWhitehouse/local-document-extraction/security/advisories/new). In GitHub, select **Security → Report a vulnerability**.

Do not put exploit details, credentials, account links, or real documents in a public issue. If private reporting is unavailable, open an issue to request a private contact. Do not describe the vulnerability in that issue.

Include this information in a private report:

- The version or commit, operating system, and processor type.
- Steps to reproduce the problem with synthetic data.
- The expected result, actual result, and impact.

Before sending the report, remove configuration values, tokens, cookies, database contents, and document data.

There is no fixed support period or guaranteed response time. Use the latest release. Before an upgrade, read its release notes.

## Running the app safely

- **Network.** By default, the app listens only on the local machine. Remote access requires explicit setup. Configure an HTTPS proxy, correct addresses, and trusted proxy headers. See [Access from other machines](docs/configuration.md#access-from-other-machines).
- **Email.** By default, the app does not send account email. It saves verification and password-reset links on the machine. The machine operator can use these links. If other people use the app, configure email delivery.
- **Your model provider sees your documents.** The app sends documents and extraction instructions to the Workspace's model gateway. The provider's data policy applies. Owners and admins can select any gateway address, including private network addresses. Give these roles only to trusted people.
- **Data and backups are sensitive.** Data folders, logs, and backups contain accounts, documents, and keys for saved credentials. Keep them private. Never publish them. Back up encryption keys with their matching databases.
- **No shared default secrets.** Each installation creates its own session-signing secret and credential encryption key.

## Before publishing a fork

Before making a repository public, scan its complete Git history for secrets. File deletion and `.gitignore` do not remove content from earlier commits. If a secret was committed, revoke it first. Then decide whether to rewrite the history.

The [release checklist](docs/releasing.md) lists the checks for each public release.
