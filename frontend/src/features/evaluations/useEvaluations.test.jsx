import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEvaluations } from "./useEvaluations.js";
import { createResultCache } from "./resultCache.js";
import { FakeKeyRange, createFakeIndexedDB } from "../../test/fakeIndexedDB.js";

// Answers the confirmation dialog that the hook opened.
async function answerDialog(name) {
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name }));
  });
}

const template = {
  name: "Invoice",
  description: "Invoice",
  fields: [{ id: "total", name: "Total", description: "Total", data_type: "number" }],
};

let setup, streams, actions, database, overrides;

const props = {
  workspaceId: "workspace",
  sessionId: "session",
  enabled: true,
  active: true,
  createCache: () => createResultCache({ indexedDB: database, keyRange: FakeKeyRange }),
};

const calls = (method, path) =>
  fetch.mock.calls.filter(([url, options = {}]) => (options.method || "GET") === method && url === `/v1${path}`);

it("removes an obsolete answer only from the working copy and keeps the saved original", async () => {
  const reference = {
    version: 1,
    definitions: { "total:number": template.fields[0] },
    references: { "total:number": { verified: true, value: 10 } },
  };

  overrides["GET /evaluations/documents/evd_a"] = () => Response.json({ document: { id: "evd_a", name: "A", revision: 1 }, reference });
  const { result } = await initialized({ documents: 0 });

  await act(async () => { await result.current.addSaved([{ id: "evd_a" }]); });
  const doc = result.current.state.documents[0].key;

  act(() => result.current.removeReference(doc, "total:number"));
  expect(result.current.state.documents[0].reference).toEqual({ definitions: {}, references: {} });
  expect(result.current.state.documents[0].base.references["total:number"]).toEqual({ verified: true, value: 10 });
  expect(calls("PATCH", "/evaluations/documents/evd_a")).toHaveLength(0);
});

beforeEach(() => {
  setup = {
    configured: true,
    revision: 1,
    model: "model",
    pdf: false,
    structured: false,
    staging: { document_concurrency: 8 },
  };
  streams = [];
  actions = 0;
  database = createFakeIndexedDB();
  overrides = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options = {}) => {
      const custom = overrides[`${options.method || "GET"} ${url.replace(/^\/v1/, "")}`];

      return custom ? custom(options) : server(url, options);
    }),
  );
});

async function server(url, options = {}) {
  const path = url.replace(/^\/v1/, ""),
    method = options.method || "GET";

  if (path === "/evaluations/setup") return Response.json(setup);

  if (path === "/evaluations/documents/status") return Response.json({ save_available: true, reason: null });

  if (method === "POST" && path === "/evaluations/actions")
    return Response.json({ action_id: `action-${++actions}` }, { status: 201 });

  if (method === "DELETE" && path.startsWith("/evaluations/actions/")) return new Response(null, { status: 204 });

  if (path === "/evaluations/run") {
    const evaluation =
      options.body instanceof FormData ? JSON.parse(options.body.get("evaluation")) : JSON.parse(options.body);

    return new Response(
      new ReadableStream({
        start(controller) {
          streams.push({ evaluation, controller, options });
        },
      }),
    );
  }

  throw new Error(`Unexpected ${method} ${path}`);
}

afterEach(() => vi.unstubAllGlobals());

const file = (name) => new File(["image"], name, { type: "image/png" });

async function initialized({ documents = 1, extra = {} } = {}) {
  const hook = renderHook((value) => useEvaluations(value), { initialProps: { ...props, ...extra } });
  await waitFor(() => expect(hook.result.current.state.setup).toEqual(setup));
  act(() => {
    hook.result.current.start("models", [{ template }, { template }]);
    hook.result.current.addUploads(Array.from({ length: documents }, (_, i) => file(`d${i}.png`)));
  });

  return hook;
}

const pairOf = (result, docIndex, candidateIndex) =>
  result.current.state.pairs[result.current.state.documents[docIndex].key]?.[
    result.current.state.candidates[candidateIndex].id
  ];

