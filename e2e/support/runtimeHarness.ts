import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  AsyncCleanupStack,
  startLocalRuntimeSmokeProcess,
} from "../../backend/src/testSupport/localRuntimeProcess";
import { sanitizeConsoleText } from "./browserEvidence";

const rootDirectory = resolve(import.meta.dir, "../..");
const cleanup = new AsyncCleanupStack();
let exitCode = 0;

try {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-browser-journey-"));
  cleanup.defer(async () => {
    console.log("E2E_CLEANUP state_start");
    await rm(stateDirectory, { recursive: true, force: true });
    console.log("E2E_CLEANUP state_done");
  });

  let requestShutdown!: () => void;
  const shutdownRequested = new Promise<void>((resolvePromise) => {
    requestShutdown = resolvePromise;
  });

  const modelGateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/__e2e/shutdown" && request.method === "POST") {
        requestShutdown();
        return new Response(null, { status: 202 });
      }
      if (url.pathname !== "/chat/completions" || request.method !== "POST") {
        return new Response("Not found", { status: 404 });
      }
      if (request.headers.get("authorization") !== "Bearer browser-journey-key") {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const input = await request.json() as { model?: string; messages?: Array<{ role: string; content?: unknown }> };
      if (["browser/document-classifier", "browser/split-review", "browser/split-blank", "browser/split-single"].includes(input.model || "")) {
        const message = input.messages?.find((entry) => entry.role === "user");
        const content = Array.isArray(message?.content) ? message.content : [];
        const textPart = content.find((part: { type?: string }) => part.type === "text");
        const context = JSON.parse(textPart?.text || "{}") as { candidates?: { id: string; name: string; description: string }[]; pages?: { original_page: number }[] };
        const value = context.candidates ? {
          status: "selected", template_id: context.candidates[0]?.id,
          reason: "Invoice identifier matches the invoice template description.", evidence: ["Document includes an invoice identifier."],
        } : {
          status: input.model === "browser/split-review" ? "uncertain" : "resolved",
          groups: input.model === "browser/split-blank" ? [] : input.model === "browser/split-single"
            ? [(context.pages || []).map(({ original_page }) => original_page)]
            : (context.pages || []).map(({ original_page }) => [original_page]),
          exclusions: input.model === "browser/split-blank" ? (context.pages || []).map(({ original_page }) => ({ page: original_page, reason: "Verified blank page", verified_blank: true })) : [],
          reason: input.model === "browser/split-review" ? "Document boundaries remain ambiguous after assessment." : input.model === "browser/split-single" ? "All pages belong to one invoice." : "Every selected page is blank.",
          evidence: [input.model === "browser/split-review" ? "Adjacent page boundaries are ambiguous." : input.model === "browser/split-single" ? "Invoice reference continues across all pages." : "No marks on selected pages."],
        };
        return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
      }
      if (input.model === "browser/template-assistant" && String(input.messages?.[0]?.content ?? "").startsWith("You suggest requests")) {
        return Response.json({ choices: [{ message: { content: JSON.stringify({ suggestions: [
          { label: "Add VAT rate to each line item", request: "Add VAT rate to each line item.", reason: "“Line Items” has prices but no VAT column" },
          { label: "Say which order Invoice Date uses", request: "Make Invoice Date say dates are day-first.", reason: "“Invoice Date” doesn’t say which order dates use" },
        ] }) } }] });
      }
      if (input.model === "browser/template-assistant") {
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          explanation: "Add a VAT rate column to the existing line items. Review the proposed output key before applying.",
          observations: [],
          groups: [{
            id: "vat-rate", title: "Add VAT rate", rationale: "Capture the tax percentage shown for each line item.",
            dependsOn: [],
            operations: [{
              op: "add_column", fieldIndex: 5, expectName: "Line Items", after: 4,
              column: { heading: "VAT Rate", data_type: "number", description: "VAT percentage shown for this line, or null when absent." },
            }],
          }],
        }) } }] });
      }
      if (input.model === "browser/template-generator") {
        const corrected = (input.messages?.length ?? 0) > 2;
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          name: "Generated Receipt", description: "Capture receipt totals and purchases.",
          fields: [
            { name: "Total", description: "Total amount paid", data_type: corrected ? "number" : "integer" },
            { name: "Purchases", description: "Purchased items", data_type: "array<object>", object_schema: {
              mode: "table", columns: [
                { heading: "Item", description: "Name of the purchased item", data_type: "string" },
                { heading: "Amount", description: "Amount paid for the item", data_type: "number" },
              ],
            } },
          ],
        }) } }] });
      }
      if (["browser/expected-answers", "browser/expected-answers-b"].includes(input.model || "")) {
        return Response.json({ choices: [{ message: { content: JSON.stringify({ results: [
          { field_id: "date_of_birth", status: "ok", answer: "08/09/1871" },
          { field_id: "items", status: "ok", answer: [{ sku: "A", quantity: null }, { sku: "B", quantity: 999 }] },
        ] }) } }] });
      }
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              results: [{
                field_id: "invoice_number",
                status: "ok",
                answer: "INV-E2E-001",
                confidence: 0.99,
                evidence: "Invoice identifier on the first page.",
              }],
            }),
          },
        }],
      });
    },
  });
  cleanup.defer(async () => {
    console.log("E2E_CLEANUP gateway_start");
    await modelGateway.stop(true);
    console.log("E2E_CLEANUP gateway_done");
  });

  const runtime = await startLocalRuntimeSmokeProcess({
    backendDirectory: resolve(rootDirectory, "backend"),
    timeoutMs: 15_000,
    env: {
      ...process.env,
      BETTER_AUTH_SECRET: "browser-journey-auth-secret-at-least-32-characters",
      DOCUMENT_EXTRACTION_ADMIN_EMAILS: "browser-admin@example.test",
      DOCUMENT_EXTRACTION_STATE_DIR: stateDirectory,
      LOCAL_SHUTDOWN_TIMEOUT_MS: "5000",
      NODE_ENV: "test",
    },
  });
  cleanup.defer(async () => {
    console.log("E2E_CLEANUP runtime_start");
    const runtimeExitCode = await runtime.stop();
    console.log(`E2E_CLEANUP runtime_done code=${runtimeExitCode}`);
    if (runtimeExitCode !== 0) {
      throw new Error(`Local Bun Runtime exited with code ${runtimeExitCode}`);
    }
  });

  console.log(`E2E_RUNTIME_READY ${JSON.stringify({
    bunVersion: Bun.version,
    controlOrigin: `http://127.0.0.1:${modelGateway.port}`,
    origin: runtime.origin,
    stateDirectory,
  })}`);
  await waitForShutdownRequest(shutdownRequested);
} catch (error) {
  exitCode = 1;
  console.error(`E2E_RUNTIME_ERROR ${sanitizeConsoleText(error instanceof Error ? error.message : String(error))}`);
} finally {
  try {
    await cleanup.dispose();
  } catch (error) {
    exitCode = 1;
    console.error(`E2E_RUNTIME_CLEANUP_ERROR ${sanitizeConsoleText(error instanceof Error ? error.message : String(error))}`);
  }
  process.exitCode = exitCode;
}

// Bun keeps a piped stdin handle referenced after pause; all owned resources are
// disposed above, so terminate the dedicated harness process explicitly.
process.exit(exitCode);

function waitForShutdownRequest(shutdownRequested: Promise<void>): Promise<void> {
  return new Promise((resolvePromise) => {
    let resolved = false;
    const parentPid = Number(process.env.E2E_PARENT_PID || "0");
    const parentWatchdog = parentPid > 0 ? setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        finish();
      }
    }, 1_000) : undefined;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (parentWatchdog) clearInterval(parentWatchdog);
      process.removeListener("SIGINT", finish);
      process.removeListener("SIGTERM", finish);
      process.stdin.removeListener("end", finish);
      process.stdin.removeListener("close", finish);
      process.stdin.pause();
      resolvePromise();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
    process.stdin.once("end", finish);
    process.stdin.once("close", finish);
    void shutdownRequested.then(finish);
    process.stdin.resume();
  });
}
