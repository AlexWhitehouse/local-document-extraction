import type { Database, SQLQueryBindings } from "bun:sqlite";
import { randomBytes } from "node:crypto";

import { nowIso } from "./lib/ids";
import type { LocalSourceObjectManifest, SourceObjectOwnerKind } from "./localSourceObjectManifest";

export type SourceObjectMoveStatus = "running" | "completed" | "cancelled" | "stopped";

export type SourceObjectMove = {
  id: string;
  workspace_id: string;
  target_id: string;
  status: SourceObjectMoveStatus;
  total: number;
  moved: number;
  bytes_moved: number;
  failed: number;
  waiting: number;
  pass: number;
  cursor_kind: string | null;
  cursor_id: string | null;
  attempts: number;
  next_attempt_at: string;
  message: string | null;
  started_by_user_id: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type SourceObjectMoveFailure = {
  owner_kind: SourceObjectOwnerKind;
  owner_id: string;
  name: string | null;
  message: string;
};

/**
 * One original in flight. Its row commits with the new copy's manifest entry, before the upload, and goes
 * once the owner's reference is settled, so a restart can tell which copy the owner kept.
 */
export type SourceObjectMoveItem = {
  new_key: string;
  move_id: string;
  workspace_id: string;
  owner_kind: SourceObjectOwnerKind;
  owner_id: string;
  /** The remote original being replaced; null for a local original. */
  old_key: string | null;
  /** The local original being replaced; null for a remote original. */
  old_local_key: string | null;
};

export const SOURCE_OBJECT_MOVE_ITEMS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS source_object_move_items (
    new_key TEXT PRIMARY KEY,
    move_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    old_key TEXT,
    old_local_key TEXT,
    created_at TEXT NOT NULL
  );
`;

const SCHEMA = `
  ${SOURCE_OBJECT_MOVE_ITEMS_SCHEMA}
  CREATE TABLE IF NOT EXISTS source_object_moves (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'cancelled', 'stopped')),
    total INTEGER NOT NULL,
    moved INTEGER NOT NULL DEFAULT 0,
    bytes_moved INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    waiting INTEGER NOT NULL DEFAULT 0,
    pass INTEGER NOT NULL DEFAULT 1,
    cursor_kind TEXT,
    cursor_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    message TEXT,
    started_by_user_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_source_object_moves_running
    ON source_object_moves(workspace_id) WHERE status = 'running';
  CREATE INDEX IF NOT EXISTS idx_source_object_moves_workspace ON source_object_moves(workspace_id, started_at);
  CREATE TABLE IF NOT EXISTS source_object_move_failures (
    move_id TEXT NOT NULL,
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    name TEXT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (move_id, owner_kind, owner_id)
  );
