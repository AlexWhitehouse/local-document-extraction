# Workspace Product Data in Durable Objects

Workspace-scoped extraction data can exceed one global D1 database's 10 GB storage limit even when each individual Workspace remains below that limit. We will keep **Workspace control data** in global D1, and make one SQLite-backed Durable Object per Workspace the authoritative store for **Workspace product data**. Customer-facing workspace APIs read and write through the Workspace's Durable Object, Workspace job lifecycle changes are pushed through Workspace-scoped WebSockets, and global analytics are emitted to Workers Analytics Engine rather than duplicated into D1.

## Considered Options

- Keep all data in one D1 database: simplest operationally, but caps the whole application at one D1 database's storage limit and concentrates throughput through one database.
- Use one D1 database per Workspace: matches the desired storage boundary, but runtime access from Workers is binding-oriented and creates operational friction for dynamic per-Workspace routing.
- Use one Durable Object per Workspace: gives deterministic runtime routing by Workspace ID and isolates storage/throughput per Workspace, at the cost of per-Workspace single-threading and per-object schema migration.
- Maintain a global D1 product-data projection: would support direct operational SQL, but adds write amplification, retry/reconciliation paths, D1 growth, and a second consistency surface.

## Consequences

- A single Workspace is still bounded by the per-object SQLite storage limit; the current scale model is many Workspaces, not one unbounded Workspace.
- Each Workspace product store serializes its own product-data operations, so expensive processing must stay outside the Durable Object.
- Schema changes for Workspace product data must tolerate lazily upgraded Workspace stores.
- Workspace product stores are upgraded lazily through versioned, idempotent SQLite migrations when each Durable Object wakes.
- The initial cutover does not require automated migration of existing Workspace product data because production usage is limited to the operator during this decision.
- Legacy global D1 product tables are retained during the initial cutover for rollback/archive, but product code stops writing authoritative data to them.
- The Workspace Durable Object exposes domain-specific RPC methods rather than a generic SQL or query interface.
- Workspace Durable Objects are addressed deterministically by Workspace ID.
- Workspace Durable Objects terminate Workspace-scoped WebSockets using the hibernation API and publish job lifecycle notifications after durable state changes.
- The Worker validates WebSocket upgrade requests and session-based Workspace access before proxying live update connections to the Workspace Durable Object.
- The SPA connects to `GET /v1/workspaces/:workspaceId/live` for session-only Workspace live updates.
- Workspace live update sockets use serialized attachments for minimal connection state so hibernated objects can rebuild in-memory connection maps after waking.
- Workspace live update messages use a versioned batch envelope so multiple logical updates can be sent in one WebSocket frame.
- Workspace live update job events include job summary fields such as job ID, status, template ID, template version, source name, timestamps, and error code, but not extraction answers or evidence.
- Workspace Durable Object constructors must stay lightweight because hibernated WebSockets cause the constructor to run again when the object wakes.
- Workspace live updates avoid application-level heartbeat timers; protocol ping/pong and optional hibernation auto-responses are preferred so idle objects can hibernate.
- Clients revalidate over HTTP after reconnecting because WebSocket notifications are not durable history.
- Workers and Workflows emit Workers Analytics Engine events after successful Workspace Durable Object operations; analytics emission is not part of the authoritative state mutation.
- Cross-Workspace analytics must use Workers Analytics Engine events or later exports rather than direct SQL over authoritative product rows.
- The first migration does not add a global D1 projection of Workspace product data.
