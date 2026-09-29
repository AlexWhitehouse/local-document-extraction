# Security

## Reporting a vulnerability

Please report vulnerabilities privately using the repository's [vulnerability reporting form](https://github.com/AlexWhitehouse/local-document-extraction/security/advisories/new) (**Security → Report a vulnerability**).

Don't put exploit details, credentials, account links, or real documents in a public issue. If private reporting isn't available to you, open an issue asking for a private contact, without describing the vulnerability.

A helpful report includes:

- the version or commit, operating system, and chip type
- steps to reproduce, using made-up data
- what you expected to happen, what actually happened, and the impact

Remove configuration values, tokens, cookies, database contents, and document data before sending.

There's no fixed support period or guaranteed response time yet. Please use the latest release, and read its notes before upgrading.

## Running the app safely

- **Network.** The app only listens on your own machine by default. Making it reachable from elsewhere needs deliberate setup: a proxy with HTTPS, the right addresses, and trusted proxy headers. See [Access from other machines](docs/configuration.md#access-from-other-machines).
- **Email.** By default, account emails aren't sent. Verification and password-reset links are saved on the machine, so whoever runs the machine can use them. If other people use the app, set up real email delivery.
- **Your model provider sees your documents.** Documents and extraction instructions are sent to each Workspace's chosen model gateway, and that provider's data policy applies. Workspace owners and admins can point the gateway at any address, including ones on your private network, so only give those roles to people you trust.
- **Data and backups are sensitive.** The data folder, logs, and backups contain accounts, documents, and the keys that decrypt saved credentials. Keep them private and never publish them. Back up the encryption keys together with the databases.
- **No shared default secrets.** The session-signing secret and the credential encryption key are generated separately for each installation.

## Before publishing a fork

Scan the full Git history for secrets before making a repository public. Deleting a file or adding it to `.gitignore` doesn't remove it from earlier commits. If a real secret was ever committed, revoke it first, then decide whether to rewrite history.

The [release checklist](docs/releasing.md) lists the checks run before each public release.
