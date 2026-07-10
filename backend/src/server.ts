import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_MAX_SOURCE_FILE_BYTES, createLocalApplication } from "./localApplication";
import { createLocalAuthRuntime } from "./localAuthRuntime";
import { createLocalExtractionQueue } from "./localExtractionQueue";
import { createLocalExtractionRunner } from "./localExtractionRunner";
import { createLocalLiveUpdateHub } from "./localLiveUpdateHub";
import { upgradeLocalLiveUpdate } from "./localLiveUpdateUpgrade";
import { createLocalProductAnalytics } from "./localProductAnalytics";
import { createLocalRuntimeFetchHandler, ensureLocalStateDirectories } from "./localRuntime";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceDeletion } from "./localWorkspaceDeletion";
import { createLocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";

type BunServer = {
  port: number;
  upgrade(request: Request, options: { data: { workspaceId: string } }): boolean;
};

type BunLiveSocket = {
  data: { workspaceId: string };
  send(message: string): void;
};

type BunRuntime = {
  serve(options: {
    fetch(request: Request, server: BunServer): Response | Promise<Response | undefined> | undefined;
    hostname: string;
    port: number;
    websocket: {
      close(socket: BunLiveSocket): void;
      message(socket: BunLiveSocket, message: string | Buffer): void;
      open(socket: BunLiveSocket): void;
    };
  }): BunServer;
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assetsDirectory = process.env.DOCUMENT_EXTRACTION_ASSETS_DIR || resolve(repositoryRoot, "frontend", "dist");
const stateDirectory = process.env.DOCUMENT_EXTRACTION_STATE_DIR || resolve(repositoryRoot, ".local");
const port = readPort(process.env.PORT);
const maxSourceFileBytes = readPositiveInteger(
  process.env.MAX_SOURCE_FILE_BYTES,
  "MAX_SOURCE_FILE_BYTES",
  DEFAULT_MAX_SOURCE_FILE_BYTES,
);

await ensureLocalStateDirectories(stateDirectory);

const localAuth = await createLocalAuthRuntime({
  adminEmails: (process.env.DOCUMENT_EXTRACTION_ADMIN_EMAILS || "").split(","),
  baseURL: process.env.BETTER_AUTH_URL || `http://127.0.0.1:${port}`,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  stateDirectory,
});
const localExtractionQueue = createLocalExtractionQueue();
const localLiveUpdateHub = createLocalLiveUpdateHub();
const localProductAnalytics = createLocalProductAnalytics({ stateDirectory });
const localWorkspaceProductOperations = createLocalWorkspaceProductOperations();
const localSourceFiles = createLocalSourceFileStore({ stateDirectory });
const localWorkspaceDeletion = createLocalWorkspaceDeletion({
  sourceFileStore: localSourceFiles,
  stateDirectory,
  workspaceControl: localAuth.workspaceControl,
  workspaceProductOperations: localWorkspaceProductOperations,
  onWorkspaceAccessRevoked: localLiveUpdateHub.broadcastWorkspaceContextInvalidation,
});
await localWorkspaceDeletion.reconcileInterruptedDeletions();
const localExtractionRunner = createLocalExtractionRunner({
  onJobLifecycleChange: localLiveUpdateHub.broadcastJob,
  productAnalytics: localProductAnalytics,
  scheduleJob: localExtractionQueue.schedule,
  sourceFileStore: localSourceFiles,
  stateDirectory,
  workspaceControl: localAuth.workspaceControl,
  workspaceProductOperations: localWorkspaceProductOperations,
});
localExtractionQueue.subscribe((job) => {
  void localExtractionRunner.run(job);
});
await localExtractionRunner.recover();
const application = createLocalApplication({
  auth: localAuth.auth,
  liveUpdateHub: localLiveUpdateHub,
  maxSourceFileBytes,
  productAnalytics: localProductAnalytics,
  scheduleQueuedJob: localExtractionQueue.schedule,
  sourceFileStore: localSourceFiles,
  stateDirectory,
  workspaceControl: localAuth.workspaceControl,
  workspaceDeletion: localWorkspaceDeletion,
  workspaceProductOperations: localWorkspaceProductOperations,
});
const runtimeFetch = createLocalRuntimeFetchHandler({
  api: application,
  assetsDirectory,
});
const bun = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;

if (!bun) {
  throw new Error("The local server must run with Bun.");
}

const server = bun.serve({
  fetch: async (request, bunServer) => {
    if (isWorkspaceLiveUpdatePath(request)) {
      return upgradeLocalLiveUpdate({
        auth: localAuth.auth,
        request,
        server: bunServer as never,
        workspaceControl: localAuth.workspaceControl,
      });
    }
    return runtimeFetch(request);
  },
  hostname: "127.0.0.1",
  port,
  websocket: {
    close: (socket) => {
      const workspaceId = (socket.data as unknown as { workspaceId?: string } | undefined)?.workspaceId;
      if (workspaceId) {
        localLiveUpdateHub.unsubscribe({ workspaceId, socket });
      }
    },
    open: (socket) => {
      const workspaceId = (socket.data as unknown as { workspaceId?: string } | undefined)?.workspaceId;
      if (workspaceId) {
        localLiveUpdateHub.subscribe({ workspaceId, socket });
      }
    },
    message: () => {},
  },
});
console.log(`Document Extraction local server listening on http://127.0.0.1:${server.port}`);

function readPort(value: string | undefined): number {
  if (!value) {
    return 8787;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return parsed;
}

function readPositiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function isWorkspaceLiveUpdatePath(request: Request): boolean {
  return /^\/v1\/workspaces\/[^/]+\/live$/.test(new URL(request.url).pathname);
}
