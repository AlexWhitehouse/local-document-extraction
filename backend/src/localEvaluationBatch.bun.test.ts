import type { JsonObject } from "../../shared/json";
import { workspaceControlFixture, workspaceFixture } from "./testing/workspaceControlFixture";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalEvaluations, type EvaluationDocumentSourceAccess } from "./localEvaluations";
import { createLocalExtractionQueue } from "./localExtractionQueue";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createWorkspaceCredentialVault } from "./workspaceModelConfiguration";

import { RetryableError } from "./consumer/modelGateway";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const fields = [{ id: "total", name: "Total", description: "Invoice total", data_type: "number" as const }];

const deferred = () => {
  let resolve!: () => void;

  const promise = new Promise<void>((r) => {
    resolve = r;
  });

  return { promise, resolve };
};

async function until(predicate: () => boolean) {
  for (let i = 0; i < 1000; i++) {
    if (predicate()) return;
    await Bun.sleep(2);
  }

  throw new Error("Timed out");
}

const candidates = (count = 2, revision = 0) =>
  Array.from({ length: count }, (_, index) => ({
    id: "candidate" + index,
    revision,
    model: "model",
    pdf: false,
    structured: false,
    fields,
  }));

type Event = JsonObject;

/** Collects NDJSON events incrementally so tests can act while an operation is open. */
function collect(response: Response) {
  const events: Event[] = [];

  const done = (async () => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) if (line) events.push(JSON.parse(line));
    }

    return events;
  })();

  return { events, done };
}

function library(documents: Record<string, "ok" | "missing" | "too_large" | "unavailable"> = { evd_1: "ok" }) {
  const present = new Set(Object.keys(documents));
  let hold: Promise<void> | null = null;

  const access: EvaluationDocumentSourceAccess = {
    exists: ({ workspaceId, documentId }) => workspaceId === "workspace" && present.has(documentId),
    async copyToTemporary({ workspaceId, documentId, destinationPath, maxBytes }) {
      if (hold) await hold;

      if (workspaceId !== "workspace" || !present.has(documentId)) return { ok: false, reason: "not_found" };

      const outcome = documents[documentId];

      if (outcome !== "ok") return { ok: false, reason: outcome };
      const bytes = new Uint8Array([7, 8, 9]);

      if (bytes.byteLength > maxBytes) return { ok: false, reason: "too_large" };
      await Bun.write(destinationPath, bytes);

      return { ok: true, mimeType: "image/png", size: bytes.byteLength, name: "saved.png" };
    },
  };

  return {
    access,
    remove: (id: string) => present.delete(id),
    holdCopies: (promise: Promise<void> | null) => {
      hold = promise;
    },
  };
}

