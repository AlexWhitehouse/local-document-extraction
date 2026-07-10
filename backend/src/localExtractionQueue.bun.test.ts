import { expect, test } from "bun:test";

import { createLocalExtractionQueue } from "./localExtractionQueue";

test("the local extraction queue notifies asynchronous handlers without delaying submission scheduling", async () => {
  const queue = createLocalExtractionQueue();
  let started = false;
  let releaseHandler: (() => void) | undefined;
  let completedHandler: (() => void) | undefined;
  const handlerFinished = new Promise<void>((resolve) => {
    completedHandler = resolve;
  });
  const handlerGate = new Promise<void>((resolve) => {
    releaseHandler = resolve;
  });

  queue.subscribe(async () => {
    started = true;
    await handlerGate;
    completedHandler?.();
  });

  await queue.schedule({
    job_id: "job_invoice",
    workspace_id: "workspace_research",
    template_id: "tpl_invoice",
    template_version: 1,
    enqueued_at: "2026-07-09T12:00:00.000Z",
  });

  expect(started).toBe(true);
  releaseHandler?.();
  await handlerFinished;
});
