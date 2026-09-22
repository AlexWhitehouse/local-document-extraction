# Security

## Reporting a vulnerability

Use the repository's [private vulnerability reporting form](https://github.com/AlexWhitehouse/local-document-extraction/security/advisories/new) (**Security → Report a vulnerability**). Do not post exploit details, credentials, account action links, or real documents in a public issue. If private reporting is unavailable, open an issue asking the maintainers to provide a private contact channel without disclosing the vulnerability itself.

Include the affected version/commit, OS and architecture, reproduction steps using synthetic data, expected behavior, observed behavior, and impact. Redact configuration values, tokens, cookies, database contents, and document data.

Private reporting is enabled for this repository; the [release checklist](docs/releasing.md) records publication checks. There is no published security support lifetime or promised response time yet. Use the latest qualified release and review its notes before upgrades.

## Deployment boundaries

- The default listener is loopback. Remote access requires deliberate network, TLS, origin, and trusted-proxy configuration.
- Local email mode records usable verification/reset links for the person operating the machine. Use real email delivery for users who do not control the host.
- Documents and extraction instructions are sent to each Workspace's selected gateway. A remote provider's data policy applies to that traffic. Workspace owners/admins can configure private-network endpoints and should be trusted accordingly.
- State, logs, and backups contain sensitive data. Keep them private and outside published artifacts. Retain matching encryption secrets when backing up databases.
- The auth secret and gateway-credential encryption key are generated per installation. There is no shared default credential.

Run full-history secret scanning before publishing an existing repository. Removing a file or adding an ignore rule does not remove old commits. If a real secret was exposed, revoke it before considering history cleanup.
