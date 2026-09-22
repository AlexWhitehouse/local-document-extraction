import { expect, test } from "bun:test";
import { createCloudflareMailSink } from "./cloudflareMailSink";
import type { LocalMailMessage } from "./localMailSink";

const message: LocalMailMessage = {
  type: "account_email_verification", to: "ada@example.org", from: { email: "hello@example.org", name: "Sample App" },
  subject: "Verify", text: "https://app.example.org/verify?token=private-link", html: "<p>Verify</p>",
};
const accountId = "a".repeat(32);
const apiToken = "private-api-token";

test("Cloudflare delivery uses the REST address shape and accepts queued recipients", async () => {
  let calls = 0;
  const sink = createCloudflareMailSink({ accountId, apiToken, fetcher: async (url, init) => {
    calls += 1;
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`);
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ authorization: `Bearer ${apiToken}`, "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ to: message.to, from: { address: "hello@example.org", name: "Sample App" }, subject: "Verify", text: message.text, html: message.html });
    return Response.json({ success: true, result: { delivered: [], queued: [message.to], permanent_bounces: [] } });
  } });
  await sink.capture(message);
  expect(calls).toBe(1);
});

test("provider failures are sanitized and not retried", async () => {
  for (const response of [
    new Response("private-api-token private-link", { status: 403 }),
    Response.json({ success: false, errors: [{ message: "private-api-token" }] }),
    Response.json({ success: true, result: { delivered: [], queued: [], permanent_bounces: [message.to] } }),
    Response.json({ success: true, result: { delivered: [], queued: [], permanent_bounces: [] } }),
  ]) {
    let calls = 0;
    const sink = createCloudflareMailSink({ accountId, apiToken, fetcher: async () => { calls += 1; return response; } });
    const error = await sink.capture(message).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/private-|ada@example/);
    expect(calls).toBe(1);
  }
  const sink = createCloudflareMailSink({ accountId, apiToken, fetcher: async () => { throw new Error("private-api-token private-link"); } });
  expect(String(await sink.capture(message).catch((error: Error) => error))).not.toContain("private-");
});

test("large messages are rejected before sending and oversized responses are cancelled", async () => {
  let calls = 0;
  let cancelled = false;
  const sink = createCloudflareMailSink({ accountId, apiToken, fetcher: async () => {
    calls += 1;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(65537)); },
      cancel() { cancelled = true; },
    }));
  } });
  await expect(sink.capture({ ...message, text: "x".repeat(128 * 1024) })).rejects.toThrow("Cloudflare email delivery failed");
  expect(calls).toBe(0);
  await expect(sink.capture(message)).rejects.toThrow("Cloudflare email delivery failed");
  expect(calls).toBe(1);
  expect(cancelled).toBe(true);
});
