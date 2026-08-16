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

test("the local extraction queue bounds active handlers and keeps only metadata pending", async () => {
  const queue = createLocalExtractionQueue({ maxConcurrent: 2 });
  const releases: Array<() => void> = [];
  queue.subscribe(async () => {
    await new Promise<void>((resolve) => releases.push(resolve));
  });

  await Promise.all([
    queue.schedule(job("job_1", "workspace_one")),
    queue.schedule(job("job_2", "workspace_one")),
    queue.schedule(job("job_3", "workspace_one")),
  ]);

  expect(queue.snapshot()).toMatchObject({ active: 2, maxConcurrent: 2, pending: 1 });
  releases.shift()?.();
  await waitFor(() => queue.snapshot().pending === 0);
  expect(queue.snapshot().active).toBe(2);
  for (const release of releases.splice(0)) release();
  await queue.waitForIdle();
  expect(queue.snapshot()).toMatchObject({ active: 0, pending: 0 });
});

test("the local extraction queue rotates Workspaces while preserving FIFO inside each Workspace", async () => {
  const queue = createLocalExtractionQueue({ maxConcurrent: 1 });
  await queue.schedule(job("job_a1", "workspace_a"));
  await queue.schedule(job("job_a2", "workspace_a"));
  await queue.schedule(job("job_b1", "workspace_b"));
  const order: string[] = [];
  const releases: Array<() => void> = [];
  queue.subscribe(async (queued) => {
    order.push(queued.job_id);
    await new Promise<void>((resolve) => releases.push(resolve));
  });

  expect(order).toEqual(["job_a1"]);
  releases.shift()?.();
  await waitFor(() => order.length === 2);
  expect(order).toEqual(["job_a1", "job_b1"]);
  releases.shift()?.();
  await waitFor(() => order.length === 3);
  expect(order).toEqual(["job_a1", "job_b1", "job_a2"]);
  releases.shift()?.();
  await queue.waitForIdle();
});

test("the local extraction queue deduplicates the same job attempt", async () => {
  const queue = createLocalExtractionQueue({ maxConcurrent: 1 });
  let calls = 0;
  let release: (() => void) | undefined;
  queue.subscribe(async () => {
    calls += 1;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const queued = job("job_once", "workspace_one");
  await queue.schedule(queued);
  await queue.schedule(queued);
  expect(calls).toBe(1);
  expect(queue.snapshot()).toMatchObject({ active: 1, pending: 0 });
  release?.();
  await queue.waitForIdle();
});

test("the local extraction queue pauses and resumes dispatch without losing pending work", async () => {
  const queue = createLocalExtractionQueue({ maxConcurrent: 1 });
  const started: string[] = [];
  queue.setMaxConcurrent(0);
  queue.subscribe((queued) => {
    started.push(queued.job_id);
  });
  await queue.schedule(job("job_paused", "workspace_one"));
  expect(queue.snapshot()).toMatchObject({ active: 0, maxConcurrent: 0, pending: 1 });
  expect(started).toEqual([]);

  queue.setMaxConcurrent(1);
  await queue.waitForIdle();
  expect(started).toEqual(["job_paused"]);
});

test("the local extraction queue leaves overflow in the durable store for reconciliation", async () => {
  const queue = createLocalExtractionQueue({ maxBuffered: 1, maxConcurrent: 1 });
  queue.setMaxConcurrent(0);
  await queue.schedule(job("job_buffered", "workspace_one"));
  await queue.schedule(job("job_durable", "workspace_one"));
  expect(queue.snapshot()).toMatchObject({
    durableDeferrals: 1,
    maxBuffered: 1,
    oldestEnqueuedAt: "2026-08-16T12:00:00.000Z",
    pending: 1,
  });
});

function job(jobId: string, workspaceId: string) {
  return {
    job_id: jobId,
    workspace_id: workspaceId,
    template_id: "tpl_invoice",
    template_version: 1,
    enqueued_at: "2026-08-16T12:00:00.000Z",
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await Bun.sleep(1);
  }
  throw new Error("Timed out waiting for queue state");
}
