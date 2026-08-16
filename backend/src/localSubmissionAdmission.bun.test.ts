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
  const first = admission.run(
    requestWithBody(10),
    async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return new Response("accepted", { status: 202 });
    },
  );
  await Promise.resolve();
  expect(admission.snapshot()).toMatchObject({ active: 1, rejected: 0, reservedBytes: 10 });

  let handledSecond = false;
  const secondBody = trackedBody();
  const second = await admission.run(
    new Request("http://127.0.0.1/v1/extract", {
      method: "POST",
      headers: { "content-length": "10", "content-type": "application/octet-stream" },
      body: secondBody.stream,
      duplex: "half",
    } as RequestInit),
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
  let reservation: { requestBytes: number; reservedBytes: number } | null = null;
  const body = trackedBody();
  const admission = createLocalSubmissionAdmission({
    canReserve: (input) => {
      reservation = input;
      return false;
    },
  });
  const response = await admission.run(
    new Request("http://127.0.0.1/v1/extract", {
      method: "POST",
      headers: { "content-length": "12" },
      body: body.stream,
      duplex: "half",
    } as RequestInit),
    () => new Response(null, { status: 202 }),
  );
  expect(response.status).toBe(503);
  expect(reservation as { requestBytes: number; reservedBytes: number } | null).toEqual({
    requestBytes: 12,
    reservedBytes: 0,
  });
  expect(body.consumed()).toBe(3);
  expect(admission.snapshot()).toMatchObject({ active: 0, rejected: 1 });
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