function fixture(
  options: Partial<Parameters<typeof createLocalEvaluations>[0]> = {},
  { sequentialQueue = false } = {},
) {
  const stateDirectory = mkdtempSync(join(tmpdir(), "evaluation-batch-test-"));
  const productStoreRegistry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  const lease = productStoreRegistry.acquire({ workspaceId: "workspace", mode: "create" })!;
  const vault = createWorkspaceCredentialVault(stateDirectory);

  const configuration = {
    model_name: "model",
    gateway_url: "http://localhost:1234",
    sequential_calls: false,
    supports_pdf_input: false,
    supports_structured_output: false,
    credential_ciphertext: vault.encrypt("workspace", "private-credential"),
  };

  lease.store.putModelConfiguration({ configuration, expectedRevision: null, updatedAt: new Date().toISOString() });

  const queue =
    options.queue ||
    createLocalExtractionQueue({
      maxConcurrent: 2,
      getWorkspaceMaxConcurrent: () =>
        sequentialQueue && lease.store.getModelConfiguration()?.sequential_calls ? 1 : Number.MAX_SAFE_INTEGER,
    });

  const docs = library();

  const service = createLocalEvaluations({
    stateDirectory,
    productStoreRegistry,
    queue,
    maxSourceFileBytes: 10000,
    libraryDocuments: docs.access,
    auth: {
      getSession: async () => ({ id: "user", email: "user@example.test", name: "User", isActive: () => true }),
      handler: async () => new Response(),
    },
    workspaceControl: workspaceControlFixture({
      getAcceptedWorkspaceContext: ({ workspaceId }) =>
        workspaceId === "workspace" ? workspaceFixture({ id: "workspace" }) : null,
    }),
    extract: async () => [{ field_id: "total", status: "ok", answer: 12 }],
    retryDelayMs: 0,
    deletionPollMs: 5,
    ...options,
  });

  cleanups.push(async () => {
    service.close();
    await queue.close();
    lease.release();
    await productStoreRegistry.closeAll();
    rmSync(stateDirectory, { force: true, recursive: true });
  });

  const body = (overrides: JsonObject) => ({
    id: crypto.randomUUID(),
    evaluationId: "evaluation",
    revision: 1,
    mode: "models",
    candidates: candidates(),
    ...overrides,
  });

  const headers = (id: string) => ({ "x-workspace-id": "workspace", "x-evaluation-submission": id });

  const upload = (overrides: JsonObject = {}, signal?: AbortSignal) => {
    const evaluation = body(overrides);
    const form = new FormData();
    form.append("document", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "sample.png");
    form.append("evaluation", JSON.stringify(evaluation));

    return service.handle(
      new Request("http://localhost/v1/evaluations/run", {
        method: "POST",
        body: form,
        headers: headers(evaluation.id),
        signal,
      }),
    );
  };

  const saved = (overrides: JsonObject = {}, documentId = "evd_1") => {
    const evaluation = body({ document: { kind: "saved", id: documentId }, ...overrides });

    return service.handle(
      new Request("http://localhost/v1/evaluations/run", {
        method: "POST",
        body: JSON.stringify(evaluation),
        headers: { ...headers(evaluation.id), "content-type": "application/json" },
      }),
    );
  };

  const createAction = async (revision = 1, evaluationId = "evaluation") =>
    service.handle(
      new Request("http://localhost/v1/evaluations/actions", {
        method: "POST",
        body: JSON.stringify({ evaluation_id: evaluationId, revision }),
        headers: { "x-workspace-id": "workspace", "content-type": "application/json" },
      }),
    );

  const releaseAction = (id: string) =>
    service.handle(
      new Request("http://localhost/v1/evaluations/actions/" + id, {
        method: "DELETE",
        headers: { "x-workspace-id": "workspace" },
      }),
    );

  const changeConfiguration = (changes: JsonObject, expectedRevision = 1) =>
    lease.store.putModelConfiguration({
      configuration: { ...configuration, ...changes },
      expectedRevision,
      updatedAt: new Date().toISOString(),
    });

  return {
    service,
    upload,
    saved,
    createAction,
    releaseAction,
    changeConfiguration,
    docs,
    vault,
    queue,
    stateDirectory,
    files: () => readdirSync(join(stateDirectory, "temporary", "evaluations")),
  };
}

const pairs = (events: Event[], type: string) => events.filter((e) => e.type === type);

test("setup exposes the shared queue's document concurrency as staging pace", async () => {
  const f = fixture();

  const setup = async () =>
    (
      await f.service.handle(
        new Request("http://localhost/v1/evaluations/setup", { headers: { "x-workspace-id": "workspace" } }),
      )
    ).json();

  expect((await setup()).staging).toEqual({ document_concurrency: 2 });
  f.queue.setMaxConcurrent(0);
  expect((await setup()).staging).toEqual({ document_concurrency: 1 });
});

test("a saved document runs from a private working copy that is removed when its pairs settle", async () => {
  const gate = deferred();
  const sources: number[][] = [];

  const f = fixture({
    extract: async (_env, _fields, source) => {
      sources.push([...new Uint8Array(source instanceof Blob ? await source.arrayBuffer() : source)]);
      await gate.promise;

      return [{ field_id: "total", status: "ok", answer: 12 }];
    },
  });

  const response = await f.saved({ document_instance_id: "doc-a" });
  expect(response.headers.get("content-type")).toBe("application/x-ndjson");
  const run = collect(response);
  await until(() => sources.length === 2);
  expect(f.files()).toHaveLength(1);
  gate.resolve();
  const events = await run.done;
  expect(sources).toEqual([
    [7, 8, 9],
    [7, 8, 9],
  ]);
  expect(pairs(events, "success")).toHaveLength(2);
  expect(events.every((e) => e.document_instance_id === "doc-a")).toBe(true);
  expect(events.at(-2)).toMatchObject({ type: "cleanup", status: "complete" });
  expect(f.files()).toEqual([]);
});

