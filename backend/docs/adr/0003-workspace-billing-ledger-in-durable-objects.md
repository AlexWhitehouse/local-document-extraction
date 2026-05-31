# Workspace Billing Ledger in Durable Objects

Workspace billing needs atomic per-Workspace credit and page-limit reservation before a Document submission is accepted. We will keep Stripe IDs, plan assignment, admin overrides, and searchable billing summaries in D1, but make a separate per-Workspace Durable Object the authoritative **Billing ledger** for credit grants, purchases, spending, refunds, and plan page usage.

## Considered Options

- Keep the billing ledger only in D1: simpler reporting and admin search, but concurrent uploads can race unless every reservation path is carefully serialized through database transactions and contention grows around hot Workspaces.
- Store billing entries inside the existing Workspace product Durable Object: gives per-Workspace serialization, but couples accounting to template/job storage and makes billing harder to reason about, migrate, and audit separately.
- Use a separate Workspace billing Durable Object: gives deterministic per-Workspace serialization and a dedicated accounting boundary, at the cost of another per-Workspace store and explicit coordination with the product store when accepting submissions.

## Consequences

- A Document submission is accepted only after the Workspace billing Durable Object records a successful **Credit reservation**.
- The product store must not create an **Extraction job** unless billing reservation has succeeded.
- D1 billing summaries are projections or control data, not the authoritative ledger.
- Billing ledger migrations must tolerate lazily upgraded per-Workspace Durable Objects.
- Application admin billing views that need cross-Workspace search should read D1 summaries and drill into the ledger when exact accounting is required.
- The Workspace billing Durable Object stores append-only ledger entries as the authority and may maintain rebuildable summaries for fast balance and usage reads.