it("ignores a pending library edit after clearing the Evaluation or canceling the library modal", async () => {
  let finish;
  overrides["GET /evaluations/documents/evd_a"] = () => new Promise((resolve) => { finish = resolve; });
  const { result } = await initialized({ documents: 0 });

  const loaded = {
    document: { id: "evd_a", name: "Invoice", revision: 1 },
    reference: { version: 1, definitions: { "total:number": template.fields[0] }, references: {} },
  };

  let opening;
  act(() => { opening = result.current.editSaved({ id: "evd_a" }); });
  act(() => result.current.clear());
  await act(async () => {
    finish(Response.json(loaded));
    expect(await opening).toBe(false);
  });
  expect(result.current.state.libraryEditor).toBeNull();
  expect(result.current.state.documents).toHaveLength(0);

  const controller = new AbortController();
  act(() => { opening = result.current.editSaved({ id: "evd_a" }, controller.signal); });
  controller.abort();
  await act(async () => {
    finish(Response.json(loaded));
    expect(await opening).toBe(false);
  });
  expect(result.current.state.documents).toHaveLength(0);
});

const send = (stream, event) =>
  stream.controller.enqueue(
    new TextEncoder().encode(
      JSON.stringify({
        submissionId: stream.evaluation.id,
        document_instance_id: stream.evaluation.document_instance_id,
        ...event,
      }) + "\n",
    ),
  );

const success = (stream, index, answer = 10, extra = {}) =>
  send(stream, {
    type: "success",
    candidateId: stream.evaluation.candidates[index].id,
    revision: stream.evaluation.candidates[index].revision,
    attempt: 1,
    result: {
      raw: [{ field_id: "total", status: "ok", answer }],
      fields: template.fields,
      model: stream.evaluation.candidates[index].model,
      attempts: 1,
      processingMs: 5,
      ...extra,
    },
  });

it("uploads once, preserves submitted snapshots during edits, keeps the previous success after a failed rerun", async () => {
  const { result } = await initialized();
  const candidate = result.current.state.candidates[0];
  act(() => {
    result.current.run(result.current.state.candidates.map((c) => c.id));
  });
  await waitFor(() => expect(streams).toHaveLength(1));
  const [stream] = streams;
  expect(stream.evaluation).toMatchObject({
    action_id: "action-1",
    document_instance_id: result.current.state.documents[0].key,
    evaluationId: result.current.state.id,
  });
  expect(stream.options.body.get("document").name).toBe("d0.png");
  act(() => result.current.edit(candidate.id, { model: "edited" }));
  expect(stream.evaluation.candidates[0].model).toBe("model");
  await act(async () => {
    success(stream, 0);
    send(stream, { type: "failure", candidateId: stream.evaluation.candidates[1].id, revision: 0, message: "failed" });
    stream.controller.close();
  });
  await waitFor(() => expect(pairOf(result, 0, 0).status).toBe("success"));
  expect(pairOf(result, 0, 0).result).toMatchObject({ revision: 0, model: "model" });
  expect(pairOf(result, 0, 1)).toMatchObject({ status: "failure", message: "failed" });
  await waitFor(() => expect(calls("DELETE", "/evaluations/actions/action-1")).toHaveLength(1));
  act(() => {
    result.current.run([candidate.id]);
  });
  await waitFor(() => expect(streams).toHaveLength(2));
  expect(streams[1].evaluation.candidates[0]).toMatchObject({ revision: 1, model: "edited" });
  expect(pairOf(result, 0, 0)).toMatchObject({ result: null, previous: { model: "model" } });
  await act(async () => {
    send(streams[1], { type: "failure", candidateId: candidate.id, revision: 1, message: "Failed rerun" });
    streams[1].controller.close();
  });
  await waitFor(() => expect(pairOf(result, 0, 0).status).toBe("failure"));
  expect(pairOf(result, 0, 0)).toMatchObject({ result: null, previous: { model: "model", revision: 0 } });
  expect(calls("POST", "/evaluations/run")).toHaveLength(2);
});

it("same-Workspace navigation preserves state; clear ignores late events without replay", async () => {
  const { result, rerender } = await initialized();
  const documents = result.current.state.documents;
  rerender({ ...props, active: false });
  expect(result.current.state.documents).toBe(documents);
  act(() => {
    result.current.run(result.current.state.candidates.map((c) => c.id));
  });
  await waitFor(() => expect(streams).toHaveLength(1));
  act(() => result.current.clear());
  await act(async () => {
    success(streams[0], 0, 99);
    streams[0].controller.close();
  });
  expect(result.current.state.candidates).toEqual([]);
  expect(result.current.state.documents).toEqual([]);
  expect(result.current.state.pairs).toEqual({});
  expect(calls("POST", "/evaluations/run")).toHaveLength(1);
});

