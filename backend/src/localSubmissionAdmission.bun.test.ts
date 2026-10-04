import { streamingRequest } from "./testing/requestFixture";
import { expect, test } from "bun:test";

import { createLocalSubmissionAdmission } from "./localSubmissionAdmission";

test("submission admission bounds active multipart work and safely drains overload", async () => {
  const admission = createLocalSubmissionAdmission({
    maxConcurrent: 1,
    maxReservedBytes: 20,
    unknownRequestBytes: 10,
    retryAfterSeconds: 2,
  });

  let releaseFirst: (() => void) | undefined;

  const first = admission.run(requestWithBody(10), async () => {
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    return new Response("accepted", { status: 202 });
  });

  await Promise.resolve();
  expect(admission.snapshot()).toMatchObject({ active: 1, rejected: 0, reservedBytes: 10 });

  let handledSecond = false;
  const secondBody = trackedBody();

  const second = await admission.run(
    streamingRequest("http://127.0.0.1/v1/extract", {
      method: "POST",
      headers: { "content-length": "10", "content-type": "application/octet-stream" },
      body: secondBody.stream,
      duplex: "half",
    }),
    async () => {
      handledSecond = true;

      return new Response("unexpected");
    },
  );

  expect(second.status).toBe(503);
  expect(second.headers.get("retry-after")).toBe("2");
  expect(handledSecond).toBe(false);
  expect(secondBody.consumed()).toBe(3);
  expect(admission.snapshot()).toMatchObject({ active: 1, rejected: 1, reservedBytes: 10 });

  releaseFirst?.();
  expect((await first).status).toBe(202);
  expect(admission.snapshot()).toMatchObject({ active: 0, rejected: 1, reservedBytes: 0 });
});

test("submission admission reserves a bounded fallback for unknown body sizes", async () => {
  const admission = createLocalSubmissionAdmission({
    maxConcurrent: 4,
    maxReservedBytes: 15,
    unknownRequestBytes: 10,
  });

  let release: (() => void) | undefined;

  const first = admission.run(requestWithBody(null), async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });

    return new Response(null, { status: 202 });
  });

  await Promise.resolve();
  const rejected = await admission.run(requestWithBody(null), async () => new Response(null, { status: 202 }));
  expect(rejected.status).toBe(503);
  expect(admission.snapshot()).toMatchObject({ active: 1, reservedBytes: 10 });
  release?.();
  await first;
});

test("submission admission rejects and drains when local memory or disk cannot reserve the upload", async () => {
  const reservations: Array<{ requestBytes: number; reservedBytes: number }> = [];
  const body = trackedBody();

  const admission = createLocalSubmissionAdmission({
    canReserve: (input) => {
      reservations.push(input);

      return false;
    },
  });

  const response = await admission.run(
    streamingRequest("http://127.0.0.1/v1/extract", {
      method: "POST",
      headers: { "content-length": "12" },
      body: body.stream,
      duplex: "half",
    }),
    () => new Response(null, { status: 202 }),
  );

  expect(response.status).toBe(503);
  expect(reservations[0]).toEqual({
    requestBytes: 12,
    reservedBytes: 0,
  });
  expect(body.consumed()).toBe(3);
  expect(admission.snapshot()).toMatchObject({ active: 0, rejected: 1 });
});

test("submission admission reserves counters before asynchronous resource sampling", async () => {
  let finishSampling: (() => void) | undefined;
  let samplingCalls = 0;

  const admission = createLocalSubmissionAdmission({
    maxConcurrent: 1,
    maxReservedBytes: 20,
    canReserve: async () => {
      samplingCalls += 1;
      await new Promise<void>((resolve) => {
        finishSampling = resolve;
      });

      return true;
    },
  });

  const first = admission.run(requestWithBody(10), () => new Response(null, { status: 202 }));
  await Promise.resolve();
  expect(admission.snapshot()).toMatchObject({ active: 1, reservedBytes: 10 });

  let handledSecond = false;

  const second = await admission.run(requestWithBody(10), () => {
    handledSecond = true;

    return new Response(null, { status: 202 });
  });

  expect(second.status).toBe(503);
  expect(handledSecond).toBe(false);
  expect(samplingCalls).toBe(1);

  finishSampling?.();
  expect((await first).status).toBe(202);
  expect(admission.snapshot()).toMatchObject({ active: 0, rejected: 1, reservedBytes: 0 });
});

