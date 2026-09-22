# Portable Local Installation Configuration

The public distribution must start without a maintainer account, deployment domain,
model endpoint, or private credential. A shared validated configuration loader owns
deployment settings for startup, migration, and installation checks. The frontend
reads only public authentication capabilities and upload limits from `/v1/config`.

This extends ADR-0005: local email capture remains the default, and an explicit
Cloudflare Email REST transport is available for actual account-email delivery.
Sender identity belongs to deployment configuration and is passed to the code-owned
templates. Delivery attempts are awaited and bounded; external mode does not also
capture usable account links locally. Workspace invitations remain in-app.

Email/password login and registration default on. Email verification defaults off
and can be required with `AUTH_REQUIRE_EMAIL_VERIFICATION=true`. This default was
revised on 2026-09-23 to allow immediate account access for a local installation;
earlier releases required verification by default. Explicit installation settings
are preserved during upgrades. Google OAuth defaults off and requires explicit
enablement plus a complete credential pair.
Registration controls apply to password and Google account creation. At least one
login method must remain enabled. Generic OIDC and SAML are outside this decision.
Administrator email bootstrap applies when accounts are created; operators must
establish access before closing registration. The disk-generated auth secret remains
the installation's signing secret.

The default listener remains loopback. The browser-facing origin, optional trusted
origins, and explicitly trusted proxy IP headers are configurable. No personal
origin or proxy-provider header is trusted by default. Standard development loopback
origins are allowed when the application itself has a loopback origin.

Payload settings are validated with their admission budgets. Internal parser,
protocol, and fixed safety limits remain code-owned when independent tuning would
break memory assumptions or public contracts. Local analytics can be disabled.

Source checkouts default to `.local/`; installers separate versioned application
releases, private configuration, and persistent state. Runtime state is owner-only.
Upgrades preserve state and machine secrets, and backups must include the matching
databases and keys. No automatic downgrade or database rollback is promised.

ADR-0008 remains authoritative for model configuration: gateway URL, model,
capabilities, and encrypted outbound credentials belong to each Workspace. The
release configuration surface must not revive global model defaults or import a
maintainer's legacy configuration.
