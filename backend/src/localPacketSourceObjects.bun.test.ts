import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createLocalSourceObjectManifest } from "./localSourceObjectManifest";
import { createLocalSourceObjectCleanup } from "./localSourceObjectCleanup";
import type { LocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { retainedObjectKey } from "./s3SourceObjectStore";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function database() { const db = new Database(":memory:"); databases.push(db); return db; }
const at = "2026-01-01T00:00:00.000Z";

test("widens the existing manifest constraint atomically without losing cleanup state or indexes", () => {
  const db = database();
  db.exec(`CREATE TABLE source_storage_installation(singleton INTEGER PRIMARY KEY,namespace TEXT NOT NULL,created_at TEXT NOT NULL,destination TEXT);
    INSERT INTO source_storage_installation VALUES(1,'existing_namespace','${at}','existing_destination');
    CREATE TABLE source_object_manifest(object_key TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,
      owner_kind TEXT NOT NULL DEFAULT 'job' CHECK(owner_kind IN ('job','evaluation_document')),owner_id TEXT NOT NULL,
      phase TEXT NOT NULL CHECK(phase IN ('preparing','linked','deleting')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT);
    CREATE INDEX idx_custom_cleanup_state ON source_object_manifest(attempts,updated_at);
    INSERT INTO source_object_manifest VALUES('job','w','job','shared_id','deleting','${at}','${at}',4,'2026-01-03T00:00:00.000Z');
    INSERT INTO source_object_manifest VALUES('evaluation','w','evaluation_document','saved','linked','${at}','${at}',0,NULL);`);
  const before = db.query("SELECT * FROM source_object_manifest ORDER BY object_key").all();
  const manifest = createLocalSourceObjectManifest(db);
  expect(db.query("SELECT * FROM source_object_manifest ORDER BY object_key").all()).toEqual(before);
  expect(manifest.namespace()).toBe("existing_namespace");
  expect(manifest.recordedDestination()).toBe("existing_destination");
  expect(db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_custom_cleanup_state'").get()).toBeTruthy();
  manifest.prepare({ objectKey: "packet", workspaceId: "w", ownerKind: "packet", ownerId: "shared_id" });
  manifest.link({ objectKey: "packet" });
  manifest.markJobDeleting({ workspaceId: "w", jobId: "shared_id" });
  expect(db.query("SELECT phase FROM source_object_manifest WHERE object_key='packet'").get()).toEqual({ phase: "linked" });
  manifest.markOwnerDeleting({ workspaceId: "w", ownerKind: "packet", ownerId: "shared_id" });
  expect(db.query("SELECT phase FROM source_object_manifest WHERE object_key='packet'").get()).toEqual({ phase: "deleting" });
  const migrated = db.query("SELECT * FROM source_object_manifest ORDER BY object_key").all();
  createLocalSourceObjectManifest(db);
  expect(db.query("SELECT * FROM source_object_manifest ORDER BY object_key").all()).toEqual(migrated);
  expect(manifest.listDueDeletions({ now: "2026-01-04T00:00:00.000Z", limit: 10 })).toMatchObject([{ object_key: "job", attempts: 4 }]);
});

test("packet upload recovery links accepted originals and deletes only abandoned attempts", async () => {
  const db = database();
  const manifest = createLocalSourceObjectManifest(db);
  manifest.prepare({ objectKey: "packet-accepted", workspaceId: "w", ownerKind: "packet", ownerId: "pkt_accepted" });
  manifest.prepare({ objectKey: "packet-abandoned", workspaceId: "w", ownerKind: "packet", ownerId: "pkt_abandoned" });
  db.query("UPDATE source_object_manifest SET created_at=?").run(at);
  let releases = 0;
  const registry = { acquire: () => ({ store: { getRetainedSourceFile: (id: string) => id === "pkt_accepted" ? { retained_object_key: "packet-accepted" } : null }, release: () => { releases++; } }) } as unknown as LocalWorkspaceProductStoreRegistry;
  const deleted: string[] = [];
  const cleanup = createLocalSourceObjectCleanup({ manifest, productStoreRegistry: registry, workspaceControl: { workspaceExists: () => true }, objectStore: { delete: async (key) => { deleted.push(key); } }, now: () => Date.now() + 3600_000 });
  await cleanup.run();
  expect(releases).toBe(2);
  expect(deleted).toEqual(["packet-abandoned"]);
  expect(cleanup.snapshot()).toMatchObject({ preparing: 0, linked: 1, deleting: 0, linkedAfterRecovery: 1 });
  manifest.markWorkspaceDeleting({ workspaceId: "w" });
  await cleanup.run();
  expect(deleted).toEqual(["packet-abandoned", "packet-accepted"]);
});

test("an unreadable packet database is not evidence that its original is orphaned", async () => {
  const db = database();
  const manifest = createLocalSourceObjectManifest(db);
  manifest.prepare({ objectKey: "packet", workspaceId: "w", ownerKind: "packet", ownerId: "pkt" });
  db.query("UPDATE source_object_manifest SET created_at=?").run(at);
  let deletes = 0;
  const registry = { acquire: () => ({ store: { getRetainedSourceFile: () => { throw new Error("unavailable"); } }, release: () => {} }) } as unknown as LocalWorkspaceProductStoreRegistry;
  await createLocalSourceObjectCleanup({ manifest, productStoreRegistry: registry, workspaceControl: { workspaceExists: () => true }, objectStore: { delete: async () => { deletes++; } }, now: () => Date.now() + 3600_000 }).run();
  expect(deletes).toBe(0);
  expect(manifest.counts()).toEqual({ preparing: 1, linked: 0, deleting: 0 });
});

test("packet originals get a distinct opaque storage path and each attempt remains unique", () => {
  const input = { prefix: "app/", namespace: "install", workspaceId: "w", jobId: "pkt_one", mimeType: "application/pdf", ownerKind: "packet" as const };
  const first = retainedObjectKey(input);
  expect(first).toMatch(/^app\/install\/workspaces\/w\/packets\/pkt_one\/[a-f0-9-]+\.pdf$/);
  expect(retainedObjectKey(input)).not.toBe(first);
  expect(retainedObjectKey({ ...input, ownerKind: "job" })).toContain("/jobs/pkt_one/");
});