test("fresh uploads without a document instance default to the single-document instance", async () => {
  const f = fixture();
  const events = await collect(await f.upload()).done;
  expect(pairs(events, "success")).toHaveLength(2);
  expect(events.every((e) => e.document_instance_id === "single")).toBe(true);
});

test("saved-document request errors are reported before streaming and leave no working copy", async () => {
  let calls = 0;
  const docs = library({ evd_1: "ok", evd_missing: "missing", evd_down: "unavailable", evd_big: "too_large" });

  const f = fixture({
    libraryDocuments: docs.access,
    extract: async () => {
      calls++;

      return [];
    },
  });

  const failure = async (response: Response) => ({ status: response.status, code: (await response.json()).error.code });
  expect(await failure(await f.saved({}, "evd_unknown"))).toEqual({ status: 404, code: "document_not_found" });
  expect(await failure(await f.saved({}, "evd_missing"))).toEqual({ status: 404, code: "source_missing" });
  const unavailable = await f.saved({}, "evd_down");
  expect(unavailable.headers.get("retry-after")).toBeTruthy();
  expect(await failure(unavailable)).toEqual({ status: 503, code: "source_unavailable" });
  // An original over the Workspace limit can never succeed on retry.
  expect(await failure(await f.saved({}, "evd_big"))).toEqual({ status: 413, code: "document_too_large" });
  const unconfigured = fixture({ libraryDocuments: undefined });
  expect(await failure(await unconfigured.saved())).toEqual({ status: 503, code: "source_unavailable" });
  expect((await f.saved({ document: { kind: "upload", id: "evd_1" } })).status).toBe(400);
  expect(calls).toBe(0);
  expect(f.files()).toEqual([]);
  expect(unconfigured.files()).toEqual([]);
});

test("deletion while the working copy is prepared rejects the request and removes the copy", async () => {
  let calls = 0;

  const f = fixture({
    extract: async () => {
      calls++;

      return [];
    },
  });

  const hold = deferred();
  f.docs.holdCopies(hold.promise);
  const pending = f.saved();
  await Bun.sleep(10);
  f.docs.remove("evd_1");
  hold.resolve();
  const response = await pending;
  expect(response.status).toBe(404);
  expect((await response.json()).error.code).toBe("document_not_found");
  expect(calls).toBe(0);
  expect(f.files()).toEqual([]);
});

test("deletion while queued ends every pair as deleted without reaching the gateway", async () => {
  let calls = 0;

  const f = fixture({
    extract: async () => {
      calls++;

      return [];
    },
  });

  f.queue.setMaxConcurrent(0);
  const run = collect(await f.saved({ document_instance_id: "doc-a" }));
  await until(() => pairs(run.events, "queued").length === 2);
  f.docs.remove("evd_1");
  const events = await run.done;
  expect(pairs(events, "failure").map((e) => [e.candidateId, e.code, e.message])).toEqual([
    ["candidate0", "document_deleted", "Deleted from the Evaluation library."],
    ["candidate1", "document_deleted", "Deleted from the Evaluation library."],
  ]);
  expect(f.queue.snapshot().pending).toBe(0);
  f.queue.setMaxConcurrent(2);
  await f.queue.waitForIdle();
  expect(calls).toBe(0);
  expect(f.files()).toEqual([]);
});

test("queued work re-checks deletion at dispatch even before the deletion poll notices", async () => {
  let calls = 0;

  const f = fixture({
    deletionPollMs: 60000,
    extract: async () => {
      calls++;

      return [];
    },
  });

  f.queue.setMaxConcurrent(0);
  const run = collect(await f.saved());
  await until(() => pairs(run.events, "queued").length === 2);
  f.docs.remove("evd_1");
  f.queue.setMaxConcurrent(2);
  const events = await run.done;
  expect(pairs(events, "failure").every((e) => e.code === "document_deleted")).toBe(true);
  expect(pairs(events, "failure")).toHaveLength(2);
  expect(calls).toBe(0);
  expect(f.files()).toEqual([]);
});

test("deletion during a retry delay stops further attempts", async () => {
  let calls = 0;

  const f = fixture({
    retryDelayMs: 60000,
    extract: async () => {
      calls++;
      throw new RetryableError("transient");
    },
  });

  const run = collect(await f.saved({ candidates: candidates(1) }));
  await until(() => run.events.some((e) => e.type === "retrying" && e.admission === "accepted"));
  f.docs.remove("evd_1");
  const events = await run.done;
  expect(calls).toBe(1);
  expect(events.find((e) => e.type === "failure")).toMatchObject({ code: "document_deleted", attempt: 2 });
  expect(f.queue.snapshot().deferred).toBe(0);
  expect(f.files()).toEqual([]);
});

