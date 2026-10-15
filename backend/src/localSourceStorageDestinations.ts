import type { Database, SQLQueryBindings } from "bun:sqlite";
import { randomBytes } from "node:crypto";

import { isJsonObject, isString, parseJson } from "../../shared/json";
import type {
  LocalSourceStorageConfiguration,
  S3SourceStorageConfiguration,
  S3SourceStorageLocation,
  SourceStorageProvider,
} from "./localConfiguration";
import { nowIso } from "./lib/ids";
import { sourceObjectDestination } from "./s3SourceObjectStore";

export type SourceStorageCredentials = Pick<
  S3SourceStorageConfiguration,
  "accessKeyId" | "secretAccessKey" | "sessionToken"
>;

/** Encrypts each Workspace bucket's credentials under its destination ID. */
export type SourceStorageCredentialVault = {
  encrypt(destinationId: string, value: string): string;
  decrypt(destinationId: string, envelope: string): string;
};

/** A Workspace-owned S3-compatible bucket. Its location never changes; only its credentials can. */
export type WorkspaceSourceStorageDestination = {
  id: string;
  workspaceId: string;
  location: S3SourceStorageLocation;
  accessKeyIdHint: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  retiredAt: string | null;
};

export type LocalSourceStorageDestinations = {
  /** The destination new uploads of this Workspace use, or null to use installation storage. */
  current(workspaceId: string): WorkspaceSourceStorageDestination | null;
  /** Any destination, including retired ones whose objects are still readable and deletable. */
  get(destinationId: string): WorkspaceSourceStorageDestination | null;
  /** Decrypts a destination's credentials; throws when the machine secret is unavailable. */
  configuration(destination: WorkspaceSourceStorageDestination): S3SourceStorageConfiguration;
  /**
   * Saves the Workspace's bucket. A new location retires the current destination, which keeps serving
   * its existing objects. Null credentials keep the current ones. Returns null on a stale revision.
   */
  save(input: {
    workspaceId: string;
    location: S3SourceStorageLocation;
    credentials: SourceStorageCredentials | null;
    expectedRevision: number | null;
  }): WorkspaceSourceStorageDestination | null;
  /** Returns the Workspace to installation storage; false on a stale revision. */
  clear(input: { workspaceId: string; expectedRevision: number }): boolean;
  /** Erasure: no new uploads, but cleanup can still delete every object the Workspace left behind. */
  retireWorkspace(workspaceId: string): void;
  /** Retired destinations of this Workspace that some unfinished manifest entry still depends on. */
  previousLocationsPending(workspaceId: string, pending: Map<string, number>): number;
  /** Removes retired destinations, and their credentials, that no object depends on any more. */
  pruneRetired(input: { pending: Map<string, number>; retiredBefore: string }): number;
};

/** Where one Workspace's new originals go, after applying its own bucket, if any. */
export type WorkspaceSourceStorage = {
  provider: SourceStorageProvider;
  originalRetentionEnabled: boolean;
  location: "installation" | "workspace";
};

export type WorkspaceSourceStorageResolver = (workspaceId: string) => WorkspaceSourceStorage;

/**
 * A Workspace with its own bucket retains originals there under the installation's retention switch.
 * With Workspace storage turned off, saved buckets are ignored for new uploads but keep serving reads.
 */
export function workspaceSourceStorageResolver(
  installation: LocalSourceStorageConfiguration,
  destinations?: Pick<LocalSourceStorageDestinations, "current">,
): WorkspaceSourceStorageResolver {
  return (workspaceId) =>
    installation.workspaceOverridesEnabled && destinations?.current(workspaceId)
      ? { provider: "s3", originalRetentionEnabled: installation.originalRetentionEnabled, location: "workspace" }
      : {
          provider: installation.provider,
          originalRetentionEnabled: installation.originalRetentionEnabled,
          location: "installation",
        };
}

