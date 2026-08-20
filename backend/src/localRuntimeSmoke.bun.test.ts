import { expect, test } from "bun:test";
import { createConnection } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AsyncCleanupStack, startLocalRuntimeSmokeProcess } from "./testSupport/localRuntimeProcess";

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the Bun server supports the complete local product path", async () => {
  const cleanup = new AsyncCleanupStack();

  try {
    const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-local-smoke-"));
    cleanup.defer(() => rm(stateDirectory, { recursive: true, force: true }));
    const modelGateway = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        if (new URL(request.url).pathname !== "/chat/completions") {
          return new Response("Not found", { status: 404 });
        }
        return Response.json({
          choices: [{
            message: {
              content: JSON.stringify({
                results: [{ field_id: "invoice_number", status: "ok", answer: "INV-SMOKE-001" }],
              }),
            },
          }],
        });
      },
    });
    cleanup.defer(() => modelGateway.stop(true));
    const runtime = await startLocalRuntimeSmokeProcess({
      backendDirectory,
      env: {
        ...process.env,
        DOCUMENT_EXTRACTION_STATE_DIR: stateDirectory,
        LITELLM_KEY: "smoke-test-key",
        LOCAL_SHUTDOWN_TIMEOUT_MS: "50",
        MODEL_GATEWAY_URL: `http://127.0.0.1:${modelGateway.port}`,
      },
    });
    cleanup.defer(async () => {
      await runtime.stop();
    });
    const origin = runtime.origin;
    const port = Number(new URL(origin).port);

    const health = await fetchJson<{
      diagnostics: {
        liveUpdates: {
          connections: { open: number; pending: number };
          runtimePendingWebSockets: number;
          workspaces: { total: number; totalSubscribers: number };
        };
        runtime: { bunRevision: string; bunVersion: string; nodeVersion: string };
      };
    }>(`${origin}/v1/health`);
    expect(health.diagnostics.runtime).toMatchObject({
      bunVersion: Bun.version,
      nodeVersion: process.versions.node,
    });
    expect(health.diagnostics.runtime.bunRevision).toBe(Bun.revision);
    expect(health.diagnostics.liveUpdates).toMatchObject({
      connections: { open: 0, pending: 0 },
      runtimePendingWebSockets: 0,
      workspaces: { total: 0, totalSubscribers: 0 },
    });

    const signUp = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Smoke User", email: "smoke@example.com", password: "Strong1!" }),
    });
    expect(signUp.status).toBe(200);

    const verificationMail = await waitForMail(stateDirectory);
    expect(verificationMail.type).toBe("account_email_verification");
    expect(verificationMail.action_url).toContain("/api/auth/verify-email?");
    const verified = await fetch(verificationMail.action_url, { redirect: "manual" });
    expect(verified.status).toBe(302);

    const signIn = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "smoke@example.com", password: "Strong1!" }),
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toBeTruthy();

    const workspaces = await fetchJson<{ workspaces: Array<{ id: string }> }>(`${origin}/v1/workspaces`, { headers: { cookie: cookie! } });
    const workspaceId = workspaces.workspaces[0]?.id;
    expect(workspaceId).toBeTruthy();
    const sessionHeaders = { cookie: cookie!, "x-workspace-id": workspaceId! };

    const templates = await fetchJson<{ templates: Array<{ id: string }> }>(`${origin}/v1/templates`, { headers: sessionHeaders });
    const starterTemplateId = templates.templates[0]?.id;
    expect(starterTemplateId).toBeTruthy();

    const createdTemplate = await fetchJson<{ template_id: string }>(`${origin}/v1/templates`, {
      method: "POST",
      headers: { ...sessionHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Smoke Invoice",
        description: "Extract the invoice number.",
        fields: [{ name: "Invoice Number", description: "The visible invoice identifier.", data_type: "string" }],
      }),
    }, 201);

    const liveSocket = await openAuthenticatedLiveSocket({ cookie: cookie!, port, workspaceId: workspaceId! });
    cleanup.defer(async () => {
      liveSocket.close();
      await liveSocket.closed;
    });
    const lifecycleMessages: string[] = [];
    liveSocket.onMessage = (message) => lifecycleMessages.push(message);
    const liveHealth = await fetchJson<{
      diagnostics: {
        liveUpdates: {
          connections: { open: number; pending: number };
          runtimePendingWebSockets: number;
          workspaces: { total: number; totalSubscribers: number };
        };
      };
    }>(`${origin}/v1/health`);
    expect(liveHealth.diagnostics.liveUpdates).toMatchObject({
      connections: { open: 1, pending: 0 },
      runtimePendingWebSockets: 1,
      workspaces: { total: 1, totalSubscribers: 1 },
    });
    expect(JSON.stringify(liveHealth.diagnostics.liveUpdates)).not.toContain(workspaceId!);

    const form = new FormData();
    form.append("template_id", createdTemplate.template_id);
    form.append("document", new File([new Uint8Array([137, 80, 78, 71])], "smoke.png", { type: "image/png" }));
    const submitted = await fetchJson<{ job_id: string; status: string }>(`${origin}/v1/extract`, {
      method: "POST",
      headers: sessionHeaders,
      body: form,
    }, 202);
    expect(submitted.status).toBe("queued");

    const completed = await waitForCompletedJob(origin, sessionHeaders, submitted.job_id);
    expect(completed).toMatchObject({
      status: "completed",
      results: [expect.objectContaining({ field_id: "invoice_number", answer: "INV-SMOKE-001" })],
    });
    await waitFor(() => lifecycleMessages.some((message) => message.includes('"status":"completed"')));
    expect(lifecycleMessages.join("\n")).not.toContain("smoke.png");
    expect(lifecycleMessages.join("\n")).not.toContain("INV-SMOKE-001");
    const key = await fetchJson<{ api_key: string }>(`${origin}/v1/workspaces/${workspaceId}/api-key`, {
      method: "POST",
      headers: { cookie: cookie! },
    });
    expect(key.api_key).toMatch(/^key_/);
    const apiTemplates = await fetchJson<{ templates: Array<{ id: string }> }>(`${origin}/v1/templates`, {
      headers: { authorization: `Bearer ${key.api_key}` },
    });
    expect(apiTemplates.templates.map((template) => template.id)).toContain(createdTemplate.template_id);

    const analytics = await waitFor(() => readTodayJsonl(join(stateDirectory, "analytics")));
    expect(analytics).toContain("template_created");
    expect(analytics).toContain("document_submitted");
    expect(analytics).toContain("extraction_completed");
    expect(analytics).not.toContain("smoke.png");
    expect(analytics).not.toContain("INV-SMOKE-001");

    expect(await runtime.stop()).toBe(0);
    await liveSocket.closed;
  } finally {
    await cleanup.dispose();
  }
}, 30_000);