test("a call already dispatched when the entry is deleted still delivers its success", async () => {
  const gate = deferred();
  let calls = 0;

  const f = fixture({
    extract: async () => {
      calls++;
      await gate.promise;

      return [{ field_id: "total", status: "ok", answer: 12 }];
    },
  });

  const run = collect(await f.saved({ candidates: candidates(1) }));
  await until(() => calls === 1);
  f.docs.remove("evd_1");
  await Bun.sleep(20);
  expect(f.files()).toHaveLength(1);
  gate.resolve();
  const events = await run.done;
  expect(pairs(events, "success")).toHaveLength(1);
  expect(pairs(events, "failure")).toEqual([]);
  expect(f.files()).toEqual([]);
  const rerun = await f.saved({ candidates: candidates(1) });
  expect(rerun.status).toBe(404);
});

test("pair ownership separates document instances and survives edits and lost streams", async () => {
  const gate = deferred();
  let calls = 0;

  const f = fixture({
    extract: async () => {
      calls++;
      await gate.promise;

      return [{ field_id: "total", status: "ok", answer: 12 }];
    },
  });

  const aborter = new AbortController();
  const first = collect(await f.upload({ document_instance_id: "doc-a", candidates: candidates(1) }, aborter.signal));
  const other = collect(await f.saved({ document_instance_id: "doc-b", candidates: candidates(1) }));
  await until(() => calls === 2);
  aborter.abort();
  await first.done.catch(() => {});
  const edited = await collect(await f.saved({ document_instance_id: "doc-a", candidates: candidates(1, 5) })).done;
  expect(pairs(edited, "failure")).toMatchObject([
    { admission: "duplicate", candidateId: "candidate0", document_instance_id: "doc-a" },
  ]);
  gate.resolve();
  expect(pairs(await other.done, "success")).toHaveLength(1);
  await f.queue.waitForIdle();
  await until(() => f.files().length === 0);
  const rerun = await collect(await f.saved({ document_instance_id: "doc-a", candidates: candidates(1, 5) })).done;
  expect(pairs(rerun, "success")).toHaveLength(1);
  expect(calls).toBe(3);
});

test("a run action keeps its captured configuration while newer submissions must reconfirm", async () => {
  const seen: Array<{ url?: string; key?: string }> = [];

  const f = fixture({
    extract: async (env) => {
      seen.push({ url: env.MODEL_GATEWAY_URL, key: env.LITELLM_KEY });

      return [{ field_id: "total", status: "ok", answer: 12 }];
    },
  });

  const created = await f.createAction(1);
  expect(created.status).toBe(201);
  const { action_id } = await created.json();
  f.changeConfiguration({
    gateway_url: "http://localhost:9999",
    credential_ciphertext: f.vault.encrypt("workspace", "replacement-credential"),
  });
  const staged = await collect(await f.saved({ action_id, document_instance_id: "doc-a" })).done;
  const upload = await collect(await f.upload({ action_id, document_instance_id: "doc-b" })).done;
  expect(pairs([...staged, ...upload], "success")).toHaveLength(4);
  expect(seen.every((call) => call.url === "http://localhost:1234" && call.key === "private-credential")).toBe(true);
  const text = JSON.stringify([...staged, ...upload]);
  expect(
    text.includes("private-credential") || text.includes("replacement-credential") || text.includes("localhost:"),
  ).toBe(false);
  const stale = await f.saved({ document_instance_id: "doc-c" });
  expect(stale.status).toBe(409);
  expect((await stale.json()).error.code).toBe("configuration_changed");
  const staleAction = await f.createAction(1);
  expect(staleAction.status).toBe(409);
  expect((await staleAction.json()).error.code).toBe("configuration_changed");
  expect(f.files()).toEqual([]);
});