`;

export class SourceObjectMoveRunningError extends Error {}

export type LocalSourceObjectMoves = {
  /** Starts a move, replacing the Workspace's previous report. Throws while another move is running. */
  start(input: { workspaceId: string; targetId: string; total: number; userId: string }): SourceObjectMove;
  /** The running move, or the most recent finished one. */
  latest(workspaceId: string): SourceObjectMove | null;
  get(moveId: string): SourceObjectMove | null;
  failures(moveId: string, limit: number): SourceObjectMoveFailure[];
  hasFailed(input: { moveId: string; ownerKind: SourceObjectOwnerKind; ownerId: string }): boolean;
  cancel(workspaceId: string): boolean;
  listDue(input: { now: string; limit: number }): SourceObjectMove[];
  /** Records one original's outcome and advances the cursor past it; an original that finished after a cancel still counts. */
  advance(input: {
    moveId: string;
    cursor: { kind: string; id: string };
    outcome:
      | { kind: "moved"; bytes: number }
      | { kind: "skipped" }
      | { kind: "waiting" }
      | { kind: "failed"; failure: Omit<SourceObjectMoveFailure, "owner_kind" | "owner_id"> };
    ownerKind: SourceObjectOwnerKind;
    ownerId: string;
  }): void;
  /** Starts another pass after a delay, for originals that were busy or unreachable. */
  repeat(input: { moveId: string; nextAttemptAt: string }): void;
  /** Pauses after an outage; the cursor stays on the original that could not move. */
  pause(input: { moveId: string; nextAttemptAt: string; message: string }): void;
  finish(input: { moveId: string; status: "completed" | "stopped"; message?: string | null }): void;
  /** Commits the in-flight record and the new copy's manifest entry together. */
  beginItem(input: SourceObjectMoveItem & { destinationId: string; byteSize: number }): void;
  listItems(limit: number): SourceObjectMoveItem[];
  /** Drops an in-flight record, optionally handing copies to cleanup in the same transaction. */
  endItem(input: { newKey: string; release?: Array<{ objectKey: string; notBefore?: string }>; link?: string }): void;
};

export function createLocalSourceObjectMoves({
  database,
  manifest,
}: {
  database: Database;
  manifest: Pick<LocalSourceObjectManifest, "prepare" | "link" | "markDeleting">;
}): LocalSourceObjectMoves {
  database.exec(SCHEMA);

  const get = (moveId: string) =>
    database.query<SourceObjectMove, SQLQueryBindings[]>("SELECT * FROM source_object_moves WHERE id = ?").get(moveId);

  const update = (moveId: string, assignments: string, ...parameters: Array<string | number | null>) =>
    database
      .query(`UPDATE source_object_moves SET ${assignments}, updated_at = ? WHERE id = ? AND status = 'running'`)
      .run(...parameters, nowIso(), moveId).changes > 0;

  return {
    start: ({ workspaceId, targetId, total, userId }) =>
      database
        .transaction(() => {
          if (
            database
              .query("SELECT 1 FROM source_object_moves WHERE workspace_id = ? AND status = 'running'")
              .get(workspaceId)
          )
            throw new SourceObjectMoveRunningError("A move is already running");

          // Only the latest report is kept: the next move replaces it.
          database
            .query(
              "DELETE FROM source_object_move_failures WHERE move_id IN (SELECT id FROM source_object_moves WHERE workspace_id = ?)",
            )
            .run(workspaceId);
          database.query("DELETE FROM source_object_moves WHERE workspace_id = ?").run(workspaceId);
          const id = `mov_${randomBytes(12).toString("hex")}`;
          const at = nowIso();
          database
            .query(
              `INSERT INTO source_object_moves (id, workspace_id, target_id, status, total, next_attempt_at, started_by_user_id, started_at, updated_at)
               VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
            )
            .run(id, workspaceId, targetId, total, at, userId, at, at);

          return get(id)!;
        })
        .immediate(),
    latest: (workspaceId) =>
      database
        .query<SourceObjectMove, SQLQueryBindings[]>(
          "SELECT * FROM source_object_moves WHERE workspace_id = ? ORDER BY status = 'running' DESC, started_at DESC LIMIT 1",
        )
        .get(workspaceId),
    get,
    failures: (moveId, limit) =>
      database
        .query<SourceObjectMoveFailure, SQLQueryBindings[]>(
          "SELECT owner_kind, owner_id, name, message FROM source_object_move_failures WHERE move_id = ? ORDER BY created_at DESC, owner_id LIMIT ?",
        )
        .all(moveId, limit),
    hasFailed: ({ moveId, ownerKind, ownerId }) =>
      Boolean(
        database
          .query("SELECT 1 FROM source_object_move_failures WHERE move_id = ? AND owner_kind = ? AND owner_id = ?")
          .get(moveId, ownerKind, ownerId),
      ),
    cancel: (workspaceId) =>
      database
        .query(
          "UPDATE source_object_moves SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE workspace_id = ? AND status = 'running'",
        )
        .run(nowIso(), nowIso(), workspaceId).changes > 0,
    listDue: ({ now, limit }) =>
      database
        .query<SourceObjectMove, SQLQueryBindings[]>(
          "SELECT * FROM source_object_moves WHERE status = 'running' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?",
        )
        .all(now, limit),
    advance: ({ moveId, cursor, outcome, ownerKind, ownerId }) =>
      database.transaction(() => {
        const counters =
          outcome.kind === "moved"
            ? "moved = moved + 1, bytes_moved = bytes_moved + ?,"
            : outcome.kind === "waiting"
              ? "waiting = waiting + 1,"
              : outcome.kind === "failed"
                ? "failed = failed + 1,"
                : "";

        database
          .query(
            `UPDATE source_object_moves SET ${counters} cursor_kind = ?, cursor_id = ?, attempts = 0,
             message = CASE WHEN status = 'running' THEN NULL ELSE message END, updated_at = ? WHERE id = ?`,
          )
          .run(...(outcome.kind === "moved" ? [outcome.bytes] : []), cursor.kind, cursor.id, nowIso(), moveId);

        if (outcome.kind === "failed")
          database
            .query(
              "INSERT OR REPLACE INTO source_object_move_failures (move_id, owner_kind, owner_id, name, message, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .run(moveId, ownerKind, ownerId, outcome.failure.name, outcome.failure.message, nowIso());
      })(),
    repeat: ({ moveId, nextAttemptAt }) => {
      update(
        moveId,
        "pass = pass + 1, waiting = 0, cursor_kind = NULL, cursor_id = NULL, next_attempt_at = ?",
        nextAttemptAt,
      );
    },
    pause: ({ moveId, nextAttemptAt, message }) => {
      update(moveId, "attempts = attempts + 1, next_attempt_at = ?, message = ?", nextAttemptAt, message);
    },
    finish: ({ moveId, status, message = null }) => {
      update(moveId, "status = ?, finished_at = ?, message = COALESCE(?, message)", status, nowIso(), message);
    },
    beginItem: ({ destinationId, byteSize, ...item }) =>
      database.transaction(() => {
        database
          .query(
            `INSERT INTO source_object_move_items (new_key, move_id, workspace_id, owner_kind, owner_id, old_key, old_local_key, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            item.new_key,
            item.move_id,
            item.workspace_id,
            item.owner_kind,
            item.owner_id,
            item.old_key,
            item.old_local_key,
            nowIso(),
          );
        manifest.prepare({
          objectKey: item.new_key,
          destinationId,
          workspaceId: item.workspace_id,
          ownerKind: item.owner_kind,
          ownerId: item.owner_id,
          byteSize,
        });
      })(),
    listItems: (limit) =>
      database
        .query<SourceObjectMoveItem, SQLQueryBindings[]>(
          "SELECT new_key, move_id, workspace_id, owner_kind, owner_id, old_key, old_local_key FROM source_object_move_items ORDER BY created_at LIMIT ?",
        )
        .all(limit),
    endItem: ({ newKey, release = [], link }) =>
      database.transaction(() => {
        if (link) manifest.link({ objectKey: link });

        for (const entry of release) manifest.markDeleting(entry);
        database.query("DELETE FROM source_object_move_items WHERE new_key = ?").run(newKey);
      })(),
  };
}