it("interruption retains completed results, marks unfinished pairs and never replays", async () => {
  const { result } = await initialized();
  act(() => {
    result.current.run(result.current.state.candidates.map((c) => c.id));
  });
  await waitFor(() => expect(streams).toHaveLength(1));
  await act(async () => {
    success(streams[0], 0);
    streams[0].controller.error(new Error("Network lost"));
  });
  await waitFor(() => expect(pairOf(result, 0, 1).status).toBe("interrupted"));
  expect(pairOf(result, 0, 0).result).toMatchObject({ model: "model" });
  expect(calls("POST", "/evaluations/run")).toHaveLength(1);
});

it("duplicate inherits edits only; a mode change keeps documents but discards unsaved answer edits", async () => {
  const { result } = await initialized();
  const first = result.current.state.candidates[0];
  act(() => result.current.edit(first.id, { model: "changed" }));
  act(() => result.current.duplicate(first.id));
  expect(result.current.state.candidates[2]).toMatchObject({ model: "changed", revision: 0 });
  const doc = result.current.state.documents[0].key;
  act(() => result.current.setReference(doc, "total:number", { verified: true, value: "10" }, template.fields[0]));
  act(() => {
    void result.current.changeMode("templates");
  });
  await answerDialog("Cancel");
  expect(result.current.state.mode).toBe("models");
  act(() => {
    void result.current.changeMode("templates");
  });
  await answerDialog("Change mode");
  await waitFor(() => expect(result.current.state.mode).toBe("templates"));
  expect(result.current.state.candidates).toEqual([]);
  expect(result.current.state.documents.map((d) => d.key)).toEqual([doc]);
  expect(result.current.state.documents[0].reference.references).toEqual({});
});

it("asks before discarding a temporary Evaluation and keeps it when the prompt is declined", async () => {
  const { result } = await initialized();
  let verdict;
  act(() => {
    verdict = result.current.confirmDiscard();
  });
  expect(verdict).toBeInstanceOf(Promise);
  await answerDialog("Keep evaluation");
  await expect(verdict).resolves.toBe(false);
  expect(result.current.state.documents).toHaveLength(1);
});

it("ignores an old Workspace denial after switching scope", async () => {
  const forbidden = vi.fn();
  let resolve;
  const { result, rerender } = await initialized({ extra: { onForbidden: forbidden } });
  fetch.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  let request;
  act(() => {
    request = result.current.api("/evaluations/templates/old").catch(() => {});
  });
  rerender({ ...props, workspaceId: "other", onForbidden: forbidden });
  await act(async () => {
    resolve(Response.json({ error: { message: "Old denial" } }, { status: 403 }));
    await request;
  });
  expect(forbidden).not.toHaveBeenCalled();
});

it("starts the chosen candidates in the chosen mode and removes idle candidates", async () => {
  const hook = renderHook((value) => useEvaluations(value), { initialProps: props });
  await waitFor(() => expect(hook.result.current.state.setup).toEqual(setup));
  let ids;
  act(() => {
    ids = hook.result.current.start("templates", [
      { template },
      { template: { ...template, name: "Invoice v2" } },
      { template },
    ]);
  });
  expect(hook.result.current.state.mode).toBe("templates");
  expect(hook.result.current.state.candidates.map((c) => [c.id, c.model, c.template.name])).toEqual([
    [ids[0], "model", "Invoice"],
    [ids[1], "model", "Invoice v2"],
    [ids[2], "model", "Invoice"],
  ]);
  act(() => {
    hook.result.current.start("models", [
      { template, model: "alpha" },
      { template, model: "beta" },
    ]);
  });
  expect(hook.result.current.state.candidates.map((c) => c.model)).toEqual(["alpha", "beta"]);
  act(() => hook.result.current.remove(hook.result.current.state.candidates[0].id));
  expect(hook.result.current.state.candidates.map((c) => c.model)).toEqual(["beta"]);
  act(() => hook.result.current.remove(hook.result.current.state.candidates[0].id));
  expect(hook.result.current.state.candidates).toHaveLength(1);
});