async function waitForMail(stateDirectory: string): Promise<{ type: string; action_url: string }> {
  return waitFor(async () => {
    const content = await readTodayJsonl(join(stateDirectory, "mail")).catch(() => "");
    if (!content) {
      return null;
    }
    const record = JSON.parse(content.trim().split("\n")[0] || "{}") as { type?: string; action_url?: string };
    return record.type && record.action_url ? { type: record.type, action_url: record.action_url } : null;
  });
}

async function waitForCompletedJob(
  origin: string,
  headers: HeadersInit,
  jobId: string,
): Promise<Record<string, unknown>> {
  return waitFor(async () => {
    const response = await fetch(`${origin}/v1/jobs/${jobId}`, { headers });
    const job = await response.json() as Record<string, unknown>;
    return job.status === "completed" ? job : null;
  });
}

async function fetchJson<T>(url: string, init: RequestInit = {}, expectedStatus = 200): Promise<T> {
  const response = await fetch(url, init);
  expect(response.status).toBe(expectedStatus);
  return response.json() as Promise<T>;
}

async function readTodayJsonl(directory: string): Promise<string> {
  return readFile(join(directory, `${new Date().toISOString().slice(0, 10)}.jsonl`), "utf8");
}

async function waitFor<T>(read: () => T | Promise<T>): Promise<NonNullable<T>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await read();
    if (value) {
      return value as NonNullable<T>;
    }
    await Bun.sleep(25);
  }
  throw new Error("Timed out waiting for local runtime state");
}

type LiveSocket = {
  close(): void;
  closed: Promise<void>;
  onMessage: (message: string) => void;
};

async function openAuthenticatedLiveSocket({
  cookie,
  port,
  workspaceId,
}: {
  cookie: string;
  port: number;
  workspaceId: string;
}): Promise<LiveSocket> {
  const socket = createConnection({ host: "127.0.0.1", port });
  let handshake = "";
  let frameBuffer = Buffer.alloc(0);
  let settled = false;
  let resolveClosed!: () => void;
  const liveSocket: LiveSocket = {
    close: () => socket.end(),
    closed: new Promise<void>((resolve) => {
      resolveClosed = resolve;
    }),
    onMessage: () => {},
  };
  socket.once("close", () => resolveClosed());

  await new Promise<void>((resolvePromise, reject) => {
    socket.on("connect", () => {
      socket.write([
        `GET /v1/workspaces/${workspaceId}/live HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
        `Cookie: ${cookie}`,
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", (chunk) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      if (!settled) {
        handshake += bytes.toString("utf8");
        const boundary = handshake.indexOf("\r\n\r\n");
        if (boundary < 0) {
          return;
        }
        const header = handshake.slice(0, boundary);
        if (!header.startsWith("HTTP/1.1 101")) {
          reject(new Error(`Live update upgrade failed: ${header.split("\r\n")[0]}`));
          return;
        }
        settled = true;
        frameBuffer = Buffer.from(handshake.slice(boundary + 4), "utf8");
        resolvePromise();
      } else {
        frameBuffer = Buffer.concat([frameBuffer, bytes]);
      }
      const consumed = drainWebSocketFrames(frameBuffer, (message) => {
        liveSocket.onMessage(message);
      });
      frameBuffer = frameBuffer.subarray(consumed);
    });
    socket.on("error", reject);
  });
  return liveSocket;
}

function drainWebSocketFrames(
  buffer: Buffer,
  onMessage: (message: string) => void,
): number {
  let offset = 0;
  while (buffer.byteLength - offset >= 2) {
    const lengthMarker = buffer[offset + 1]! & 0x7f;
    const lengthBytes = lengthMarker === 126 ? 2 : 0;
    if (lengthMarker === 127 || buffer.byteLength - offset < lengthBytes + 2) {
      return offset;
    }
    const length = lengthMarker === 126 ? buffer.readUInt16BE(offset + 2) : lengthMarker;
    const payloadStart = offset + 2 + lengthBytes;
    if (buffer.byteLength - payloadStart < length) {
      return offset;
    }
    onMessage(buffer.subarray(payloadStart, payloadStart + length).toString("utf8"));
    offset = payloadStart + length;
  }
  return offset;
}
