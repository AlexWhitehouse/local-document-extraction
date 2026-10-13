import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalWorkspaceProductStore, type LocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { readModelCallUsage } from "./consumer/modelUsage";
import { parseCostRange } from "../../shared/workspaceCosts";
import { costAmount } from "../../shared/processingCosts";

const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});

function fixture() {
  const stateDirectory = mkdtempSync(join(tmpdir(), "workspace-model-costs-"));
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "test" });
  store.closeCostUpdates();
  cleanup.push(() => {
    store.close();
    rmSync(stateDirectory, { recursive: true, force: true });
  });

  return { store, path: join(stateDirectory, "data/workspaces/test.sqlite") };
}

function search(store: LocalWorkspaceProductStore, at: string, cost: number | null, finished = true) {
  const observer = store.workspaceModelCallObserver({
    purpose: "search",
    model: "assistant",
    configurationRevision: 2,
    now: () => at,
  });

  const id = observer.started();

  if (finished) observer.finished(id, readModelCallUsage({ id: "req_1", usage: { cost, prompt_tokens: 40 } }));

  return { observer, id };
}

test("search calls are summed for the range, start inclusive and end exclusive", () => {
  const { store } = fixture();
  search(store, "2026-09-02T23:59:59.999Z", 5);
  search(store, "2026-09-03T00:00:00.000Z", 0.25);
  search(store, "2026-09-03T12:00:00.000Z", 0.5);
  search(store, "2026-09-03T13:00:00.000Z", null);
  search(store, "2026-09-03T14:00:00.000Z", 0, false);
  search(store, "2026-09-04T00:00:00.000Z", 7);

  const overview = store.getCostOverview(parseCostRange("2026-09-03", "2026-09-04", "day"));

  expect(overview.searches).toEqual({ calls: 4, costs: costAmount(0.75, 2, 2) });
  // Search spend is the Workspace's and never enters Document totals.
  expect(overview.totals.costs.total).toEqual(costAmount());
  // No upload history before the range, so there is nothing to compare with.
  expect(overview.previous).toBeNull();
  expect(overview.previous_searches).toBeNull();
  expect(store.getCostOverview(parseCostRange("2026-09-05", "2026-09-06", "day")).searches).toEqual({
    calls: 0,
    costs: costAmount(),
  });
});

test("previous searches follow the same rule as previous Document totals", () => {
  const { store } = fixture();
  store.createTemplate({
    templateId: "tpl",
    name: "Invoice",
    description: null,
    fields: [{ id: "total", name: "Total", description: "Total", data_type: "number" }],
    createdAt: "2026-09-01T00:00:00.000Z",
  });
  store.createQueuedExtractionJob({
    jobId: "job",
    templateId: "tpl",
    templateVersion: 1,
    sourceFileKey: "job/source.pdf",
    sourceMimeType: "application/pdf",
    sourceName: "job.pdf",
    sourceFilePageCount: 1,
    submittedAt: "2026-09-01T10:00:00.000Z",
  });

  for (let attempts = 0; store.processCostUpdates(50, 1000); attempts++)
    if (attempts > 1000) throw new Error("Cost backfill did not finish");

  search(store, "2026-09-02T08:00:00.000Z", 0.1);
  search(store, "2026-09-03T08:00:00.000Z", 0.2);

  const overview = store.getCostOverview(parseCostRange("2026-09-03", "2026-09-04", "day"));

  expect(overview.previous).not.toBeNull();
  expect(overview.searches).toEqual({ calls: 1, costs: costAmount(0.2, 1, 0) });
  expect(overview.previous_searches).toEqual({ calls: 1, costs: costAmount(0.1, 1, 0) });
});

test("a receipt is written once and keeps no request content", () => {
  const { store, path } = fixture();
  const { observer, id } = search(store, "2026-09-03T00:00:00.000Z", 0.3);
  observer.finished(id, readModelCallUsage({ usage: { cost: 9 } }));

  const db = new Database(path, { readonly: true });
  cleanup.push(() => db.close());

  expect(db.query("SELECT * FROM workspace_model_costs").all()).toEqual([
    {
      id,
      purpose: "search",
      model: "assistant",
      configuration_revision: 2,
      request_id: "req_1",
      amount: 0.3,
      currency: "USD",
      cost_source: "usage.cost",
      input_tokens: 40,
      output_tokens: null,
      cached_input_tokens: null,
      started_at: "2026-09-03T00:00:00.000Z",
      finished_at: "2026-09-03T00:00:00.000Z",
    },
  ]);
  expect(db.query("SELECT 1 FROM product_schema_version WHERE version=18").get()).toBeTruthy();

  const plan = db
    .query<{ detail: string }, string[]>(
      "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM workspace_model_costs WHERE started_at>=? AND started_at<? AND purpose=?",
    )
    .all("a", "b", "search");

  expect(plan.map((step) => step.detail).join("\n")).toContain("idx_workspace_model_costs_started");
});
