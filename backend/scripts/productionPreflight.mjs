import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const STRIPE_API_VERSION = "2026-05-27.dahlia";
const execFileAsync = promisify(execFile);

const REQUIRED_PRICE_CHECKS = [
  {
    label: "Pro monthly Price",
    key: "STRIPE_PRO_MONTHLY_PRICE_ID",
    amountMinor: 5000,
  },
  {
    label: "Max monthly Price",
    key: "STRIPE_MAX_MONTHLY_PRICE_ID",
    amountMinor: 20000,
  },
];

const REQUIRED_WEBHOOK_EVENTS = [
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
];

class PreflightError extends Error {
  constructor(message) {
    super(message);
    this.name = "PreflightError";
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const rootDir = options.root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    await runProductionPreflight({ rootDir, env: process.env });
    console.log("Production preflight passed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Production preflight failed.";
    console.error(message);
    process.exitCode = 1;
  }
}

async function runProductionPreflight({ rootDir, env }) {
  const backendDir = path.join(rootDir, "backend");
  const config = parseJsonc(await readFile(path.join(backendDir, "wrangler.jsonc"), "utf8"));
  const deploymentValues = parseDotenv(await readFile(path.join(rootDir, ".vars"), "utf8"));

  validateRequiredDeploymentValues(config, deploymentValues);
  await validateStripePrices(deploymentValues, env);
  await validateStripeWebhookEndpoint({ config, deploymentValues, env });
  await validateFrontendBuild({ rootDir, backendDir, env });
  await validateRemoteWorkerChecks({ rootDir, config, backendDir, env });
  await validateCustomDomainHealth({ config, env });
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      const root = args[index + 1];
      if (!root) {
        throw new PreflightError("--root requires a path");
      }
      options.root = path.resolve(root);
      index += 1;
      continue;
    }
    throw new PreflightError(`Unknown production preflight option: ${arg}`);
  }
  return options;
}

function parseJsonc(configText) {
  return Function(`"use strict"; return (${configText});`)();
}

function parseDotenv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      throw new PreflightError("Production .vars contains a line without KEY=value syntax.");
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = unquoteDotenvValue(line.slice(separatorIndex + 1).trim());
    if (!key) {
      throw new PreflightError("Production .vars contains an empty key.");
    }
    values[key] = value;
  }
  return values;
}

function unquoteDotenvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function validateRequiredDeploymentValues(config, deploymentValues) {
  const required = config.secrets?.required;
  if (!Array.isArray(required) || required.length === 0) {
    throw new PreflightError("Worker configuration does not declare secrets.required.");
  }

  const missing = required.filter((key) => !deploymentValues[key]);
  if (missing.length > 0) {
    throw new PreflightError(`Production .vars is missing required deployment values: ${missing.join(", ")}`);
  }

  if (deploymentValues.STRIPE_PRO_MONTHLY_PRICE_ID === deploymentValues.STRIPE_MAX_MONTHLY_PRICE_ID) {
    throw new PreflightError("Stripe monthly Price configuration is invalid: Pro and Max must use distinct Prices.");
  }
}

async function validateStripePrices(deploymentValues, env) {
  for (const check of REQUIRED_PRICE_CHECKS) {
    const price = await fetchStripePrice({
      apiBaseUrl: env.PRODUCTION_PREFLIGHT_STRIPE_API_BASE_URL || "https://api.stripe.com",
      apiKey: deploymentValues.STRIPE_API_KEY,
      priceId: deploymentValues[check.key],
      label: check.label,
    });
    validateStripePriceShape(price, check);
  }
}

