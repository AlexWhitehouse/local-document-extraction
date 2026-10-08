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

      return 1;
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

test.each([
  ["default", undefined, 16],
  ["configured", 2, 2],
] as const)(
  "the local extraction queue bounds active handlers at its %s limit and keeps only metadata pending",
  async (_name, maxConcurrent, expectedLimit) => {
    const queue = createLocalExtractionQueue({ maxConcurrent });
    const releases: Array<() => void> = [];
    queue.subscribe(async () => {
      await new Promise<void>((resolve) => releases.push(resolve));
    });

    await Promise.all(
      Array.from({ length: expectedLimit + 1 }, (_, index) => queue.schedule(job(`job_${index + 1}`, "workspace_one"))),
    );

    expect(queue.snapshot()).toMatchObject({ active: expectedLimit, maxConcurrent: expectedLimit, pending: 1 });
    releases.shift()?.();
    await waitFor(() => queue.snapshot().pending === 0);
    expect(queue.snapshot().active).toBe(expectedLimit);

    for (const release of releases.splice(0)) release();
    await queue.waitForIdle();
    expect(queue.snapshot()).toMatchObject({ active: 0, pending: 0 });
  },
);

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

test("closing the local extraction queue stops new claims and waits only for active handlers", async () => {
  const queue = createLocalExtractionQueue({ maxConcurrent: 1 });
  const activeHandler = Promise.withResolvers<void>();
  const started: string[] = [];
  queue.subscribe(async (queued) => {
    started.push(queued.job_id);
    await activeHandler.promise;
  });
  await queue.schedule(job("job_active", "workspace_one"));
  await queue.schedule(job("job_durable_pending", "workspace_two"));
  expect(started).toEqual(["job_active"]);

  let closed = false;

  const closing = queue.close().then(() => {
    closed = true;
  });

  expect(queue.snapshot()).toMatchObject({
    accepting: false,
    active: 1,
    deferred: 0,
    maxConcurrent: 0,
    pending: 0,
  });
  expect(closed).toBe(false);

  await queue.schedule(job("job_after_close", "workspace_three"));
  expect(started).toEqual(["job_active"]);
  expect(queue.snapshot().durableDeferrals).toBe(1);

  activeHandler.resolve();
  await closing;
  expect(closed).toBe(true);
  expect(queue.snapshot()).toMatchObject({ accepting: false, active: 0, pending: 0 });
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

test("gateway eligibility keeps serial waiters out of global permits and lets another Workspace run", async () => {
  let workspaceLimit = 1;
  const queue = createLocalExtractionQueue({ maxConcurrent: 8, getWorkspaceMaxConcurrent: () => workspaceLimit });
  const started: string[] = [];
  const releases: Array<() => void> = [];
  queue.subscribe(async (queued) => {
    started.push(queued.job_id);
    await new Promise<void>((resolve) => releases.push(resolve));
  });

  for (let i = 0; i < 8; i++) await queue.schedule(job(`a_${i}`, "workspace_a"));
  await queue.schedule(job("b_0", "workspace_b"));
  expect(started).toEqual(["a_0", "b_0"]);
  expect(queue.snapshot()).toMatchObject({ active: 2, pending: 7 });
  workspaceLimit = 2;
  queue.setMaxConcurrent(8);
  expect(started).toEqual(["a_0", "b_0", "a_1"]);
  const closing = queue.close();

  for (const release of releases) release();
  await closing;
});

test("drained Workspaces request targeted durable refill", async () => {
  const refilled: string[] = [];

  const queue = createLocalExtractionQueue({
    onWorkspaceIdle: (id) => {
      refilled.push(id);
    },
  });

  queue.subscribe(async () => {});
  await queue.schedule(job("one", "workspace_a"));
  await waitFor(() => refilled.length > 0);
  expect(refilled).toEqual(["workspace_a"]);
  await queue.close();
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await Bun.sleep(1);
  }

  throw new Error("Timed out waiting for queue state");
}

test("deferred retries admitted in any order become ready in due order, ties first-come", async () => {
  let clock = Date.parse("2026-07-10T20:00:00.000Z");
  const timers: Array<{ handler: () => void; dueAt: number }> = [];

  const queue = createLocalExtractionQueue({
    maxConcurrent: 1,
    now: () => clock,
    scheduleTimer: (handler, delayMs) => {
      timers.push({ handler, dueAt: clock + delayMs });

      return timers.length;
    },
    cancelTimer: () => {},
  });

  queue.setMaxConcurrent(0);
  const minutes = [7, 3, 9, 3, 1, 5, 9, 2];

  for (const [index, minute] of minutes.entries()) {
    await queue.schedule({
      ...job(`retry_${index}`, "workspace_one"),
      attempt: 2,
      not_before: new Date(Date.parse("2026-07-10T20:00:00.000Z") + minute * 60_000).toISOString(),
    });
  }

  expect(queue.snapshot()).toMatchObject({ deferred: minutes.length, pending: 0 });

  // Fire only the newest armed timer, as a real cancellation of the others would leave.
  while (queue.snapshot().deferred) {
    const timer = timers.at(-1)!;
    clock = timer.dueAt;
    timer.handler();
  }

  const order: string[] = [];
  queue.subscribe((item) => {
    order.push(item.job_id);
  });
  queue.setMaxConcurrent(1);
  await queue.waitForIdle();
  expect(order).toEqual(["retry_4", "retry_7", "retry_1", "retry_3", "retry_5", "retry_0", "retry_2", "retry_6"]);
  await queue.close();
});

test("a large multi-Workspace backlog stays fair across Workspaces and FIFO within each", async () => {
  const queue = createLocalExtractionQueue({ maxConcurrent: 1, maxBuffered: 100_000 });
  queue.setMaxConcurrent(0);
  const workspaces = ["workspace_a", "workspace_b", "workspace_c"];

  for (let index = 0; index < 5_000; index++)
    for (const workspaceId of workspaces) await queue.schedule(job(`${workspaceId}_${index}`, workspaceId));

  const order: string[] = [];
  queue.subscribe((item) => {
    order.push(item.job_id);
  });
  queue.setMaxConcurrent(1);
  await queue.waitForIdle();
  expect(order).toHaveLength(15_000);

  for (const [position, jobId] of order.entries()) {
    const workspaceId = workspaces[position % workspaces.length]!;
    expect(jobId).toBe(`${workspaceId}_${Math.floor(position / workspaces.length)}`);
  }

  await queue.close();
});

test("packet backlog and extraction alternate without starving either stage or reordering a stage", async () => {
  const queue = createLocalExtractionQueue({ maxConcurrent: 1 });
  queue.setMaxConcurrent(0);

  for (let index = 1; index <= 3; index++)
    await queue.schedule({ ...job(`packet_${index}`, "workspace_one"), kind: "packet" });

  for (let index = 1; index <= 3; index++) await queue.schedule(job(`child_${index}`, "workspace_one"));
  const order: string[] = [];
  queue.subscribe((item) => {
    order.push(item.job_id);
  });
  queue.setMaxConcurrent(1);
  await queue.waitForIdle();
  expect(order).toEqual(["packet_1", "child_1", "packet_2", "child_2", "packet_3", "child_3"]);
  await queue.close();
});

test("provider waits release local permits but retain job ownership and shutdown waits", async () => {
  const queue = createLocalExtractionQueue({ maxConcurrent: 1, maxWaiting: 2 });
  const release = Promise.withResolvers<void>();
  const started: string[] = [];
  queue.subscribe(async (job, capacity) => {
    started.push(job.job_id);
    capacity.suspend();
    await release.promise;
    await capacity.resume();
  });
  await queue.schedule(job("remote-a", "workspace_a"));
  await queue.schedule(job("remote-b", "workspace_a"));
  await queue.schedule(job("remote-a", "workspace_a"));
  await queue.schedule(job("pending", "workspace_a"));
  expect(started).toEqual(["remote-a", "remote-b"]);
  expect(queue.snapshot()).toMatchObject({ active: 0, waiting: 2, inFlight: 2, pending: 1 });
  let closed = false;
  const closing = queue.close().then(() => { closed = true; });
  await Promise.resolve();
  expect(closed).toBe(false);
  release.resolve();
  await closing;
  expect(queue.snapshot()).toMatchObject({ active: 0, waiting: 0, inFlight: 0 });
  expect(started).toEqual(["remote-a", "remote-b"]);
});

test("returning responses precede fresh work and can drain during resource pressure", async () => {
  const queue = createLocalExtractionQueue({ maxConcurrent: 1 });
  const remote = Promise.withResolvers<void>();
  const busy = Promise.withResolvers<void>();
  const order: string[] = [];
  queue.subscribe(async (job, capacity) => {
    if (job.job_id === "remote") {
      capacity.suspend();
      await remote.promise;
      await capacity.resume();
      order.push("response");
    } else if (job.job_id === "busy") await busy.promise;
    else order.push("new");
  });
  await queue.schedule(job("remote", "workspace_a"));
  await queue.schedule(job("busy", "workspace_a"));
  await queue.schedule(job("new", "workspace_a"));
  remote.resolve();
  await Promise.resolve();
  queue.setMaxConcurrent(0);
  busy.resolve();
  await waitFor(() => order.length === 1);
  expect(order).toEqual(["response"]);
  queue.setMaxConcurrent(1);
  await queue.waitForIdle();
  expect(order).toEqual(["response", "new"]);
});

test("failed suspended work releases waiting capacity without losing queued work", async () => {
  const failures: unknown[] = [];
  const queue = createLocalExtractionQueue({ maxConcurrent: 1, maxWaiting: 1, onHandlerError: (error) => { failures.push(error); } });
  let count = 0;
  queue.subscribe(async (_, capacity) => {
    capacity.suspend();
    count += 1;
    throw new Error("provider interrupted");
  });
  await queue.schedule(job("first", "workspace_a"));
  await queue.schedule(job("second", "workspace_a"));
  await queue.waitForIdle();
  expect(count).toBe(2);
  expect(failures).toHaveLength(2);
  expect(queue.snapshot()).toMatchObject({ active: 0, waiting: 0, inFlight: 0 });
});
