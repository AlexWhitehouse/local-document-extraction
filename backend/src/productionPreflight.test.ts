import { chmod, mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("../scripts/productionPreflight.mjs", import.meta.url));

const openServers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  openServers.length = 0;
});

describe("Production preflight", () => {
  it("rejects test-mode Stripe Price IDs without printing deployment values", async () => {
    const root = await createPreflightFixture({
      proPriceId: "price_test_mode_pro",
      maxPriceId: "price_live_max",
    });
    const stripeServer = await startStripePriceServer({
      price_test_mode_pro: stripePrice({ id: "price_test_mode_pro", livemode: false, unit_amount: 5000 }),
      price_live_max: stripePrice({ id: "price_live_max", livemode: true, unit_amount: 20000 }),
    });

    const result = await execPreflight(root, stripeServer.origin, {
      PRODUCTION_PREFLIGHT_SKIP_FRONTEND_BUILD: "1",
      PRODUCTION_PREFLIGHT_SKIP_REMOTE_CHECKS: "1",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Stripe price check failed for Pro monthly Price");
    expect(result.stderr).toContain("expected live-mode Price");
    expect(result.stderr).not.toContain("rk_live_test_secret");
    expect(result.stderr).not.toContain("whsec_test_secret");
    expect(result.stderr).not.toContain("price_test_mode_pro");
  });

  it("rejects a live Stripe webhook endpoint subscribed to all events", async () => {
    const root = await createPreflightFixture({
      proPriceId: "price_live_pro",
      maxPriceId: "price_live_max",
    });
    const stripeServer = await startStripePriceServer(
      {
        price_live_pro: stripePrice({ id: "price_live_pro", livemode: true, unit_amount: 5000 }),
        price_live_max: stripePrice({ id: "price_live_max", livemode: true, unit_amount: 20000 }),
      },
      {
        webhookEndpoints: [
          {
            id: "we_all_events",
            object: "webhook_endpoint",
            url: "https://extract.t3m.uk/v1/billing/stripe/webhook",
            status: "enabled",
            livemode: true,
            enabled_events: ["*"],
          },
        ],
      },
    );

    const result = await execPreflight(root, stripeServer.origin, {
      PRODUCTION_PREFLIGHT_SKIP_FRONTEND_BUILD: "1",
      PRODUCTION_PREFLIGHT_SKIP_REMOTE_CHECKS: "1",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Stripe webhook setup check failed");
    expect(result.stderr).toContain("must not subscribe to all events");
    expect(result.stderr).not.toContain("rk_live_test_secret");
    expect(result.stderr).not.toContain("whsec_test_secret");
  });

  it("runs frontend build and remote Worker checks before a production deploy", async () => {
    const root = await createPreflightFixture({
      proPriceId: "price_live_pro",
      maxPriceId: "price_live_max",
    });
    const commandLogPath = join(root, "commands.log");
    const fakeNpm = await createFakeCommand(root, "npm");
    const fakeWrangler = await createFakeCommand(root, "wrangler");
    const stripeServer = await startStripePriceServer(
      {
        price_live_pro: stripePrice({ id: "price_live_pro", livemode: true, unit_amount: 5000 }),
        price_live_max: stripePrice({ id: "price_live_max", livemode: true, unit_amount: 20000 }),
      },
      { webhookEndpoints: [validWebhookEndpoint()] },
    );

    const result = await execPreflight(root, stripeServer.origin, {
      PREFLIGHT_COMMAND_LOG: commandLogPath,
      PRODUCTION_PREFLIGHT_NPM: fakeNpm,
      PRODUCTION_PREFLIGHT_WRANGLER: fakeWrangler,
      PRODUCTION_PREFLIGHT_CUSTOM_DOMAIN_HEALTH_URL: `${stripeServer.origin}/health`,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Production preflight passed.");
    expect(result.stdout).not.toContain("rk_live_test_secret");
    expect(result.stdout).not.toContain("price_live_pro");

    const commands = (await readFile(commandLogPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { name: string; args: string[]; cwd: string });
    const backendCwd = await realpath(join(root, "backend"));

    expect(commands).toContainEqual({
      name: "npm",
      args: ["run", "build", "--prefix", join(root, "frontend")],
      cwd: backendCwd,
    });
    expect(commands).toContainEqual({
      name: "wrangler",
      args: ["d1", "migrations", "list", "document-extraction-db", "--remote"],
      cwd: backendCwd,
    });
    expect(commands).toContainEqual({
      name: "wrangler",
      args: ["deploy", "--dry-run", "--secrets-file", join(root, ".vars")],
      cwd: backendCwd,
    });
  });
});

async function execPreflight(
  root: string,
  stripeApiBaseUrl: string,
  envOverrides: Record<string, string> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [scriptPath, "--root", root],
      {
        env: {
          ...process.env,
          PRODUCTION_PREFLIGHT_STRIPE_API_BASE_URL: stripeApiBaseUrl,
          PRODUCTION_PREFLIGHT_CUSTOM_DOMAIN_HEALTH_URL: `${stripeApiBaseUrl}/health`,
          ...envOverrides,
        },
      },
      (error, stdout, stderr) => {
        resolve({
          code: typeof error?.code === "number" ? error.code : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

async function createPreflightFixture(input: { proPriceId: string; maxPriceId: string }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "document-extraction-preflight-"));
  await mkdir(join(root, "backend"));
  await mkdir(join(root, "frontend"));

  await writeFile(
    join(root, ".vars"),
    [
      "AI_GATEWAY_TOKEN=ai_gateway_token",
      "BETTER_AUTH_SECRET=better_auth_secret",
      "GOOGLE_CLIENT_ID=google_client_id",
      "GOOGLE_CLIENT_SECRET=google_client_secret",
      "STRIPE_API_KEY=rk_live_test_secret",
      "STRIPE_WEBHOOK_SECRET=whsec_test_secret",
      `STRIPE_PRO_MONTHLY_PRICE_ID=${input.proPriceId}`,
      `STRIPE_MAX_MONTHLY_PRICE_ID=${input.maxPriceId}`,
      "",
    ].join("\n"),
  );

  await writeFile(
    join(root, "backend", "wrangler.jsonc"),
    `{
      "name": "document-extraction-api",
      "main": "src/index.ts",
      "compatibility_date": "2026-04-14",
      "compatibility_flags": ["nodejs_compat"],
      "workers_dev": false,
      "observability": { "enabled": true, "head_sampling_rate": 1, "logs": { "enabled": true, "invocation_logs": true } },
      "triggers": { "crons": ["17 * * * *"] },
      "routes": [{ "pattern": "extract.t3m.uk", "custom_domain": true }],
      "assets": { "directory": "../frontend/dist", "binding": "ASSETS", "run_worker_first": true, "not_found_handling": "single-page-application" },
      "d1_databases": [{ "binding": "DB", "database_name": "document-extraction-db", "database_id": "test-db", "migrations_dir": "migrations" }],
      "durable_objects": { "bindings": [{ "name": "WORKSPACE_PRODUCT_STORE", "class_name": "WorkspaceProductStore" }, { "name": "WORKSPACE_BILLING_LEDGER", "class_name": "WorkspaceBillingLedger" }] },
      "migrations": [{ "tag": "v1_workspace_product_store", "new_sqlite_classes": ["WorkspaceProductStore"] }, { "tag": "v2_workspace_billing_ledger", "new_sqlite_classes": ["WorkspaceBillingLedger"] }],
      "r2_buckets": [{ "binding": "SOURCE_FILES_BUCKET", "bucket_name": "document-extraction-source-files" }],
      "queues": { "producers": [{ "binding": "EXTRACTION_JOBS_QUEUE", "queue": "document-extraction-jobs" }], "consumers": [{ "queue": "document-extraction-jobs", "max_batch_size": 1, "max_batch_timeout": 3, "max_retries": 5 }] },
      "workflows": [{ "name": "document-processing-workflow", "binding": "DOCUMENT_PROCESSING_WORKFLOW", "class_name": "DocumentProcessingWorkflow" }],
      "ai": { "binding": "AI" },
      "analytics_engine_datasets": [{ "binding": "WORKSPACE_PRODUCT_ANALYTICS", "dataset": "workspace_product_analytics" }],
      "send_email": [{ "name": "EMAIL", "remote": true }],
      "vars": { "AI_GATEWAY_ID": "default", "AI_GATEWAY_REQUEST_TIMEOUT_MS": "300000", "AI_MODEL": "google/gemini-3-flash", "BETTER_AUTH_TRUSTED_ORIGINS": "https://extract.t3m.uk", "MAX_SOURCE_FILE_BYTES": "10485760" },
      "secrets": { "required": ["AI_GATEWAY_TOKEN", "BETTER_AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "STRIPE_API_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRO_MONTHLY_PRICE_ID", "STRIPE_MAX_MONTHLY_PRICE_ID"] }
    }`,
  );

  await writeFile(join(root, "frontend", "package.json"), `{"scripts":{"build":"node -e \\"process.exit(0)\\""}}`);

  return root;
}

async function createFakeCommand(root: string, name: "npm" | "wrangler"): Promise<string> {
  const commandPath = join(root, name);
  await writeFile(
    commandPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.PREFLIGHT_COMMAND_LOG, JSON.stringify({
  name: path.basename(process.argv[1]),
  args: process.argv.slice(2),
  cwd: process.cwd()
}) + "\\n");
`,
  );
  await chmod(commandPath, 0o755);
  return commandPath;
}

async function startStripePriceServer(
  prices: Record<string, unknown>,
  options: { webhookEndpoints?: unknown[] } = {},
): Promise<{ origin: string }> {
  const server = http.createServer((request, response) => {
    const priceId = decodeURIComponent(request.url?.match(/^\/v1\/prices\/([^?]+)/)?.[1] || "");
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url?.startsWith("/v1/webhook_endpoints")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: options.webhookEndpoints || [validWebhookEndpoint()] }));
      return;
    }
    if (!priceId || !(priceId in prices)) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(prices[priceId]));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  openServers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Stripe test server did not bind to a TCP port");
  }
  return { origin: `http://127.0.0.1:${address.port}` };
}

function validWebhookEndpoint() {
  return {
    id: "we_live_billing",
    object: "webhook_endpoint",
    url: "https://extract.t3m.uk/v1/billing/stripe/webhook",
    status: "enabled",
    livemode: true,
    enabled_events: [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "invoice.finalized",
      "invoice.finalization_failed",
      "invoice.paid",
      "invoice.payment_succeeded",
      "invoice.payment_failed",
      "invoice.payment_action_required",
      "invoice.voided",
      "invoice.marked_uncollectible",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "customer.subscription.paused",
      "customer.subscription.resumed",
    ],
  };
}

function stripePrice(input: { id: string; livemode: boolean; unit_amount: number }) {
  return {
    id: input.id,
    object: "price",
    livemode: input.livemode,
    active: true,
    currency: "gbp",
    unit_amount: input.unit_amount,
    recurring: { interval: "month" },
    product: {
      id: `prod_${input.id}`,
      object: "product",
      active: true,
    },
  };
}
