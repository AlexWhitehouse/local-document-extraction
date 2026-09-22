import { expect, test } from "bun:test";
import { createLocalApplication } from "./localApplication";

test("API body limits reject oversized declared and chunked auth bodies before middleware", async () => {
  let calls = 0;
  const application = createLocalApplication({
    maxJsonRequestBytes: 32,
    auth: { getSession: async () => null, handler: async (request) => { calls++; return new Response(await request.text()); } },
  });
  const declared = new Request("http://localhost/api/auth/sign-in/email", {
    method: "POST", headers: { "content-length": "33", "content-type": "application/json" }, body: "x".repeat(33),
  });
  expect((await application(declared)).status).toBe(413);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(20)); },
    cancel() { cancelled = true; },
  });
  const chunked = new Request("http://localhost/api/auth/sign-in/email", { method: "POST", body: stream });
  const response = await application(chunked);
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ error: { code: "request_body_too_large" } });
  expect(cancelled).toBe(true);
  expect(calls).toBe(0);

  const allowed = new Request("http://localhost/api/auth/sign-in/email", { method: "POST", body: "x".repeat(32) });
  expect(await (await application(allowed)).text()).toBe("x".repeat(32));
  expect(calls).toBe(1);
});

test("document uploads retain their separate authorization and multipart limits", async () => {
  const application = createLocalApplication({ maxJsonRequestBytes: 1 });
  const response = await application(new Request("http://localhost/v1/extract", { method: "POST", body: "large document input" }));
  expect(response.status).toBe(503);
  expect(await response.json()).not.toMatchObject({ error: { code: "request_body_too_large" } });
});
