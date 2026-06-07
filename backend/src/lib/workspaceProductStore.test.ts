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

  it("stores backend-only session identity in Workspace live update socket attachments", async () => {
    const acceptedSockets: TestWebSocket[] = [];
    const store = createStore({
      acceptWebSocket(ws) {
        acceptedSockets.push(ws as unknown as TestWebSocket);
      },
    });
    const { server, restore: restoreWebSocketPair } = installWebSocketPair();
    const restoreResponse = installCloudflareWebSocketResponse();

    try {
      await store.fetch(
        new Request("https://workspace-product-store/live", {
          headers: {
            upgrade: "websocket",
            "x-workspace-live-user-id": "user_test",
            "x-workspace-live-workspace-id": "workspace_test",
          },
        }),
      );

      expect(acceptedSockets).toEqual([server]);
      expect(server.serializeAttachment).toHaveBeenCalledWith({
        type: "workspace_live_update",
        connected_at: expect.any(String),
        user_id: "user_test",
        workspace_id: "workspace_test",
      });
    } finally {
      restoreResponse();
      restoreWebSocketPair();
    }
  });

  it("broadcasts queued Extraction job lifecycle envelopes without Source file page count", async () => {
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
      sourceFilePageCount: 4,
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

  it("broadcasts Workspace context invalidation envelopes without computed context data", async () => {
    const liveSocket = new TestWebSocket("live");
    const store = createStore({
      webSockets: [liveSocket as unknown as WebSocket],
    });

    await store.broadcastWorkspaceContextInvalidation({
      reason: "billing_usage",
      occurredAt: "2026-05-06T12:02:00.000Z",
    });

    expect(liveSocket.send).toHaveBeenCalledWith(JSON.stringify({
      version: 1,
      events: [
        {
          type: "workspace_context_invalidated",
          reason: "billing_usage",
          occurred_at: "2026-05-06T12:02:00.000Z",
        },
      ],
    }));

    const message = String(liveSocket.send.mock.calls[0]?.[0] || "");
    const envelope = JSON.parse(message);
    expect(envelope.events[0]).not.toHaveProperty("billing_operational_status");
    expect(envelope.events[0]).not.toHaveProperty("billing_usage_summary");
    expect(envelope.events[0]).not.toHaveProperty("billing_plan_limits");
    expect(envelope.events[0]).not.toHaveProperty("api_key");
    expect(envelope.events[0]).not.toHaveProperty("has_api_key");
    expect(envelope.events[0]).not.toHaveProperty("account");
    expect(envelope.events[0]).not.toHaveProperty("user_id");
    expect(envelope.events[0]).not.toHaveProperty("workspace_id");
  });

  it("closes Workspace live update sockets for a known session identity", async () => {
    const removedMemberSocket = new TestWebSocket("removed-member");
    removedMemberSocket.serializeAttachment({
      type: "workspace_live_update",
      connected_at: "2026-05-06T12:00:00.000Z",
      user_id: "user_removed",
      workspace_id: "workspace_test",
    });
    const remainingMemberSocket = new TestWebSocket("remaining-member");
    remainingMemberSocket.serializeAttachment({
      type: "workspace_live_update",
      connected_at: "2026-05-06T12:00:00.000Z",
      user_id: "user_remaining",
      workspace_id: "workspace_test",
    });
    const store = createStore({
      webSockets: [
        removedMemberSocket as unknown as WebSocket,
        remainingMemberSocket as unknown as WebSocket,
      ],
    });

    const closedCount = await store.closeWorkspaceLiveUpdateSocketsForUser({
      userId: "user_removed",
      reason: "Workspace access changed",
    });

    expect(closedCount).toBe(1);
    expect(removedMemberSocket.close).toHaveBeenCalledWith(1000, "Workspace access changed");
    expect(remainingMemberSocket.close).not.toHaveBeenCalled();
  });

  it("persists Source file page count with Source file metadata", async () => {
    const sql = new DurableObjectSqlStorageAdapter();
    const store = createStore({ sql });

    await store.createQueuedExtractionJob({
      jobId: "job_counted",
      templateId: "template_test",
      templateVersion: 1,
      sourceFileKey: "workspaces/workspace_test/jobs/job_counted/source.pdf",
      sourceMimeType: "application/pdf",
      sourceName: "invoice.pdf",
      sourceFilePageCount: 5,
      submittedAt: "2026-05-06T12:00:00.000Z",
    });

    const row = sql
      .exec<{ page_count: number | null }>(
        "SELECT page_count FROM source_files WHERE job_id = ?",
        "job_counted",
      )
      .one();

    expect(row.page_count).toBe(5);
  });

  it("persists NULL Source file page count for non-PDF Source file metadata", async () => {
    const sql = new DurableObjectSqlStorageAdapter();
    const store = createStore({ sql });

    await store.createQueuedExtractionJob({
      jobId: "job_image",
      templateId: "template_test",
      templateVersion: 1,
      sourceFileKey: "workspaces/workspace_test/jobs/job_image/source.png",
      sourceMimeType: "image/png",
      sourceName: "scan.png",
      sourceFilePageCount: null,
      submittedAt: "2026-05-06T12:00:00.000Z",
    });

    const row = sql
      .exec<{ mime_type: string; page_count: number | null }>(
        "SELECT mime_type, page_count FROM source_files WHERE job_id = ?",
        "job_image",
      )
      .one();

    expect(row).toEqual({
      mime_type: "image/png",
      page_count: null,
    });
  });

  it("lazily upgrades existing Source file metadata to include nullable page count", async () => {
    const sql = new DurableObjectSqlStorageAdapter();
    sql.database.exec(`
      CREATE TABLE product_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT INTO product_schema_migrations (version, applied_at)
      VALUES (3, '2026-05-06T11:00:00.000Z');
      CREATE TABLE source_files (
        key TEXT PRIMARY KEY,
        job_id TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        name TEXT,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      INSERT INTO source_files (key, job_id, mime_type, name, created_at, deleted_at)
      VALUES (
        'workspaces/workspace_test/jobs/job_historical/source.pdf',
        'job_historical',
        'application/pdf',
        'historical.pdf',
        '2026-05-06T11:30:00.000Z',
        NULL
      );
    `);
    const store = createStore({ sql });

    await store.createQueuedExtractionJob({
      jobId: "job_counted",
      templateId: "template_test",
      templateVersion: 1,
      sourceFileKey: "workspaces/workspace_test/jobs/job_counted/source.pdf",
      sourceMimeType: "application/pdf",
      sourceName: "invoice.pdf",
      sourceFilePageCount: 2,
      submittedAt: "2026-05-06T12:00:00.000Z",
    });

    const counted = sql
      .exec<{ page_count: number | null }>(
        "SELECT page_count FROM source_files WHERE job_id = ?",
        "job_counted",
      )
      .one();
    const historical = sql
      .exec<{ page_count: number | null }>(
        "SELECT page_count FROM source_files WHERE job_id = ?",
        "job_historical",
      )
      .one();

    expect(counted.page_count).toBe(2);
    expect(historical.page_count).toBeNull();
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

  it("hard-erases Workspace product data and ignores late lifecycle updates", async () => {
    const liveSocket = new TestWebSocket("live");
    const store = createStore({
      webSockets: [liveSocket as unknown as WebSocket],
    });
    await createQueuedJob(store);

    await store.eraseWorkspaceProductData();

    expect(liveSocket.close).toHaveBeenCalledWith(1000, "Workspace deleted");
    await expect(store.listResidualSourceFilesForCleanup({ limit: 25 })).resolves.toEqual([]);
    await expect(
      store.startExtractionWorkflow({
        jobId: "job_test",
        attempt: 1,
        startedAt: "2026-05-06T12:01:00.000Z",
        workflowInstanceId: "job_test-attempt-1",
      }),
    ).resolves.toBe(false);
    await expect(
      store.claimExtractionJobForProcessing({
        jobId: "job_test",
        attempt: 1,
        claimedAt: "2026-05-06T12:02:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      store.completeExtractionJob({
        jobId: "job_test",
        attempt: 1,
        completedAt: "2026-05-06T12:03:00.000Z",
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
      }),
    ).resolves.toBe(false);
    await expect(
      store.failExtractionJob({
        jobId: "job_test",
        attempt: 1,
        failedAt: "2026-05-06T12:04:00.000Z",
        errorCode: "processing_error",
        errorMessage: "Late failure after Workspace deletion",
      }),
    ).resolves.toBe(false);
  });

  it("summarizes active Template usage for Plan limit enforcement", async () => {
    const store = createStore();
    await store.createTemplate({
      templateId: "template_limits",
      name: "Limit Template",
      description: null,
      fields: [
        {
          id: "invoice_number",
          name: "Invoice Number",
          description: "Invoice identifier.",
          data_type: "string",
        },
        {
          id: "line_items",
          name: "Line Items",
          description: tableDescription("Line item table.", 6),
          data_type: "array<object>",
        },
      ],
      createdAt: "2026-05-06T12:00:00.000Z",
    });
    await store.createTemplate({
      templateId: "template_deleted",
      name: "Deleted Template",
      description: null,
      fields: [
        {
          id: "ignored",
          name: "Ignored",
          description: "Deleted Template field.",
          data_type: "string",
        },
      ],
      createdAt: "2026-05-06T12:05:00.000Z",
    });
    await store.deleteTemplate("template_deleted");

    await expect(store.summarizePlanLimitUsage()).resolves.toEqual({
      active_template_count: 1,
      templates: [
        {
          template_id: "template_limits",
          top_level_template_fields: 2,
          table_shaped_fields: 1,
          max_table_columns_per_field: 6,
        },
      ],
    });
    await expect(store.summarizePlanLimitUsage({ templateId: "template_limits" })).resolves.toEqual({
      active_template_count: 1,
      templates: [
        {
          template_id: "template_limits",
          top_level_template_fields: 2,
          table_shaped_fields: 1,
          max_table_columns_per_field: 6,
        },
      ],
    });
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
    sourceFilePageCount: null,
    submittedAt: "2026-05-06T12:00:00.000Z",
  });
}

function createStore(options: {
  acceptWebSocket?: (ws: WebSocket) => void;
  webSockets?: WebSocket[];
  sql?: DurableObjectSqlStorageAdapter;
} = {}): InstanceType<typeof WorkspaceProductStore> {
  const sql = options.sql ?? new DurableObjectSqlStorageAdapter();
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
    async deleteAll(): Promise<void> {
      sql.deleteAll();
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

function tableDescription(baseDescription: string, columns: number): string {
  const schema = {
    mode: "table",
    data_type: "array<object>",
    columns: Array.from({ length: columns }, (_, index) => ({
      key: `column_${index + 1}`,
      heading: `Column ${index + 1}`,
      data_type: "string",
      description: `Column ${index + 1} value.`,
    })),
  };

  return [
    baseDescription,
    "",
    "[[OBJECT_SCHEMA]]",
    JSON.stringify(schema),
    "[[/OBJECT_SCHEMA]]",
  ].join("\n");
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

  deleteAll(): void {
    const tables = this.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;

    for (const table of tables) {
      this.database.exec(`DROP TABLE IF EXISTS ${quoteSqlIdentifier(table.name)}`);
    }
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

function quoteSqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
