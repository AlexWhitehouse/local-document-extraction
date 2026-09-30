import { randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";

import { nowIso } from "./lib/ids";

export type SourceObjectPhase = "preparing" | "linked" | "deleting";
/** Who references the object: an Extraction job's retained original or a Saved Evaluation document's. */
export type SourceObjectOwnerKind = "job" | "evaluation_document";

export type SourceObjectManifestEntry = {
  object_key: string;
  workspace_id: string;
  owner_kind: SourceObjectOwnerKind;
  owner_id: string;
  phase: SourceObjectPhase;
  created_at: string;
  attempts: number;
};

/**
 * Installation-level record of every remote retained object, from before its upload until its
 * deletion is confirmed. It lives in the control database so cleanup survives removal of a
 * Workspace's product database. It holds only opaque IDs, phases and retry state.
 */
export class SourceObjectDestinationError extends Error {}

export type LocalSourceObjectManifest = {
  /** A stable random namespace that scopes this installation's objects within the bucket prefix. */
  namespace(): string;
  /**
   * Records the configured S3 destination (or none), refusing a change while objects or unfinished
   * cleanup still depend on the recorded one. Moving retained objects is not supported.
   */
  assertDestination(destination: string | null): void;
  recordedDestination(): string | null;
  prepare(input: { objectKey: string; workspaceId: string; ownerKind: SourceObjectOwnerKind; ownerId: string }): void;
  /** Records that a committed owner references the object; only a preparing object can be linked. */
  link(input: { objectKey: string }): boolean;
  markDeleting(input: { objectKey: string }): void;
  markJobDeleting(input: { workspaceId: string; jobId: string }): void;
  markOwnerDeleting(input: { workspaceId: string; ownerKind: SourceObjectOwnerKind; ownerId: string }): void;
  markWorkspaceDeleting(input: { workspaceId: string }): void;
  listDueDeletions(input: { now: string; limit: number }): SourceObjectManifestEntry[];
  listStalePreparing(input: { before: string; limit: number }): SourceObjectManifestEntry[];
  deferDeletion(input: { objectKey: string; nextAttemptAt: string; failed: boolean }): void;
  remove(input: { objectKey: string }): void;
  /** Unfinished entries: objects this installation still owns or has not finished deleting. */
  counts(): Record<SourceObjectPhase, number>;
};

export function createLocalSourceObjectManifest(database: Database): LocalSourceObjectManifest {
  database.transaction(() => {
    database.exec(MANIFEST_SCHEMA);
    // Rows written before library ownership are all job-owned; keys, phases and attempts are unchanged.
    const manifestColumns = new Set((database.query("PRAGMA table_info(source_object_manifest)").all() as Array<{ name: string }>).map((column) => column.name));
    if (manifestColumns.has("job_id")) database.exec("ALTER TABLE source_object_manifest RENAME COLUMN job_id TO owner_id");
    if (!manifestColumns.has("owner_kind")) {
      database.exec("ALTER TABLE source_object_manifest ADD COLUMN owner_kind TEXT NOT NULL DEFAULT 'job' CHECK (owner_kind IN ('job', 'evaluation_document'))");
    }
    database.exec(MANIFEST_INDEXES);
  }).immediate();
  const installationColumns = new Set((database.query("PRAGMA table_info(source_storage_installation)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!installationColumns.has("destination")) database.exec("ALTER TABLE source_storage_installation ADD COLUMN destination TEXT");
  const pendingEntries = () => (database.query("SELECT COUNT(*) AS count FROM source_object_manifest").get() as { count: number }).count;
  const recordedDestination = () =>
    (database.query("SELECT destination FROM source_storage_installation WHERE singleton = 1").get() as { destination: string | null } | null)?.destination ?? null;
  const setPhase = (where: string, ...parameters: string[]) => database.query(
    `UPDATE source_object_manifest SET phase = 'deleting', next_attempt_at = ?, updated_at = ? WHERE phase != 'deleting' AND ${where}`,
  ).run(nowIso(), nowIso(), ...parameters);

  return {
    namespace: () => database.transaction(() => {
      const row = database.query("SELECT namespace FROM source_storage_installation WHERE singleton = 1").get() as { namespace: string } | null;
      if (row) return row.namespace;
      const namespace = randomBytes(12).toString("hex");
      database.query("INSERT INTO source_storage_installation (singleton, namespace, created_at) VALUES (1, ?, ?)").run(namespace, nowIso());
      return namespace;
    }).immediate(),
    recordedDestination,
    assertDestination: (destination) => database.transaction(() => {
      const recorded = recordedDestination();
      if (recorded === destination || (!destination && !recorded)) return;
      const pending = pendingEntries();
      if (recorded && pending > 0) {
        throw new SourceObjectDestinationError(
          `S3 storage settings changed, but ${pending} retained original(s) or unfinished deletion(s) still depend on the previous destination. `
          + "Moving originals is not supported. Restore the previous endpoint, bucket, prefix and addressing style (credentials may change). "
          + "To stop keeping new originals there, set SOURCE_ORIGINAL_RETENTION_ENABLED=false instead. "
          + "To leave that destination, first delete the Documents stored there and let background cleanup finish.",
        );
      }
      if (!destination) return;
      database.query(
        `INSERT INTO source_storage_installation (singleton, namespace, created_at, destination) VALUES (1, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET destination = excluded.destination`,
      ).run(randomBytes(12).toString("hex"), nowIso(), destination);
    }).immediate(),
    prepare: ({ objectKey, workspaceId, ownerKind, ownerId }) => {
      const at = nowIso();
      database.query(
        `INSERT INTO source_object_manifest (object_key, workspace_id, owner_kind, owner_id, phase, created_at, updated_at, attempts, next_attempt_at)
         VALUES (?, ?, ?, ?, 'preparing', ?, ?, 0, NULL)`,
      ).run(objectKey, workspaceId, ownerKind, ownerId, at, at);
    },
    link: ({ objectKey }) => database.query(
      "UPDATE source_object_manifest SET phase = 'linked', updated_at = ? WHERE object_key = ? AND phase = 'preparing'",
    ).run(nowIso(), objectKey).changes > 0,
    markDeleting: ({ objectKey }) => { setPhase("object_key = ?", objectKey); },
    markJobDeleting: ({ workspaceId, jobId }) => { setPhase("workspace_id = ? AND owner_kind = 'job' AND owner_id = ?", workspaceId, jobId); },
    markOwnerDeleting: ({ workspaceId, ownerKind, ownerId }) => {
      setPhase("workspace_id = ? AND owner_kind = ? AND owner_id = ?", workspaceId, ownerKind, ownerId);
    },
    markWorkspaceDeleting: ({ workspaceId }) => { setPhase("workspace_id = ?", workspaceId); },
    listDueDeletions: ({ now, limit }) => database.query(
      `SELECT object_key, workspace_id, owner_kind, owner_id, phase, created_at, attempts FROM source_object_manifest
       WHERE phase = 'deleting' AND next_attempt_at <= ? ORDER BY next_attempt_at, object_key LIMIT ?`,
    ).all(now, limit) as SourceObjectManifestEntry[],
    listStalePreparing: ({ before, limit }) => database.query(
      `SELECT object_key, workspace_id, owner_kind, owner_id, phase, created_at, attempts FROM source_object_manifest
       WHERE phase = 'preparing' AND created_at <= ? ORDER BY created_at, object_key LIMIT ?`,
    ).all(before, limit) as SourceObjectManifestEntry[],
    deferDeletion: ({ objectKey, nextAttemptAt, failed }) => {
      database.query(
        `UPDATE source_object_manifest SET next_attempt_at = ?, attempts = attempts + ?, updated_at = ?
         WHERE object_key = ? AND phase = 'deleting'`,
      ).run(nextAttemptAt, failed ? 1 : 0, nowIso(), objectKey);
    },
    remove: ({ objectKey }) => {
      database.query("DELETE FROM source_object_manifest WHERE object_key = ? AND phase = 'deleting'").run(objectKey);
    },
    counts: () => {
      const counts: Record<SourceObjectPhase, number> = { preparing: 0, linked: 0, deleting: 0 };
      for (const row of database.query("SELECT phase, COUNT(*) AS count FROM source_object_manifest GROUP BY phase").all() as Array<{ phase: SourceObjectPhase; count: number }>) {
        counts[row.phase] = row.count;
      }
      return counts;
    },
  };
}

const MANIFEST_SCHEMA = `
  CREATE TABLE IF NOT EXISTS source_storage_installation (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    namespace TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS source_object_manifest (
    object_key TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    owner_kind TEXT NOT NULL DEFAULT 'job' CHECK (owner_kind IN ('job', 'evaluation_document')),
    owner_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('preparing', 'linked', 'deleting')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT
  );
`;

const MANIFEST_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_source_object_manifest_due
    ON source_object_manifest(next_attempt_at, object_key) WHERE phase = 'deleting';
  CREATE INDEX IF NOT EXISTS idx_source_object_manifest_preparing
    ON source_object_manifest(created_at, object_key) WHERE phase = 'preparing';
  DROP INDEX IF EXISTS idx_source_object_manifest_owner;
  CREATE INDEX IF NOT EXISTS idx_source_object_manifest_owner_kind
    ON source_object_manifest(workspace_id, owner_kind, owner_id);
`;
