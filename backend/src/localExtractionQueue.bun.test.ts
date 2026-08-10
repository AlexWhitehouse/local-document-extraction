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

test("the local extraction queue does not dispatch a retry before its not-before time", async () => {
  let dispatchTimer: (() => void) | undefined;
  let scheduledDelayMs: number | undefined;
  let started = false;
  const queue = createLocalExtractionQueue({
    now: () => Date.parse("2026-07-10T20:00:00.000Z"),
    scheduleTimer: (handler, delayMs) => {
      dispatchTimer = handler;
      scheduledDelayMs = delayMs;
    },
  });
  queue.subscribe(() => {
    started = true;
  });

  await queue.schedule({
    job_id: "job_invoice_retry",
    workspace_id: "workspace_research",
    template_id: "tpl_invoice",
    template_version: 1,
    enqueued_at: "2026-07-10T20:00:00.000Z",
    attempt: 2,
    not_before: "2026-07-10T20:15:00.000Z",
  });

  expect(started).toBe(false);
  expect(scheduledDelayMs).toBe(15 * 60 * 1000);
  dispatchTimer?.();
  expect(started).toBe(true);
});
