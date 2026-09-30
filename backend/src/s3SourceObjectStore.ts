import { S3Client } from "bun";

import type { S3SourceStorageConfiguration } from "./localConfiguration";

/** A retained original is confirmed absent; every other failure is treated as unavailable. */
export class SourceObjectMissingError extends Error {
  constructor() { super("The retained original is missing from storage"); }
}

export class SourceObjectUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) { super(message); }
}

export type SourceObjectStore = {
  /** Uploads a validated local file as one object (never multipart). */
  put(input: { key: string; file: Blob; mimeType: string }): Promise<void>;
  open(key: string): Promise<{ size: number; stream(): ReadableStream<Uint8Array> }>;
  /** Deletes an object; an already-absent object succeeds. */
  delete(key: string): Promise<void>;
};

const OBJECT_EXTENSIONS: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Each upload attempt gets its own key, so a late-completing attempt never overwrites another. */
export function retainedObjectKey({ prefix, namespace, workspaceId, jobId, mimeType }: {
  prefix: string; namespace: string; workspaceId: string; jobId: string; mimeType: string;
}): string {
  for (const value of [namespace, workspaceId, jobId]) {
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Retained object keys accept only opaque identifiers");
  }
  const extension = OBJECT_EXTENSIONS[mimeType];
  if (!extension) throw new Error("Unsupported Source file MIME type");
  return `${prefix}${namespace}/workspaces/${workspaceId}/jobs/${jobId}/${crypto.randomUUID()}.${extension}`;
}

/** Saved Evaluation document originals use their own namespace beside job originals. */
export function evaluationDocumentObjectKey({ prefix, namespace, workspaceId, documentId, mimeType }: {
  prefix: string; namespace: string; workspaceId: string; documentId: string; mimeType: string;
}): string {
  for (const value of [namespace, workspaceId, documentId]) {
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Retained object keys accept only opaque identifiers");
  }
  const extension = OBJECT_EXTENSIONS[mimeType];
  if (!extension) throw new Error("Unsupported Source file MIME type");
  return `${prefix}${namespace}/workspaces/${workspaceId}/evaluation-documents/${documentId}/${crypto.randomUUID()}.${extension}`;
}

/**
 * Identifies where this installation's objects live. Credentials are not part of it: rotating them
 * keeps the destination, while a new endpoint, bucket, prefix or addressing style is a different one.
 */
export function sourceObjectDestination(configuration: S3SourceStorageConfiguration): string {
  return [
    "s3",
    configuration.endpoint ?? "aws",
    configuration.bucket,
    configuration.prefix,
    configuration.forcePathStyle ? "path" : "virtual-hosted",
  ].join("|");
}

const DEFAULT_WRITE_DEADLINE_MS = 60_000;
const DEFAULT_READ_DEADLINE_MS = 15_000;

/**
 * Bun's S3 client accepts no AbortSignal, so deadlines bound how long callers wait but cannot stop the
 * request. Callers therefore write each attempt under a unique key and treat a timed-out write as
 * possibly completing later.
 */
export function createS3SourceObjectStore(
  configuration: S3SourceStorageConfiguration,
  { writeDeadlineMs = DEFAULT_WRITE_DEADLINE_MS, readDeadlineMs = DEFAULT_READ_DEADLINE_MS } = {},
): SourceObjectStore {
  const client = new S3Client({
    bucket: configuration.bucket,
    region: configuration.region,
    endpoint: configuration.endpoint,
    virtualHostedStyle: !configuration.forcePathStyle,
    accessKeyId: configuration.accessKeyId,
    secretAccessKey: configuration.secretAccessKey,
    sessionToken: configuration.sessionToken,
  });

  return {
    put: async ({ key, file, mimeType }) => {
      // A part size above the file size keeps the upload to a single PUT, with no multipart state to recover.
      await withDeadline("upload", client.write(key, file, { type: mimeType, partSize: Math.max(5 * 1024 * 1024, file.size + 1), retry: 0 }), writeDeadlineMs);
    },
    open: async (key) => {
      const stat = await withDeadline("stat", client.stat(key), readDeadlineMs);
      return { size: stat.size, stream: () => client.file(key).stream() };
    },
    delete: async (key) => {
      try {
        await withDeadline("delete", client.delete(key), writeDeadlineMs);
      } catch (error) {
        if (!(error instanceof SourceObjectMissingError)) throw error;
      }
    },
  };
}

async function withDeadline<T>(operation: string, work: Promise<T>, deadlineMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SourceObjectUnavailableError(`S3 ${operation} exceeded ${deadlineMs}ms`)), deadlineMs);
      }),
    ]);
  } catch (error) {
    throw classifyS3Error(operation, error);
  } finally {
    clearTimeout(timer);
  }
}

function classifyS3Error(operation: string, error: unknown): Error {
  if (error instanceof SourceObjectMissingError || error instanceof SourceObjectUnavailableError) return error;
  // Only a positive "no such key" is absence; access denied can hide a missing key and is not.
  if ((error as { code?: string })?.code === "NoSuchKey") return new SourceObjectMissingError();
  return new SourceObjectUnavailableError(`S3 ${operation} failed`, error);
}
