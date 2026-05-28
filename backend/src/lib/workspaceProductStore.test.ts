import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    protected ctx: unknown;
    protected env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { WorkspaceProductStore } = await import("./workspaceProductStore");

describe("WorkspaceProductStore Extraction job lifecycle", () => {
  it("accepts Workspace live update sockets with hibernation attachments", async () => {
    const acceptedSockets: TestWebSocket[] = [];
    const store = createStore({
      acceptWebSocket(ws) {
        acceptedSockets.push(ws as unknown as TestWebSocket);
      },
    });
    const { server, restore: restoreWebSocketPair } = installWebSocketPair();
    const restoreResponse = installCloudflareWebSocketResponse();

    try {
      const response = await store.fetch(
        new Request("https://workspace-product-store/live", {
          headers: { upgrade: "websocket" },
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-test-websocket-status")).toBe("101");
      expect(acceptedSockets).toEqual([server]);
      expect(server.serializeAttachment).toHaveBeenCalledWith({
        type: "workspace_live_update",
        connected_at: expect.any(String),
      });
      expect(server.accept).not.toHaveBeenCalled();
      expect(server.addEventListener).not.toHaveBeenCalled();
    } finally {
      restoreResponse();
      restoreWebSocketPair();
    }
  });

  it("broadcasts queued Extraction job lifecycle envelopes after persisting Workspace product data", async () => {
    const liveSocket = new TestWebSocket("live");
    const store = createStore({
      webSockets: [liveSocket as unknown as WebSocket],
    });

    await store.createQueuedExtractionJob({
      jobId: "job_live",
      templateId: "template_test",
      templateVersion: 1,
      sourceFileKey: "workspaces/workspace_test/jobs/job_live/source.pdf",
      sourceMimeType: "application/pdf",
      sourceName: "invoice.pdf",
      submittedAt: "2026-05-06T12:00:00.000Z",
    });

    expect(liveSocket.send).toHaveBeenCalledWith(JSON.stringify({
      version: 1,
      events: [
        {
          type: "extraction_job_lifecycle",
          job: {
            job_id: "job_live",
            status: "queued",
            source_name: "invoice.pdf",
            template_id: "template_test",
            template_version: 1,
            error_code: null,
            error_message: null,
            created_at: "2026-05-06T12:00:00.000Z",
            updated_at: "2026-05-06T12:00:00.000Z",
            completed_at: null,
            current_attempt: 0,
            completed_attempt: 0,
            last_failed_attempt: 0,
          },
        },
      ],
    }));
  });

  it("broadcasts completed Extraction job summaries without Extraction results or evidence", async () => {
    const liveSocket = new TestWebSocket("live");
    const store = createStore({
      webSockets: [liveSocket as unknown as WebSocket],
    });
    await createQueuedJob(store);
    liveSocket.send.mockClear();
    await store.claimExtractionJobForProcessing({
      jobId: "job_test",
      attempt: 1,
      claimedAt: "2026-05-06T12:01:00.000Z",
    });
    liveSocket.send.mockClear();

    await store.completeExtractionJob({
      jobId: "job_test",
      attempt: 1,
      completedAt: "2026-05-06T12:02:00.000Z",
      modelName: "google/gemini-3-flash",
      route: "default",
      results: [
        {
          field_id: "patient_name",
          status: "ok",
          answer: "Ada Lovelace",
          normalized_value: "Ada Lovelace",
          confidence: 0.97,
          evidence: "Patient: Ada Lovelace",
        },
      ],
    });

    expect(liveSocket.send).toHaveBeenCalledOnce();
    const message = String(liveSocket.send.mock.calls[0]?.[0] || "");
    const envelope = JSON.parse(message);
    expect(envelope.events[0].job).toMatchObject({
      job_id: "job_test",
      status: "completed",
      source_name: "source.pdf",
      template_id: "template_test",
      template_version: 1,
      completed_at: "2026-05-06T12:02:00.000Z",
      completed_attempt: 1,
    });
    expect(envelope.events[0].job).not.toHaveProperty("results");
    expect(message).not.toContain("Ada Lovelace");
    expect(message).not.toContain("Patient:");
  });

  it("broadcasts processing and failed Extraction job lifecycle transitions only when attempts are current", async () => {
    const liveSocket = new TestWebSocket("live");
    const store = createStore({
      webSockets: [liveSocket as unknown as WebSocket],
    });
    await createQueuedJob(store);
    liveSocket.send.mockClear();

    await store.claimExtractionJobForProcessing({
      jobId: "job_test",
      attempt: 2,
      claimedAt: "2026-05-06T12:01:00.000Z",
    });

    expect(readLastLiveJob(liveSocket)).toMatchObject({
      job_id: "job_test",
      status: "processing",
      current_attempt: 2,
      updated_at: "2026-05-06T12:01:00.000Z",
    });
    liveSocket.send.mockClear();

    await store.failExtractionJob({
      jobId: "job_test",
      attempt: 1,
      failedAt: "2026-05-06T12:02:00.000Z",
      errorCode: "stale_attempt",
      errorMessage: "Stale attempt failed later",
    });

    expect(liveSocket.send).not.toHaveBeenCalled();

    await store.failExtractionJob({
      jobId: "job_test",
      attempt: 2,
      failedAt: "2026-05-06T12:03:00.000Z",
      errorCode: "missing_source_file",
      errorMessage: "Source file is missing from storage",
    });

    expect(readLastLiveJob(liveSocket)).toMatchObject({
      job_id: "job_test",
      status: "failed",
      error_code: "missing_source_file",
      error_message: "Source file is missing from storage",
      last_failed_attempt: 2,
      updated_at: "2026-05-06T12:03:00.000Z",
    });
  });

  it("broadcasts failed lifecycle envelopes when queued Extraction jobs fail before processing", async () => {
    const liveSocket = new TestWebSocket("live");
    const store = createStore({
      webSockets: [liveSocket as unknown as WebSocket],
    });
    await createQueuedJob(store);
    liveSocket.send.mockClear();

    await store.failQueuedExtractionJob({
      jobId: "job_test",
      failedAt: "2026-05-06T12:01:00.000Z",
      errorCode: "queue_send_failed",
      errorMessage: "queue unavailable",
    });

    expect(readLastLiveJob(liveSocket)).toMatchObject({
      job_id: "job_test",
      status: "failed",
      error_code: "queue_send_failed",
      error_message: "queue unavailable",
      last_failed_attempt: 1,
      updated_at: "2026-05-06T12:01:00.000Z",
    });
  });

  it("claims queued Extraction jobs and rejects duplicate claims", async () => {
    const store = createStore();
    await createQueuedJob(store);

    const claimed = await store.claimExtractionJobForProcessing({
      jobId: "job_test",
      attempt: 1,
      claimedAt: "2026-05-06T12:01:00.000Z",
    });
    const duplicateClaim = await store.claimExtractionJobForProcessing({
      jobId: "job_test",
      attempt: 1,
      claimedAt: "2026-05-06T12:02:00.000Z",
    });

    expect(claimed).toMatchObject({
      job_id: "job_test",
      template_id: "template_test",
      template_version: 1,
      source_file_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
      source_mime_type: "application/pdf",
      fields: [
        {
          id: "patient_name",
          name: "Patient Name",
          description: "Patient name",
          data_type: "string",
        },
      ],
    });
    expect(duplicateClaim).toBeNull();
    await expect(store.getExtractionJob("job_test")).resolves.toMatchObject({
      job_id: "job_test",
      status: "processing",
      current_attempt: 1,
    });
  });

  it("completes current attempts with durable Extraction results and ignores duplicates", async () => {
    const store = createStore();
    await createQueuedJob(store);
    await store.claimExtractionJobForProcessing({
      jobId: "job_test",
      attempt: 1,
      claimedAt: "2026-05-06T12:01:00.000Z",
    });

    const completed = await store.completeExtractionJob({
      jobId: "job_test",
      attempt: 1,
      completedAt: "2026-05-06T12:02:00.000Z",
      modelName: "google/gemini-3-flash",
      route: "default",
      results: [
        {
          field_id: "patient_name",
          status: "ok",
          answer: "Ada Lovelace",
          normalized_value: "Ada Lovelace",
          confidence: 0.97,
          evidence: "Patient: Ada Lovelace",
        },
      ],
    });
    const duplicateCompleted = await store.completeExtractionJob({
      jobId: "job_test",
      attempt: 1,
      completedAt: "2026-05-06T12:03:00.000Z",
      modelName: "google/gemini-3-flash",
      route: "default",
      results: [
        {
          field_id: "patient_name",
          status: "ok",
          answer: "Grace Hopper",
          normalized_value: "Grace Hopper",
          confidence: null,
          evidence: null,
        },
      ],
    });

    expect(completed).toBe(true);
    expect(duplicateCompleted).toBe(false);
    await expect(store.getExtractionJob("job_test")).resolves.toMatchObject({
      job_id: "job_test",
      status: "completed",
      completed_attempt: 1,
      results: [
        {
          field_id: "patient_name",
          name: "Patient Name",
          data_type: "string",
          status: "ok",
          answer: "Ada Lovelace",
          confidence: 0.97,
          evidence: "Patient: Ada Lovelace",
        },
      ],
    });
  });

  it("fails only the current processing attempt with durable error information", async () => {
    const store = createStore();
    await createQueuedJob(store);
    await store.claimExtractionJobForProcessing({
      jobId: "job_test",
      attempt: 2,
      claimedAt: "2026-05-06T12:01:00.000Z",
    });

    const staleFailed = await store.failExtractionJob({
      jobId: "job_test",
      attempt: 1,
      failedAt: "2026-05-06T12:02:00.000Z",
      errorCode: "processing_error",
      errorMessage: "Stale attempt failed later",
    });
    const failed = await store.failExtractionJob({
      jobId: "job_test",
      attempt: 2,
      failedAt: "2026-05-06T12:03:00.000Z",
      errorCode: "missing_source_file",
      errorMessage: "Source file is missing from storage",
    });
    const terminalClaim = await store.claimExtractionJobForProcessing({
      jobId: "job_test",
      attempt: 3,
      claimedAt: "2026-05-06T12:04:00.000Z",
    });

    expect(staleFailed).toBe(false);
    expect(failed).toBe(true);
    expect(terminalClaim).toBeNull();
    await expect(store.getExtractionJob("job_test")).resolves.toMatchObject({
      job_id: "job_test",
      status: "failed",
      error_code: "missing_source_file",
      error_message: "Source file is missing from storage",
      last_failed_attempt: 2,
    });
  });

  it("deletes Extraction jobs and completed results from authoritative Workspace product data", async () => {
    const store = createStore();
    await createQueuedJob(store);
    await store.claimExtractionJobForProcessing({
      jobId: "job_test",
      attempt: 1,
      claimedAt: "2026-05-06T12:01:00.000Z",
    });
    await store.completeExtractionJob({
      jobId: "job_test",
      attempt: 1,
      completedAt: "2026-05-06T12:02:00.000Z",
      modelName: "google/gemini-3-flash",
      route: "default",
      results: [
        {
          field_id: "patient_name",
          status: "ok",
          answer: "Ada Lovelace",
          normalized_value: "Ada Lovelace",
          confidence: 0.97,
          evidence: "Patient: Ada Lovelace",
        },
      ],
    });

    const candidate = await store.getExtractionJobDeletionCandidate("job_test");
    const deleted = await store.deleteExtractionJob({
      jobId: "job_test",
      deletedAt: "2026-05-06T12:03:00.000Z",
    });

    expect(candidate).toEqual({
      job_id: "job_test",
      source_file_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
    });
    expect(deleted).toBe(true);
    await expect(store.getExtractionJob("job_test")).resolves.toBeNull();
    await expect(store.getExtractionJobDeletionCandidate("job_test")).resolves.toBeNull();
  });

  it("lists only residual Source files that have not recorded cleanup", async () => {
    const store = createStore();
    await createQueuedJob(store);

    await expect(store.listResidualSourceFilesForCleanup({ limit: 25 })).resolves.toEqual([
      {
        job_id: "job_test",
        source_file_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
      },
    ]);

    await store.markSourceFileCleaned({
      jobId: "job_test",
      sourceFileKey: "workspaces/workspace_test/jobs/job_test/source.pdf",
      cleanedAt: "2026-05-06T12:04:00.000Z",
    });

    await expect(store.listResidualSourceFilesForCleanup({ limit: 25 })).resolves.toEqual([]);
  });
});

async function createQueuedJob(store: InstanceType<typeof WorkspaceProductStore>): Promise<void> {
  await store.createTemplate({
    templateId: "template_test",
    name: "Patient Intake",
    description: null,
    fields: [
      {
        id: "patient_name",
        name: "Patient Name",
        description: "Patient name",
        data_type: "string",
      },
    ],
    createdAt: "2026-05-06T12:00:00.000Z",
  });
  await store.createQueuedExtractionJob({
    jobId: "job_test",
    templateId: "template_test",
    templateVersion: 1,
    sourceFileKey: "workspaces/workspace_test/jobs/job_test/source.pdf",
    sourceMimeType: "application/pdf",
    sourceName: "source.pdf",
    submittedAt: "2026-05-06T12:00:00.000Z",
  });
}

function createStore(options: {
  acceptWebSocket?: (ws: WebSocket) => void;
  webSockets?: WebSocket[];
} = {}): InstanceType<typeof WorkspaceProductStore> {
  const sql = new DurableObjectSqlStorageAdapter();
  const acceptedWebSockets: WebSocket[] = [];
  const storage = {
    sql,
    transactionSync<T>(callback: () => T): T {
      sql.database.exec("BEGIN");
      try {
        const result = callback();
        sql.database.exec("COMMIT");
        return result;
      } catch (error) {
        sql.database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const ctx = {
    storage,
    blockConcurrencyWhile(callback: () => unknown): void {
      callback();
    },
    acceptWebSocket(ws: WebSocket): void {
      acceptedWebSockets.push(ws);
      options.acceptWebSocket?.(ws);
    },
    getWebSockets(): WebSocket[] {
      return options.webSockets ?? acceptedWebSockets;
    },
  } as unknown as DurableObjectState;

  return new WorkspaceProductStore(ctx, {} as Env);
}

function installWebSocketPair(): { server: TestWebSocket; restore: () => void } {
  type TestWebSocketPairConstructor = new () => { 0: TestWebSocket; 1: TestWebSocket };
  const websocketGlobal = globalThis as unknown as { WebSocketPair?: TestWebSocketPairConstructor };
  const original = websocketGlobal.WebSocketPair;
  const client = new TestWebSocket("client");
  const server = new TestWebSocket("server");

  websocketGlobal.WebSocketPair = class {
    0 = client;
    1 = server;
  };

  return {
    server,
    restore() {
      if (original) {
        websocketGlobal.WebSocketPair = original;
      } else {
        delete websocketGlobal.WebSocketPair;
      }
    },
  };
}

function installCloudflareWebSocketResponse(): () => void {
  const OriginalResponse = globalThis.Response;

  (globalThis as unknown as { Response: typeof Response }).Response = class extends OriginalResponse {
    constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: WebSocket }) {
      if (init?.status === 101) {
        super(body ?? null, {
          status: 200,
          headers: {
            "x-test-websocket-status": "101",
          },
        });
        return;
      }

      super(body ?? null, init);
    }
  } as typeof Response;

  return () => {
    (globalThis as unknown as { Response: typeof Response }).Response = OriginalResponse;
  };
}

class TestWebSocket {
  readonly accept = vi.fn();
  readonly addEventListener = vi.fn();
  readonly close = vi.fn();
  readonly send = vi.fn();
  readonly serializeAttachment = vi.fn((attachment: unknown) => {
    this.attachment = attachment;
  });
  readonly deserializeAttachment = vi.fn(() => this.attachment);
  private attachment: unknown = null;

  constructor(readonly name: string) {}
}

function readLastLiveJob(socket: TestWebSocket): Record<string, unknown> {
  const lastMessage = String(socket.send.mock.calls.at(-1)?.[0] || "");
  const envelope = JSON.parse(lastMessage);
  return envelope.events[0].job;
}

class DurableObjectSqlStorageAdapter {
  readonly database = new DatabaseSync(":memory:");

  exec<T = unknown>(sql: string, ...params: unknown[]): DurableObjectSqlCursor<T> {
    const statement = this.database.prepare(sql);
    const normalizedParams = params.map((param) => param === undefined ? null : param) as SQLInputValue[];
    if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql)) {
      return new DurableObjectSqlCursor(statement.all(...normalizedParams) as T[], 0);
    }

    const result = statement.run(...normalizedParams);
    return new DurableObjectSqlCursor([], Number(result.changes || 0));
  }
}

class DurableObjectSqlCursor<T> {
  constructor(
    private readonly rows: T[],
    readonly rowsWritten: number,
  ) {}

  toArray(): T[] {
    return this.rows;
  }

  one(): T {
    if (!this.rows[0]) {
      throw new Error("Expected one SQL row");
    }
    return this.rows[0];
  }
}
