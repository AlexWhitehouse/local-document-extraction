import type { Database } from "bun:sqlite";
import { createCostProjection } from "./workspaceCostProjection";
import { createCostQueries } from "./workspaceCostQueries";

type Work = { run(): boolean; nextAt: number; lastErrorAt: number };
const workspaces = new Set<Work>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** One global time budget, even when many Workspace stores are open or backfilling. */
function schedule() {
  if (timer || !workspaces.size) return;
  timer = setTimeout(() => {
    timer = undefined;
    for (const work of workspaces) {
      if (work.nextAt > Date.now()) continue;
      workspaces.delete(work); workspaces.add(work);
      try { work.nextAt = Date.now() + (work.run() ? 50 : 1000); }
      catch (error) {
        work.nextAt = Date.now() + 1000;
        if (Date.now() - work.lastErrorAt > 60000) {
          console.error("Workspace cost summaries could not be updated", error instanceof Error ? error.message : "Unknown error");
          work.lastErrorAt = Date.now();
        }
      }
      break;
    }
    schedule();
  }, 50);
  timer.unref();
}

export function createWorkspaceCostStore(db: Database) {
  const projection = createCostProjection(db);
  const work: Work = { run: () => projection.processCostUpdates(), nextAt: 0, lastErrorAt: 0 };
  workspaces.add(work); schedule();
  return { ...projection, ...createCostQueries(db), closeCostUpdates() {
    workspaces.delete(work);
    if (!workspaces.size && timer) { clearTimeout(timer); timer = undefined; }
  } };
}