it("stages one action's document operations within the service concurrency and releases the action", async () => {
  setup.staging.document_concurrency = 2;
  const { result } = await initialized({ documents: 3 });
  act(() => {
    result.current.run(result.current.state.candidates.map((c) => c.id));
  });
  await waitFor(() => expect(streams).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(streams).toHaveLength(2);
  expect(pairOf(result, 2, 0).status).toBe("staged");
  expect(calls("POST", "/evaluations/actions")).toHaveLength(1);
  // One document per request with every submitted candidate.
  expect(streams.map((s) => s.evaluation.candidates.length)).toEqual([2, 2]);
  await act(async () => {
    success(streams[0], 0);
    success(streams[0], 1);
    streams[0].controller.close();
  });
  await waitFor(() => expect(streams).toHaveLength(3));
  expect(new Set(streams.map((s) => s.evaluation.document_instance_id)).size).toBe(3);
  await act(async () => {
    for (const stream of streams.slice(1)) {
      success(stream, 0);
      success(stream, 1);
      stream.controller.close();
    }
  });
  await waitFor(() => expect(calls("DELETE", "/evaluations/actions/action-1")).toHaveLength(1));
});

it("never overlaps a busy pair but lets idle pairs run, and snapshots staged work at click", async () => {
  setup.staging.document_concurrency = 1;
  const { result } = await initialized({ documents: 2 });
  const [a, b] = result.current.state.candidates.map((c) => c.id);
  const [first, second] = result.current.state.documents.map((d) => d.key);
  act(() => {
    result.current.run([a], [first]);
    result.current.run([a], [first]);
  });
  act(() => {
    result.current.run([a, b], [second]);
  });
  await waitFor(() => expect(streams).toHaveLength(1));
  expect(pairOf(result, 1, 0).status).toBe("staged");
  // Edits after the click don't change work still waiting for staging.
  act(() => result.current.edit(a, { model: "later edit" }));
  await act(async () => {
    success(streams[0], 0);
    streams[0].controller.close();
  });
  await waitFor(() => expect(streams).toHaveLength(2));
  expect(streams[1].evaluation.document_instance_id).toBe(second);
  expect(streams[1].evaluation.candidates.map((c) => c.model)).toEqual(["model", "model"]);
  expect(calls("POST", "/evaluations/actions")).toHaveLength(2);
  // Candidate b on the first document is idle and may run while the second document is busy.
  act(() => {
    result.current.run([b], [first]);
    result.current.run([a, b], [second]);
  });
  expect(pairOf(result, 0, 1).status).toBe("staged");
  await act(async () => {
    success(streams[1], 0);
    success(streams[1], 1);
    streams[1].controller.close();
  });
  await waitFor(() => expect(streams).toHaveLength(3));
  expect(streams[2].evaluation.document_instance_id).toBe(first);
  expect(streams[2].evaluation.candidates.map((c) => c.id)).toEqual([b]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(streams).toHaveLength(3);
});

it("replaces an expired action once, then keeps the refreshed action for the retry", async () => {
  let first = true;
  const { result } = await initialized();
  overrides["POST /evaluations/run"] = (options) => {
    if (first) {
      first = false;

      return Response.json(
        { error: { code: "action_expired", message: "This run expired. Run again." } },
        { status: 409 },
      );
    }

    return server("/v1/evaluations/run", options);
  };

  act(() => {
    result.current.run(result.current.state.candidates.map((c) => c.id));
  });
  await waitFor(() => expect(streams).toHaveLength(1));
  expect(streams[0].evaluation.action_id).toBe("action-2");
  expect(calls("POST", "/evaluations/run")).toHaveLength(2);

  const [expired, retried] = calls("POST", "/evaluations/run").map(
    ([, options]) => options.headers["x-evaluation-submission"],
  );

  expect(expired).not.toBe(retried);
});

it("sends saved entries by identity and handles deletion and missing originals per document", async () => {
  const entry = (id) => ({
    document: { id, name: id, revision: 1, source_name: `${id}.pdf`, fields: [] },
    reference: {
      version: 1,
      definitions: { "total:number": template.fields[0] },
      references: { "total:number": { verified: true, absent: false, exact: false, value: "10" } },
    },
  });

  overrides["GET /evaluations/documents/evd_a"] = () => Response.json(entry("evd_a"));
  overrides["GET /evaluations/documents/evd_b"] = () => Response.json(entry("evd_b"));
  const { result } = await initialized({ documents: 0 });
  await act(async () => {
    await result.current.addSaved([{ id: "evd_a" }, { id: "evd_b" }]);
  });
  expect(
    result.current.state.documents.map((d) => [
      d.kind,
      d.loadedRevision,
      d.reference.references["total:number"].verified,
    ]),
  ).toEqual([
    ["saved", 1, true],
    ["saved", 1, true],
  ]);
  overrides["POST /evaluations/run"] = (options) =>
    JSON.parse(options.body).document.id === "evd_b"
      ? Response.json({ error: { code: "source_missing", message: "Missing" } }, { status: 404 })
      : server("/v1/evaluations/run", options);
  act(() => {
    result.current.run(result.current.state.candidates.map((c) => c.id));
  });
  await waitFor(() => expect(streams).toHaveLength(1));
  expect(streams[0].options.headers["content-type"]).toBe("application/json");
  expect(JSON.parse(streams[0].options.body).document).toEqual({ kind: "saved", id: "evd_a" });
  await waitFor(() => expect(result.current.state.documents[1].availability).toBe("missing"));
  expect(pairOf(result, 1, 0).status).toBe("failure");
  await act(async () => {
    success(streams[0], 0);
    send(streams[0], {
      type: "failure",
      code: "document_deleted",
      message: "Deleted from the Evaluation library.",
      candidateId: streams[0].evaluation.candidates[1].id,
      revision: 0,
      attempt: 1,
    });
    streams[0].controller.close();
  });
  await waitFor(() => expect(result.current.state.documents[0].availability).toBe("deleted"));
  expect(pairOf(result, 0, 0).status).toBe("success");
  // Deleted and unavailable documents are excluded from further runs.
  act(() => {
    result.current.run(result.current.state.candidates.map((c) => c.id));
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(streams).toHaveLength(1);
});

it("reuses the save operation id after a lost response and never marks answers verified", async () => {
  const bodies = [];
  overrides["POST /evaluations/documents"] = (options) => {
    const metadata = JSON.parse(options.body.get("metadata"));
    bodies.push(metadata);

    if (bodies.length === 1) throw new TypeError("Failed to fetch");

    return Response.json(
      { document: { id: "evd_new", name: metadata.name, revision: 1 }, reference: metadata.reference },
      { status: 200 },
    );
  };

  const { result } = await initialized();
  const doc = result.current.state.documents[0].key;
  act(() =>
    result.current.setReference(
      doc,
      "total:number",
      { verified: false, absent: false, exact: false, value: "12" },
      template.fields[0],
    ),
  );
  await act(async () => {
    expect(await result.current.saveDocument(doc, "Invoice")).toBe(false);
  });
  expect(result.current.state.documents[0]).toMatchObject({ kind: "upload", save: "failed" });
  await act(async () => {
    expect(await result.current.saveDocument(doc, "Invoice")).toBe(true);
  });
  expect(bodies.map((b) => b.operation_id)).toEqual([bodies[0].operation_id, bodies[0].operation_id]);
  expect(bodies[1].reference.references["total:number"]).toMatchObject({ verified: false, value: "12" });
  expect(result.current.state.documents[0]).toMatchObject({
    kind: "saved",
    entry: { id: "evd_new" },
    loadedRevision: 1,
  });
});

it("returns the current saved set on a stale update and replaces it only against the reviewed revision", async () => {
  const current = {
    document: { id: "evd_a", name: "A", revision: 3, updated_by_name: "Priya" },
    reference: { version: 1, definitions: {}, references: {} },
  };

  const patches = [];
  overrides["GET /evaluations/documents/evd_a"] = () =>
    Response.json({
      document: { id: "evd_a", name: "A", revision: 1 },
      reference: { version: 1, definitions: {}, references: {} },
    });
  overrides["PATCH /evaluations/documents/evd_a"] = (options) => {
    const body = JSON.parse(options.body);
    patches.push(body);

    return body.expected_revision === 3
      ? Response.json({ document: { ...current.document, revision: 4 }, reference: body.reference })
      : Response.json({ error: { code: "revision_conflict", message: "Changed" }, current }, { status: 409 });
  };

  const { result } = await initialized({ documents: 0 });
  await act(async () => {
    await result.current.addSaved([{ id: "evd_a" }]);
  });
  const doc = result.current.state.documents[0].key;
  act(() =>
    result.current.setReference(
      doc,
      "total:number",
      { verified: true, absent: false, exact: false, value: "10" },
      template.fields[0],
    ),
  );
  let outcome;
  await act(async () => {
    outcome = await result.current.updateSaved(doc);
  });
  expect(outcome.conflict).toEqual(current);
  expect(result.current.state.documents[0].reference.references["total:number"].value).toBe("10");
  await act(async () => {
    outcome = await result.current.updateSaved(doc, outcome.conflict.document.revision);
  });
  expect(outcome.ok).toBe(true);
  expect(patches.map((p) => p.expected_revision)).toEqual([1, 3]);
  expect(result.current.state.documents[0]).toMatchObject({ loadedRevision: 4 });
  // A live change is a freshness hint only.
  act(() => result.current.documentChanged({ document_id: "evd_a", revision: 5, deleted: false }));
  expect(result.current.state.documents[0]).toMatchObject({ newerRevision: 5, loadedRevision: 4 });
  act(() => result.current.documentChanged({ document_id: "evd_a", revision: null, deleted: true }));
  expect(result.current.state.documents[0].availability).toBe("deleted");
});

it("keeps result details encrypted in the cache and decrypts them again on demand without running models", async () => {
  const { result } = await initialized();
  act(() => {
    result.current.run(result.current.state.candidates.map((c) => c.id));
  });
  await waitFor(() => expect(streams).toHaveLength(1));
  await act(async () => {
    success(streams[0], 0, 10);
    success(streams[0], 1, 12);
    streams[0].controller.close();
  });
  await waitFor(() =>
    expect([pairOf(result, 0, 0).detail, pairOf(result, 0, 1).detail]).toEqual(["retained", "retained"]),
  );
  expect(JSON.stringify(database.records())).not.toContain("total");
  // Leaving the document drops its decrypted details; returning reads them back from the cache.
  act(() => result.current.hydrate([]));
  const recordId = pairOf(result, 0, 0).result.recordId;
  act(() => result.current.hydrate([recordId]));
  await waitFor(() =>
    expect(result.current.detail(recordId)?.raw).toEqual(
      expect.arrayContaining([expect.objectContaining({ field_id: "total", answer: 10 })]),
    ),
  );
  const doc = result.current.state.documents[0].key;
  act(() =>
    result.current.setReference(
      doc,
      "total:number",
      { verified: true, absent: false, exact: false, value: "10" },
      template.fields[0],
    ),
  );
  expect(calls("POST", "/evaluations/run")).toHaveLength(1);
});

it("pauses staging when result details can't be stored and resumes only after an explicit retry", async () => {
  setup.staging.document_concurrency = 1;
  const { result } = await initialized({ documents: 3 });
  database.failWrites = "QuotaExceededError";
  act(() => {
    result.current.run(result.current.state.candidates.map((c) => c.id));
  });
  await waitFor(() => expect(streams).toHaveLength(1));
  await act(async () => {
    success(streams[0], 0);
    success(streams[0], 1);
    streams[0].controller.close();
  });
  await waitFor(() => expect(result.current.state.cacheError).toMatchObject({ code: "quota" }));
  await waitFor(() => expect(pairOf(result, 0, 0).detail).toBe("unavailable"));
  // A document already opened before the failure settles on its own; nothing new opens afterwards.
  await act(async () => {
    for (const stream of streams.slice(1)) stream.controller.close();
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const opened = streams.length;
  expect(opened).toBeLessThan(3);
  expect(pairOf(result, 2, 0).status).toBe("staged");
  await act(async () => {
    expect(await result.current.retryCache()).toBe(false);
  });
  database.failWrites = null;
  await act(async () => {
    expect(await result.current.retryCache()).toBe(true);
  });
  expect(result.current.state.cacheError).toBeNull();
  await waitFor(() => expect(streams).toHaveLength(opened + 1));
});
