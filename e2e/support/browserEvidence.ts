import type { Page, TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

type NetworkEntry = {
  method?: string;
  phase: "isolated" | "request" | "response" | "websocket";
  resourceType?: string;
  status?: number;
  url: string;
};

type LifecycleFrame = {
  jobId: string;
  status: string;
  type: "extraction_job_lifecycle";
};

export async function createBrowserEvidence(page: Page) {
  const consoleMessages: Array<{ sequence: number; text: string; type: string }> = [];
  const networkEntries: NetworkEntry[] = [];
  const workspaceFrames: LifecycleFrame[] = [];
  const externalWebSockets = new Set<string>();
  let sequence = 0;

  await page.route("**/*", async (route) => {
    const request = route.request();
    if (isExternalNetworkUrl(request.url())) {
      const url = sanitizeUrlMetadata(request.url());
      networkEntries.push({
        phase: "isolated",
        method: request.method(),
        resourceType: request.resourceType(),
        url,
      });
      if (request.resourceType() === "stylesheet") {
        await route.fulfill({ status: 200, contentType: "text/css", body: "" });
      } else {
        await route.abort("blockedbyclient");
      }
      return;
    }
    await route.continue();
  });

  page.on("console", (message) => {
    consoleMessages.push({
      sequence: sequence += 1,
      type: message.type(),
      text: sanitizeConsoleText(message.text()),
    });
  });
  page.on("pageerror", (error) => {
    consoleMessages.push({
      sequence: sequence += 1,
      type: "pageerror",
      text: sanitizeConsoleText(error.message),
    });
  });
  page.on("request", (request) => {
    if (!isRelevantRequest(request.url())) return;
    networkEntries.push({
      phase: "request",
      method: request.method(),
      resourceType: request.resourceType(),
      url: sanitizeUrlMetadata(request.url()),
    });
  });
  page.on("response", (response) => {
    if (!isRelevantRequest(response.url())) return;
    networkEntries.push({
      phase: "response",
      method: response.request().method(),
      resourceType: response.request().resourceType(),
      status: response.status(),
      url: sanitizeUrlMetadata(response.url()),
    });
  });
  page.on("websocket", (socket) => {
    if (isExternalNetworkUrl(socket.url())) {
      externalWebSockets.add(sanitizeUrlMetadata(socket.url()));
    }
    networkEntries.push({
      phase: "websocket",
      url: sanitizeUrlMetadata(socket.url()),
    });
    socket.on("framereceived", ({ payload }) => {
      workspaceFrames.push(...summarizeWorkspaceFrame(payload));
    });
  });

  return {
    completedWorkspaceFrames: () => workspaceFrames.filter((frame) => frame.status === "completed"),
    externalWebSockets: () => [...externalWebSockets].sort(),
    async attach(testInfo: TestInfo): Promise<void> {
      await Promise.all([
        attachJson(testInfo, "browser-console", consoleMessages),
        attachJson(testInfo, "network-metadata", networkEntries),
        attachJson(testInfo, "workspace-live-frames", workspaceFrames),
      ]);
    },
  };
}

export function sanitizeUrlMetadata(input: string): string {
  try {
    const url = new URL(input);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
      return `${url.protocol}${url.pathname}`;
    }
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

export function sanitizeConsoleText(input: string): string {
  const redacted = String(input || "")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeUrlMetadata(url))
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(authorization|cookie|password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
  return redacted.length > 1_000 ? `${redacted.slice(0, 988)} [TRUNCATED]` : redacted;
}

export function summarizeWorkspaceFrame(payload: string | Buffer): LifecycleFrame[] {
  try {
    const parsed = JSON.parse(typeof payload === "string" ? payload : payload.toString("utf8")) as {
      events?: Array<{ type?: unknown; job?: { job_id?: unknown; status?: unknown } }>;
    };
    return (Array.isArray(parsed.events) ? parsed.events : []).flatMap((event) => {
      if (event?.type !== "extraction_job_lifecycle") return [];
      const jobId = boundedValue(event.job?.job_id);
      const status = boundedValue(event.job?.status);
      return jobId && status ? [{ type: "extraction_job_lifecycle" as const, jobId, status }] : [];
    });
  } catch {
    return [];
  }
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  const evidenceDirectory = resolve(process.cwd(), ".scratch/ci/playwright/evidence");
  const path = join(evidenceDirectory, `${name}.json`);
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await testInfo.attach(name, {
    path,
    contentType: "application/json",
  });
}

function isRelevantRequest(input: string): boolean {
  try {
    const pathname = new URL(input).pathname;
    return pathname.startsWith("/api/auth/") || pathname === "/v1" || pathname.startsWith("/v1/");
  } catch {
    return false;
  }
}

function isExternalNetworkUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return false;
    return url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1";
  } catch {
    return true;
  }
}

function boundedValue(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 160) : "";
}
