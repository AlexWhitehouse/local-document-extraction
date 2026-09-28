import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEvaluations } from "./useEvaluations.js";
const template = { name: "Invoice", description: "Invoice", fields: [{ id: "total", name: "Total", description: "Total", data_type: "number" }] };
const setup = { configured: true, revision: 1, model: "model", pdf: false, structured: false };
const props = { workspaceId: "workspace", sessionId: "session", enabled: true, active: true };
let stream, submitted;
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url.endsWith("/setup")) return Response.json(setup);
    submitted = JSON.parse(options.body.get("evaluation"));
    return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
  }));
});
afterEach(() => vi.unstubAllGlobals());
async function initialized(extra = {}) {
  const hook = renderHook(value => useEvaluations(value), { initialProps: { ...props, ...extra } });
  await waitFor(() => expect(hook.result.current.state.setup).toEqual(setup));
  act(() => { hook.result.current.start("models", [{ template }, { template }]); hook.result.current.patch({ document: new File(["image"], "a.png", { type: "image/png" }) }); });
  return hook;
}
function send(event) { stream.enqueue(new TextEncoder().encode(JSON.stringify({ submissionId: submitted.id, ...event }) + "\n")); }
it("uploads once, preserves submitted snapshots during edits, retains prior success on failed rerun", async () => {
  const { result } = await initialized();
  const candidate = result.current.state.candidates[0]; let running;
  act(() => { running = result.current.run(result.current.state.candidates.map(c => c.id)); });
  await waitFor(() => expect(submitted.candidates).toHaveLength(2));
  act(() => result.current.edit(candidate.id, { model: "edited" }));
  expect(submitted.candidates[0].model).toBe("model");
  await act(async () => {
    send({ type: "success", candidateId: candidate.id, revision: 0, attempt: 1, result: { raw: [], fields: template.fields, model: "model", attempts: 1 } });
    send({ type: "failure", candidateId: submitted.candidates[1].id, revision: 0, message: "failed" });
    send({ type: "cleanup", status: "complete" }); stream.close(); await running;
  });
  expect(result.current.state.candidates[0]).toMatchObject({ revision: 1, model: "edited", result: { revision: 0, model: "model" } });
  act(() => { running = result.current.run([candidate.id]); });
  await waitFor(() => expect(submitted.candidates[0].revision).toBe(1));
  await act(async () => { send({ type: "failure", candidateId: candidate.id, revision: 1, message: "Failed rerun" }); stream.close(); await running; });
  expect(result.current.state.candidates[0]).toMatchObject({ status: "failure", result: { model: "model", revision: 0 } });
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("/run"))).toHaveLength(2);
});
it("same-Workspace navigation preserves state; clear ignores late events without replay", async () => {
  const { result, rerender } = await initialized();
  const document = result.current.state.document;
  rerender({ ...props, active: false }); expect(result.current.state.document).toBe(document);
  let running; act(() => { running = result.current.run(result.current.state.candidates.map(c => c.id)); });
  await waitFor(() => expect(stream).toBeDefined());
  act(() => result.current.clear());
  await act(async () => { send({ type: "success", candidateId: submitted.candidates[0].id, revision: 0, result: { model: "late" } }); stream.close(); await running; });
  expect(result.current.state.candidates).toEqual([]); expect(result.current.state.document).toBeNull();
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("/run"))).toHaveLength(1);
});
it("interruption retains completed results, marks unfinished candidates and never replays", async () => {
  const { result } = await initialized(); let running;
  act(() => { running = result.current.run(result.current.state.candidates.map(c => c.id)); });
  await waitFor(() => expect(submitted).toBeDefined());
  await act(async () => { send({ type: "success", candidateId: submitted.candidates[0].id, revision: 0, result: { model: "model" } }); stream.error(new Error("Network lost")); await running; });
  expect(result.current.state.candidates[0].result).toMatchObject({ model: "model" });
  expect(result.current.state.candidates[1].status).toBe("interrupted");
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("/run"))).toHaveLength(1);
});
it("duplicate inherits edits only and mode reset keeps only the document", async () => {
  const { result } = await initialized();
  const first = result.current.state.candidates[0];
  act(() => result.current.edit(first.id, { model: "changed", result: { model: "old" } }));
  act(() => result.current.duplicate(first.id));
  expect(result.current.state.candidates[2]).toMatchObject({ model: "changed", result: null, revision: 0 });
  vi.spyOn(window, "confirm").mockReturnValue(false);
  act(() => result.current.changeMode("templates")); expect(result.current.state.mode).toBe("models");
  window.confirm.mockReturnValue(true);
  act(() => result.current.changeMode("templates"));
  expect(result.current.state.mode).toBe("templates"); expect(result.current.state.document).not.toBeNull(); expect(result.current.state.candidates).toEqual([]);
  window.confirm.mockRestore();
});

it("ignores an old Workspace denial after switching scope", async () => {
  const forbidden = vi.fn(); let resolve;
  const { result, rerender } = await initialized({ onForbidden: forbidden });
  fetch.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  let request; act(() => { request = result.current.api("/evaluations/templates/old").catch(() => {}); });
  rerender({ ...props, workspaceId: "other", onForbidden: forbidden });
  await act(async () => { resolve(Response.json({ error: { message: "Old denial" } }, { status: 403 })); await request; });
  expect(forbidden).not.toHaveBeenCalled();
});
it("starts the chosen candidates in the chosen mode and removes idle candidates", async () => {
  const hook = renderHook(value => useEvaluations(value), { initialProps: props });
  await waitFor(() => expect(hook.result.current.state.setup).toEqual(setup));
  let ids;
  act(() => { ids = hook.result.current.start("templates", [{ template }, { template: { ...template, name: "Invoice v2" } }, { template }]); });
  expect(hook.result.current.state.mode).toBe("templates");
  expect(hook.result.current.state.candidates.map(c => [c.id, c.model, c.template.name])).toEqual([[ids[0], "model", "Invoice"], [ids[1], "model", "Invoice v2"], [ids[2], "model", "Invoice"]]);
  act(() => { hook.result.current.start("models", [{ template, model: "alpha" }, { template, model: "beta" }]); });
  expect(hook.result.current.state.candidates.map(c => c.model)).toEqual(["alpha", "beta"]);
  act(() => hook.result.current.remove(hook.result.current.state.candidates[0].id));
  expect(hook.result.current.state.candidates.map(c => c.model)).toEqual(["beta"]);
  act(() => hook.result.current.remove(hook.result.current.state.candidates[0].id));
  expect(hook.result.current.state.candidates).toHaveLength(1);
});