async function validateStripeWebhookEndpoint({ config, deploymentValues, env }) {
  const routePattern = getCustomDomainRoutePattern(config);
  const expectedUrl =
    env.PRODUCTION_PREFLIGHT_STRIPE_WEBHOOK_URL || `https://${routePattern}/v1/billing/stripe/webhook`;
  const apiBaseUrl = env.PRODUCTION_PREFLIGHT_STRIPE_API_BASE_URL || "https://api.stripe.com";

  let response;
  try {
    response = await fetch(`${apiBaseUrl}/v1/webhook_endpoints?limit=100`, {
      headers: {
        authorization: `Bearer ${deploymentValues.STRIPE_API_KEY}`,
        "stripe-version": STRIPE_API_VERSION,
      },
    });
  } catch {
    throw new PreflightError("Stripe webhook setup check failed: Stripe API request failed.");
  }

  if (!response.ok) {
    throw new PreflightError(`Stripe webhook setup check failed: Stripe API returned ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new PreflightError("Stripe webhook setup check failed: Stripe API returned invalid JSON.");
  }

  const endpoint = Array.isArray(payload?.data)
    ? payload.data.find((candidate) => candidate?.url === expectedUrl)
    : null;
  if (!endpoint) {
    throw new PreflightError("Stripe webhook setup check failed: expected live billing endpoint was not found.");
  }
  if (endpoint.livemode !== true) {
    throw new PreflightError("Stripe webhook setup check failed: expected live-mode endpoint.");
  }
  if (endpoint.status !== "enabled") {
    throw new PreflightError("Stripe webhook setup check failed: expected enabled endpoint.");
  }

  const enabledEvents = Array.isArray(endpoint.enabled_events) ? endpoint.enabled_events : [];
  if (enabledEvents.includes("*")) {
    throw new PreflightError("Stripe webhook setup check failed: endpoint must not subscribe to all events.");
  }

  const missingEvents = REQUIRED_WEBHOOK_EVENTS.filter((eventType) => !enabledEvents.includes(eventType));
  if (missingEvents.length > 0) {
    throw new PreflightError(`Stripe webhook setup check failed: missing required event types: ${missingEvents.join(", ")}`);
  }
}

async function fetchStripePrice({ apiBaseUrl, apiKey, priceId, label }) {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}/v1/prices/${encodeURIComponent(priceId)}?expand[]=product`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        "stripe-version": STRIPE_API_VERSION,
      },
    });
  } catch {
    throw new PreflightError(`Stripe price check failed for ${label}: Stripe API request failed.`);
  }

  if (!response.ok) {
    throw new PreflightError(`Stripe price check failed for ${label}: Stripe API returned ${response.status}.`);
  }

  try {
    return await response.json();
  } catch {
    throw new PreflightError(`Stripe price check failed for ${label}: Stripe API returned invalid JSON.`);
  }
}

function validateStripePriceShape(price, check) {
  if (price?.livemode !== true) {
    throw new PreflightError(`Stripe price check failed for ${check.label}: expected live-mode Price.`);
  }
  if (price?.active !== true) {
    throw new PreflightError(`Stripe price check failed for ${check.label}: expected active Price.`);
  }
  if (price?.currency !== "gbp") {
    throw new PreflightError(`Stripe price check failed for ${check.label}: expected GBP currency.`);
  }
  if (price?.recurring?.interval !== "month") {
    throw new PreflightError(`Stripe price check failed for ${check.label}: expected monthly recurring Price.`);
  }
  if (price?.unit_amount !== check.amountMinor) {
    throw new PreflightError(`Stripe price check failed for ${check.label}: expected code-owned catalog amount.`);
  }
}

async function validateFrontendBuild({ rootDir, backendDir, env }) {
  if (env.PRODUCTION_PREFLIGHT_SKIP_FRONTEND_BUILD === "1") {
    return;
  }
  await runCommand({
    command: env.PRODUCTION_PREFLIGHT_NPM || "npm",
    args: ["run", "build", "--prefix", path.join(rootDir, "frontend")],
    cwd: backendDir,
    env,
    failureMessage: "Frontend production build preflight failed.",
  });
}

async function validateRemoteWorkerChecks({ rootDir, config, backendDir, env }) {
  if (env.PRODUCTION_PREFLIGHT_SKIP_REMOTE_CHECKS === "1") {
    return;
  }

  const databaseName = config.d1_databases?.[0]?.database_name;
  if (!databaseName) {
    throw new PreflightError("Worker configuration is missing a D1 database name for remote migration checks.");
  }

  const wrangler = env.PRODUCTION_PREFLIGHT_WRANGLER || "wrangler";
  await runCommand({
    command: wrangler,
    args: ["d1", "migrations", "list", databaseName, "--remote"],
    cwd: backendDir,
    env,
    failureMessage: "Remote D1 migration preflight failed.",
  });
  await runCommand({
    command: wrangler,
    args: ["deploy", "--dry-run", "--secrets-file", path.join(rootDir, ".vars")],
    cwd: backendDir,
    env,
    failureMessage: "Worker deploy dry-run preflight failed.",
  });
}

async function validateCustomDomainHealth({ config, env }) {
  const routePattern = getCustomDomainRoutePattern(config);
  if (!routePattern && !env.PRODUCTION_PREFLIGHT_CUSTOM_DOMAIN_HEALTH_URL) {
    throw new PreflightError("Worker configuration is missing a custom-domain route for health checks.");
  }

  const healthUrl = env.PRODUCTION_PREFLIGHT_CUSTOM_DOMAIN_HEALTH_URL || `https://${routePattern}/v1/health`;
  let response;
  try {
    response = await fetch(healthUrl);
  } catch {
    throw new PreflightError("Custom domain health preflight failed.");
  }
  if (!response.ok) {
    throw new PreflightError(`Custom domain health preflight failed with HTTP ${response.status}.`);
  }
}

function getCustomDomainRoutePattern(config) {
  return config.routes?.find((route) => route?.custom_domain === true)?.pattern || "";
}

async function runCommand({ command, args, cwd, env, failureMessage }) {
  try {
    await execFileAsync(command, args, {
      cwd,
      env,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new PreflightError(failureMessage);
  }
}

await main();
