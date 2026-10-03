# Portable Local Installation Configuration

The public distribution must start without a maintainer account, deployment domain, model endpoint, or private credential. One shared loader validates deployment settings for startup, migration, and installation checks. The frontend reads only public authentication capabilities and upload limits from `/v1/config`.

This decision extends ADR-0005. Local email capture remains the default. Cloudflare Email REST transport is an explicit option for account-email delivery. Deployment configuration supplies the sender identity to templates in the code. The application waits for each bounded delivery attempt. External delivery does not also capture usable account links locally.

Workspace invitations remain in the app. Email/password login and registration are enabled by default. Email verification is disabled by default. `AUTH_REQUIRE_EMAIL_VERIFICATION=true` makes verification mandatory.

The verification default changed on 2026-09-23 to permit immediate account access in local installations. Earlier releases required verification by default. Upgrades keep explicit installation settings. Google OAuth is disabled by default. It requires explicit enablement and a complete credential pair.

Registration controls apply to password and Google account creation. At least one login method must remain enabled. This decision does not include generic OIDC or SAML. Administrator email bootstrap applies when accounts are created. Operators must establish access before they close registration. The generated authentication secret on disk remains the installation's signing secret.

The default listener uses loopback. Operators can configure the browser-facing origin, additional trusted origins, and trusted proxy IP headers. No personal origin or proxy-provider header is trusted by default. Standard development loopback origins are permitted when the application itself uses a loopback origin.

The loader validates payload settings against admission budgets. Parser, protocol, and fixed safety limits stay in code where separate adjustment would invalidate memory assumptions or public contracts. Operators can disable local analytics.

Source checkouts use `.local/` by default. Installers separate versioned releases, private configuration, and persistent state. Only the owner can access runtime state.

First-time terminal installs ask conditional questions for optional public-origin, login, and email-provider settings. The installer hides secrets and validates answers before saving private configuration. Unattended installs use documented defaults or a prepared configuration file. Existing configuration always skips the questions.

Upgrades keep state and machine secrets. Backups must include the matching databases and keys. Automatic downgrade and database rollback are not guaranteed.

ADR-0008 controls model configuration. Each Workspace owns its gateway URL, model, capabilities, and encrypted outbound credentials. Release configuration must not restore global model defaults or import a maintainer's legacy configuration.