type DestinationRow = {
  id: string;
  workspace_id: string;
  endpoint: string | null;
  region: string;
  bucket: string;
  prefix: string;
  force_path_style: number;
  credential_ciphertext: string;
  access_key_id_hint: string;
  revision: number;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS source_storage_destinations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    endpoint TEXT,
    region TEXT NOT NULL,
    bucket TEXT NOT NULL,
    prefix TEXT NOT NULL,
    force_path_style INTEGER NOT NULL CHECK (force_path_style IN (0, 1)),
    credential_ciphertext TEXT NOT NULL,
    access_key_id_hint TEXT NOT NULL,
    revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    retired_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_source_storage_destinations_current
    ON source_storage_destinations(workspace_id) WHERE retired_at IS NULL;
`;

/**
 * Workspace-owned buckets live in the control database, beside the object manifest, so a destination
 * and its credentials outlive the Workspace's product data until cleanup has deleted every object in it.
 */
export function createLocalSourceStorageDestinations({
  database,
  vault,
}: {
  database: Database;
  vault: SourceStorageCredentialVault;
}): LocalSourceStorageDestinations {
  database.exec(SCHEMA);

  const select = (where: string, ...parameters: string[]) =>
    database
      .query<DestinationRow, SQLQueryBindings[]>(`SELECT * FROM source_storage_destinations WHERE ${where}`)
      .get(...parameters);

  const currentRow = (workspaceId: string) => select("workspace_id = ? AND retired_at IS NULL", workspaceId);

  const credentialsOf = (row: DestinationRow): SourceStorageCredentials =>
    parseCredentials(vault.decrypt(row.id, row.credential_ciphertext));

  const insert = (input: {
    workspaceId: string;
    location: S3SourceStorageLocation;
    credentials: SourceStorageCredentials;
    revision: number;
    at: string;
  }) => {
    const id = `dst_${randomBytes(12).toString("hex")}`;
    database
      .query(
        `INSERT INTO source_storage_destinations
         (id, workspace_id, endpoint, region, bucket, prefix, force_path_style, credential_ciphertext, access_key_id_hint, revision, created_at, updated_at, retired_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        input.workspaceId,
        input.location.endpoint ?? null,
        input.location.region,
        input.location.bucket,
        input.location.prefix,
        input.location.forcePathStyle ? 1 : 0,
        vault.encrypt(id, JSON.stringify(input.credentials)),
        accessKeyIdHint(input.credentials.accessKeyId),
        input.revision,
        input.at,
        input.at,
      );

    return id;
  };

  const retire = (where: string, ...parameters: string[]) =>
    database
      .query(`UPDATE source_storage_destinations SET retired_at = ? WHERE retired_at IS NULL AND ${where}`)
      .run(nowIso(), ...parameters).changes > 0;

  return {
    current: (workspaceId) => publicDestination(currentRow(workspaceId)),
    get: (destinationId) => publicDestination(select("id = ?", destinationId)),
    configuration: (destination) => {
      const row = select("id = ?", destination.id);

      if (!row) throw new Error("The storage destination no longer exists");

      return { ...destination.location, ...credentialsOf(row) };
    },
    save: ({ workspaceId, location, credentials, expectedRevision }) =>
      database
        .transaction(() => {
          const current = currentRow(workspaceId);

          if ((current?.revision ?? null) !== expectedRevision) return null;
          const at = nowIso();

          if (current && sourceObjectDestination(rowLocation(current)) === sourceObjectDestination(location)) {
            const replacement = credentials ?? credentialsOf(current);
            database
              .query(
                `UPDATE source_storage_destinations SET credential_ciphertext = ?, access_key_id_hint = ?, revision = ?, updated_at = ?
                 WHERE id = ?`,
              )
              .run(
                vault.encrypt(current.id, JSON.stringify(replacement)),
                accessKeyIdHint(replacement.accessKeyId),
                current.revision + 1,
                at,
                current.id,
              );

            return publicDestination(select("id = ?", current.id));
          }

          const carried = credentials ?? (current ? credentialsOf(current) : null);

          if (!carried) throw new Error("Credentials are required for a new storage location");

          if (current) retire("id = ?", current.id);
          const revision = latestRevision(database, workspaceId) + 1;

          return publicDestination(
            select("id = ?", insert({ workspaceId, location, credentials: carried, revision, at })),
          );
        })
        .immediate(),
    clear: ({ workspaceId, expectedRevision }) =>
      database
        .transaction(() => {
          const current = currentRow(workspaceId);

          if (!current || current.revision !== expectedRevision) return false;

          return retire("id = ?", current.id);
        })
        .immediate(),
    retireWorkspace: (workspaceId) => {
      retire("workspace_id = ?", workspaceId);
    },
    previousLocationsPending: (workspaceId, pending) =>
      database
        .query<{ id: string }, SQLQueryBindings[]>(
          "SELECT id FROM source_storage_destinations WHERE workspace_id = ? AND retired_at IS NOT NULL",
        )
        .all(workspaceId)
        .filter((row) => (pending.get(row.id) ?? 0) > 0).length,
    pruneRetired: ({ pending, retiredBefore }) => {
      let pruned = 0;

      for (const row of database
        .query<{ id: string }, SQLQueryBindings[]>(
          "SELECT id FROM source_storage_destinations WHERE retired_at IS NOT NULL AND retired_at <= ?",
        )
        .all(retiredBefore)) {
        if (pending.get(row.id)) continue;
        pruned += database.query("DELETE FROM source_storage_destinations WHERE id = ?").run(row.id).changes;
      }

      return pruned;
    },
  };
}

function latestRevision(database: Database, workspaceId: string): number {
  return (
    database
      .query<{ revision: number | null }, SQLQueryBindings[]>(
        "SELECT MAX(revision) AS revision FROM source_storage_destinations WHERE workspace_id = ?",
      )
      .get(workspaceId)?.revision ?? 0
  );
}

function rowLocation(row: DestinationRow): S3SourceStorageLocation {
  const location: S3SourceStorageLocation = {
    bucket: row.bucket,
    region: row.region,
    prefix: row.prefix,
    forcePathStyle: row.force_path_style === 1,
  };

  if (row.endpoint) location.endpoint = row.endpoint;

  return location;
}

function publicDestination(row: DestinationRow | null): WorkspaceSourceStorageDestination | null {
  if (!row) return null;

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    location: rowLocation(row),
    accessKeyIdHint: row.access_key_id_hint,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    retiredAt: row.retired_at,
  };
}

/** Enough of the key ID for a person to recognise it; the rest, and the secret, never leave the server. */
function accessKeyIdHint(accessKeyId: string): string {
  return accessKeyId.length > 8 ? `…${accessKeyId.slice(-4)}` : "…";
}

function parseCredentials(value: string): SourceStorageCredentials {
  const parsed = parseJson(value);

  if (!isJsonObject(parsed) || !isString(parsed.accessKeyId) || !isString(parsed.secretAccessKey))
    throw new Error("Stored storage credentials are malformed");

  const credentials: SourceStorageCredentials = {
    accessKeyId: parsed.accessKeyId,
    secretAccessKey: parsed.secretAccessKey,
  };

  if (isString(parsed.sessionToken)) credentials.sessionToken = parsed.sessionToken;

  return credentials;
}
