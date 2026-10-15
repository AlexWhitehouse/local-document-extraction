import type { S3SourceStorageConfiguration } from "./localConfiguration";
import { INSTALLATION_DESTINATION_ID, type LocalSourceObjectManifest } from "./localSourceObjectManifest";
import type { LocalSourceStorageDestinations } from "./localSourceStorageDestinations";
import {
  createS3SourceObjectStore,
  evaluationDocumentObjectKey,
  retainedObjectKey,
  SourceObjectUnavailableError,
  type SourceObjectStore,
} from "./s3SourceObjectStore";

/** One bucket a new original can be written to, fixed for the whole upload attempt. */
export type RetainedObjectDestination = {
  id: string;
  store: Pick<SourceObjectStore, "put">;
  keyFor(input: { workspaceId: string; jobId: string; mimeType: string; ownerKind?: "job" | "packet" }): string;
  documentKeyFor(input: { workspaceId: string; documentId: string; mimeType: string }): string;
};

/** Remote retained originals: each object is read and deleted in the bucket its upload was prepared for. */
export type LocalRetainedSourceObjects = {
  store: Pick<SourceObjectStore, "open">;
  manifest: Pick<
    LocalSourceObjectManifest,
    "prepare" | "link" | "markDeleting" | "markJobDeleting" | "markOwnerDeleting" | "markWorkspaceDeleting"
  >;
  /** Where this Workspace's new originals go, or null when it has no remote storage. */
  destinationFor(workspaceId: string): RetainedObjectDestination | null;
  /** The bucket an existing object lives in, so derived originals can stay beside it. */
  destinationOf(objectKey: string): RetainedObjectDestination | null;
  /**
   * Reserves a remote read slot in the object's bucket, so one slow bucket cannot use up reads for
   * every Workspace. Returns null when that bucket is at its limit.
   */
  acquireRead(objectKey: string): (() => void) | null;
};

export type SourceObjectStoreFactory = (configuration: S3SourceStorageConfiguration) => SourceObjectStore;

const DEFAULT_MAX_CONCURRENT_READS = 8;

/**
 * Routes retained originals between the installation's bucket and Workspace-owned buckets. Clients are
 * cached per destination and rebuilt when its credentials change.
 */
export function createLocalRetainedSourceObjects({
  manifest,
  destinations,
  installation,
  namespace,
  overridesEnabled = true,
  createStore = (configuration) => createS3SourceObjectStore(configuration),
  maxConcurrentReads = DEFAULT_MAX_CONCURRENT_READS,
}: {
  manifest: LocalRetainedSourceObjects["manifest"] & Pick<LocalSourceObjectManifest, "destinationOf">;
  destinations?: Pick<LocalSourceStorageDestinations, "current" | "get" | "configuration">;
  /** The installation's own bucket; undefined unless SOURCE_STORAGE_PROVIDER=s3. */
  installation: S3SourceStorageConfiguration | undefined;
  namespace: string;
  /** False when the operator turned Workspace storage off: new uploads ignore saved Workspace buckets. */
  overridesEnabled?: boolean;
  createStore?: SourceObjectStoreFactory;
  maxConcurrentReads?: number;
}): LocalRetainedSourceObjects & {
  /** The store for a destination ID; throws when the destination is gone or its credentials are unreadable. */
  storeFor(destinationId: string): SourceObjectStore;
} {
  const clients = new Map<string, { version: string; store: SourceObjectStore }>();
  const activeReads = new Map<string, number>();
  const installationStore = installation ? createStore(installation) : null;

  const storeFor = (destinationId: string): SourceObjectStore => {
    if (destinationId === INSTALLATION_DESTINATION_ID) {
      if (!installationStore) throw new SourceObjectUnavailableError("Installation object storage is not configured");

      return installationStore;
    }

    const destination = destinations?.get(destinationId);

    if (!destination) {
      clients.delete(destinationId);
      throw new SourceObjectUnavailableError("The storage destination no longer exists");
    }

    const version = `${destination.revision}`;
    const cached = clients.get(destinationId);

    if (cached?.version === version) return cached.store;
    let configuration: S3SourceStorageConfiguration;

    try {
      configuration = destinations!.configuration(destination);
    } catch (error) {
      throw new SourceObjectUnavailableError("Workspace storage credentials are unavailable", error);
    }

    const store = createStore(configuration);
    clients.set(destinationId, { version, store });

    return store;
  };

  const target = (id: string, prefix: string): RetainedObjectDestination => ({
    id,
    store: { put: (input) => storeFor(id).put(input) },
    keyFor: (input) => retainedObjectKey({ prefix, namespace, ...input }),
    documentKeyFor: (input) => evaluationDocumentObjectKey({ prefix, namespace, ...input }),
  });

  const recordedDestination = (objectKey: string) => manifest.destinationOf(objectKey) ?? INSTALLATION_DESTINATION_ID;

  const destinationById = (destinationId: string): RetainedObjectDestination | null => {
    if (destinationId === INSTALLATION_DESTINATION_ID)
      return installation ? target(INSTALLATION_DESTINATION_ID, installation.prefix) : null;
    const destination = destinations?.get(destinationId);

    return destination ? target(destination.id, destination.location.prefix) : null;
  };

  return {
    store: { open: (key) => storeFor(recordedDestination(key)).open(key) },
    manifest,
    storeFor,
    destinationFor: (workspaceId) => {
      const own = overridesEnabled ? destinations?.current(workspaceId) : null;

      if (own) return target(own.id, own.location.prefix);

      return destinationById(INSTALLATION_DESTINATION_ID);
    },
    destinationOf: (objectKey) => destinationById(recordedDestination(objectKey)),
    acquireRead: (objectKey) => {
      const destinationId = recordedDestination(objectKey);
      const active = activeReads.get(destinationId) ?? 0;

      if (active >= maxConcurrentReads) return null;
      activeReads.set(destinationId, active + 1);
      let released = false;

      return () => {
        if (released) return;
        released = true;
        const remaining = (activeReads.get(destinationId) ?? 1) - 1;

        if (remaining > 0) activeReads.set(destinationId, remaining);
        else activeReads.delete(destinationId);
      };
    },
  };
}