for (const asynchronous of [false, true]) {
  test(`resource sampling ${asynchronous ? "rejection" : "throw"} drains the upload, releases its reservation, and permits a later retry`, async () => {
    let samples = 0;
    let handled = 0;

    const admission = createLocalSubmissionAdmission({
      maxConcurrent: 1,
      canReserve: () => {
        if (samples++ > 0) return true;

        const interrupted = Object.assign(new Error("Failed to get memory usage"), {
          errno: 4,
          syscall: "memoryUsage",
        });

        if (asynchronous) return Promise.reject(interrupted);
        throw interrupted;
      },
    });

    const body = trackedBody();

    const response = await admission.run(
      streamingRequest("http://127.0.0.1/v1/extract", {
        method: "POST",
        headers: { "content-length": "3" },
        body: body.stream,
        duplex: "half",
      }),
      () => {
        handled++;

        return new Response(null, { status: 202 });
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(await response.json()).toMatchObject({ error: { code: "local_submission_capacity_unavailable" } });
    expect(body.consumed()).toBe(3);
    expect(handled).toBe(0);
    expect(admission.snapshot()).toMatchObject({ active: 0, reservedBytes: 0, rejected: 1 });
    expect((await admission.run(requestWithBody(3), () => new Response(null, { status: 202 }))).status).toBe(202);
    // Exceptions after admission still belong to the handler, not capacity rejection.
    await expect(
      admission.run(requestWithBody(3), () => {
        throw new Error("handler failed");
      }),
    ).rejects.toThrow("handler failed");
    expect(admission.snapshot()).toMatchObject({ active: 0, reservedBytes: 0, rejected: 1 });
  });
}

test("closing submission admission rejects new Documents and waits for admitted work", async () => {
  const admission = createLocalSubmissionAdmission({
    maxConcurrent: 2,
    maxReservedBytes: 20,
  });

  const activeHandler = Promise.withResolvers<void>();

  const first = admission.run(requestWithBody(10), async () => {
    await activeHandler.promise;

    return new Response(null, { status: 202 });
  });

  await Promise.resolve();

  let closed = false;

  const closing = admission.close().then(() => {
    closed = true;
  });

  expect(admission.snapshot()).toMatchObject({ accepting: false, active: 1 });
  expect(closed).toBe(false);

  const rejectedBody = trackedBody();

  const rejected = await admission.run(
    streamingRequest("http://127.0.0.1/v1/extract", {
      method: "POST",
      headers: { "content-length": "3" },
      body: rejectedBody.stream,
      duplex: "half",
    }),
    () => new Response(null, { status: 202 }),
  );

  expect(rejected.status).toBe(503);
  expect(rejectedBody.consumed()).toBe(3);
  expect(closed).toBe(false);

  activeHandler.resolve();
  expect((await first).status).toBe(202);
  await closing;
  expect(closed).toBe(true);
  expect(admission.snapshot()).toMatchObject({ accepting: false, active: 0, reservedBytes: 0 });
});

function requestWithBody(contentLength: number | null): Request {
  const headers = new Headers({ "content-type": "application/octet-stream" });

  if (contentLength !== null) headers.set("content-length", String(contentLength));

  return new Request("http://127.0.0.1/v1/extract", {
    method: "POST",
    headers,
    body: new Uint8Array([1, 2, 3]),
  });
}

function trackedBody() {
  let chunks = 0;

  return {
    consumed: () => chunks,
    stream: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunks >= 3) {
          controller.close();

          return;
        }

        chunks += 1;
        controller.enqueue(new Uint8Array([chunks]));
      },
    }),
  };
}