test("unknown, foreign-evaluation and released actions expire explicitly", async () => {
  const f = fixture({ actionIdleMs: 30 });

  const expired = async (response: Response) =>
    response.status === 409 && (await response.json()).error.code === "action_expired";

  expect(await expired(await f.saved({ action_id: "unknown" }))).toBe(true);
  const { action_id: other } = await (await f.createAction(1, "other-evaluation")).json();
  expect(await expired(await f.saved({ action_id: other }))).toBe(true);
  const { action_id } = await (await f.createAction(1)).json();
  expect((await f.releaseAction(action_id)).status).toBe(204);
  expect(await expired(await f.upload({ action_id }))).toBe(true);
  const { action_id: idle } = await (await f.createAction(1)).json();
  expect(pairs(await collect(await f.saved({ action_id: idle })).done, "success")).toHaveLength(2);
  await Bun.sleep(80);
  expect(await expired(await f.saved({ action_id: idle }))).toBe(true);
  const ids: string[] = [];

  for (let i = 0; i < 17; i++) ids.push((await (await f.createAction(1)).json()).action_id);
  expect(await expired(await f.saved({ action_id: ids[0] }))).toBe(true);
  expect(pairs(await collect(await f.saved({ action_id: ids[16] })).done, "success")).toHaveLength(2);
  expect(f.files()).toEqual([]);
});

test("an open operation keeps its action alive past the idle release", async () => {
  const gate = deferred();

  const f = fixture({
    actionIdleMs: 20,
    extract: async () => {
      await gate.promise;

      return [{ field_id: "total", status: "ok", answer: 12 }];
    },
  });

  const { action_id } = await (await f.createAction(1)).json();
  const run = collect(await f.saved({ action_id, candidates: candidates(1) }));
  await Bun.sleep(60);
  const second = collect(await f.upload({ action_id, document_instance_id: "doc-b", candidates: candidates(1) }));
  gate.resolve();
  expect(pairs(await run.done, "success")).toHaveLength(1);
  expect(pairs(await second.done, "success")).toHaveLength(1);
});

test("many sequential document operations with eight candidates each have no selection cap", async () => {
  let calls = 0;

  const f = fixture({
    extract: async () => {
      calls++;

      return [{ field_id: "total", status: "ok", answer: 12 }];
    },
  });

  const { action_id } = await (await f.createAction(1)).json();

  for (let i = 0; i < 30; i++) {
    const request = i % 2 ? f.saved : f.upload;

    const events = await collect(
      await request({ action_id, document_instance_id: "doc-" + i, candidates: candidates(8) }),
    ).done;

    expect(pairs(events, "success")).toHaveLength(8);
  }

  expect(calls).toBe(240);
  expect(f.files()).toEqual([]);
});

test("queue saturation rejects affected pairs explicitly while accepted pairs continue", async () => {
  const queue = createLocalExtractionQueue({ maxConcurrent: 1, maxBuffered: 3 });
  queue.setMaxConcurrent(0);
  const f = fixture({ queue });
  const first = collect(await f.saved({ document_instance_id: "doc-a" }));
  const second = collect(await f.saved({ document_instance_id: "doc-b" }));
  await until(() => second.events.filter((e) => e.candidateId).length >= 2);
  queue.setMaxConcurrent(1);
  const events = [...(await first.done), ...(await second.done)];
  expect(pairs(events, "failure")).toMatchObject([
    { admission: "full", document_instance_id: "doc-b", candidateId: "candidate1" },
  ]);
  expect(pairs(events, "success")).toHaveLength(3);
  expect(f.files()).toEqual([]);
});

test("the Workspace sequential-calls setting serializes pairs across document operations", async () => {
  let active = 0,
    peak = 0;

  const flags = new Set<string>();

  const f = fixture(
    {
      extract: async (env) => {
        flags.add(env.MODEL_GATEWAY_SEQUENTIAL_CALLS!);
        active++;
        peak = Math.max(peak, active);
        await Bun.sleep(5);
        active--;

        return [{ field_id: "total", status: "ok", answer: 12 }];
      },
    },
    { sequentialQueue: true },
  );

  f.changeConfiguration({ sequential_calls: true });
  const { action_id } = await (await f.createAction(2)).json();

  const runs = await Promise.all(
    ["doc-a", "doc-b"].map(
      async (id) => collect(await f.saved({ action_id, revision: 2, document_instance_id: id })).done,
    ),
  );

  expect(pairs(runs.flat(), "success")).toHaveLength(4);
  expect(peak).toBe(1);
  expect([...flags]).toEqual(["true"]);
});
