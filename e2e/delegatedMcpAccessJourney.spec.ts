import { expect, test, type Page } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { isJsonObject, isString, parseJson, type JsonObject, type JsonValue } from "../shared/json";
import { confirmInAppDialog, ONE_PIXEL_PNG, saveModelGateway, submitSignUp } from "./support/journeyHelpers";
import { startRuntimeHarness, type RuntimeHarness } from "./support/runtimeHarnessClient";

const ACCOUNT = { email: "mcp-owner@example.test", name: "MCP Owner", password: "Strong1!" };

const UPLOADER = { email: "mcp-uploader@example.test", name: "MCP Uploader", password: "Strong1!" };

const STRANGER = { email: "mcp-stranger@example.test", name: "MCP Stranger", password: "Strong1!" };

const CALLBACK = "https://client.example/callback";

const OTHER_CLIENT_NAME = "Second E2E client";

const CLIENT_NAME = "E2E client";

const TEMPLATE = {
  name: "MCP Invoice",
  description: "Extract the visible invoice number.",
  fields: [
    {
      id: "invoice_number",
      name: "Invoice Number",
      description: "The invoice identifier printed on the source Document.",
      data_type: "string",
    },
  ],
};

test("an MCP client connects through verification, gets one approval and is disconnected", async ({ page }) => {
  let harness: RuntimeHarness | undefined;

  try {
    harness = await startRuntimeHarness({
      requireEmailVerification: true,
      mcp: { redirectUris: [CALLBACK], sensitiveActions: true },
    });

    const { origin } = harness;
    const callbacks = await captureClientCallbacks(page);
    const clientId = await registerClient(origin, CLIENT_NAME);

    // Signed out: the authorization request opens the connect page, and sign-up keeps it through verification.
    const denied = authorizationRequest(origin, clientId, "workspace:read documents:read");
    await page.goto(denied.url);
    await expect(page).toHaveURL(/\/mcp\/connect\?/);
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await page.getByLabel("Name").fill(ACCOUNT.name);
    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByLabel("Password", { exact: true }).fill(ACCOUNT.password);
    await page.getByLabel("Confirm password").fill(ACCOUNT.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("status")).toContainText("We saved a verification link");

    const verification = await harness.waitForVerificationMail(ACCOUNT.email);
    expect(new URL(verification.actionUrl).searchParams.get("callbackURL")).toContain("/mcp/connect?");
    await page.goto(verification.actionUrl);

    // Denial reaches the client as an error and leaves no connection.
    await expect(page.getByRole("heading", { name: `Connect ${CLIENT_NAME}` })).toBeVisible();
    await expect(page.getByLabel("Workspace", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "Deny", exact: true }).click();
    await expect.poll(() => callbacks.length).toBe(1);
    expect(callbacks[0]!.searchParams.get("error")).toBe("access_denied");
    expect(callbacks[0]!.searchParams.get("code")).toBeNull();

    // With a session, the next request goes straight to consent.
    const allowed = authorizationRequest(origin, clientId, "workspace:read documents:read workspace:api-key offline_access");
    await page.goto(allowed.url);
    await expect(page.getByRole("heading", { name: `Connect ${CLIENT_NAME}` })).toBeVisible();
    await page.getByRole("button", { name: "Allow access" }).click();
    await expect(page.getByText("Choose a workspace.")).toBeVisible();
    await page.getByLabel("Workspace", { exact: true }).selectOption({ index: 1 });
    await expect(page.getByRole("checkbox", { name: /Stay connected/ })).not.toBeChecked();
    await page.getByRole("checkbox", { name: /Stay connected/ }).check();
    await page.getByRole("button", { name: "Allow access" }).click();
    await expect.poll(() => callbacks.length).toBe(2);
    expect(callbacks[1]!.searchParams.get("state")).toBe(allowed.state);

    const accessToken = await exchangeCode(origin, clientId, callbacks[1]!, allowed);
    const context = await callTool(origin, accessToken, "workspace_context", {});
    expect(context.status).toBe(200);

    // A sensitive action waits for approval in the app; the new key appears only there.
    const requested = await callTool(origin, accessToken, "request_action_approval", {
      operation_id: "e2e-rotate-api-key-1",
      request: { action: "workspace.rotate_api_key" },
    });

    expect(requested.status).toBe(200);
    const approvalPath = requested.text.match(/\/mcp\/approvals\/[A-Za-z0-9_-]+/)?.[0];
    expect(approvalPath).toBeTruthy();

    await page.goto(`${origin}${approvalPath}`);
    await expect(page.getByRole("heading", { name: "Rotate workspace API key" })).toBeVisible();
    await expect(page.getByText(CLIENT_NAME).first()).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    const newKey = page.getByLabel("New workspace API key");
    await expect(newKey).not.toHaveValue("");
    const apiKey = await newKey.inputValue();
    await expect(page.getByText("This key won't be shown again. Copy it now.")).toBeVisible();

    const operation = await callTool(origin, accessToken, "get_operation", {
      request_id: approvalPath!.split("/").pop(),
    });

    expect(operation.text).toContain("completed");
    expect(operation.text).not.toContain(apiKey);

    // Disconnecting revokes the token straight away and keeps the browser session.
    await page.goto(`${origin}/connected-apps`);
    const row = page.getByRole("row", { name: new RegExp(CLIENT_NAME) });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: `Disconnect ${CLIENT_NAME}` }).click();
    await confirmInAppDialog(page, `Disconnect "${CLIENT_NAME}"?`, "Disconnect app");
    await expect(page.getByText(`App disconnected: ${CLIENT_NAME}`)).toBeVisible();
    await expect(page.getByText(/No apps are connected/)).toBeVisible();

    const afterRevoke = await callTool(origin, accessToken, "workspace_context", {});
    expect([401, 403]).toContain(afterRevoke.status);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Connected apps" })).toBeVisible();
  } finally {
    const stateDirectory = harness?.stateDirectory;
    await harness?.stop();

    if (stateDirectory) await expect(access(stateDirectory)).rejects.toThrow();
  }
});

test("an MCP client gets a document uploaded in the app, submits it and reads the extraction", async ({ page, browser }) => {
  let harness: RuntimeHarness | undefined;

  try {
    harness = await startRuntimeHarness({ mcp: { redirectUris: [CALLBACK] } });

    const { origin } = harness;
    await submitSignUp(page, harness, UPLOADER);
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    await saveModelGateway(page, harness, "browser/model");

    const callbacks = await captureClientCallbacks(page);
    const clientId = await registerClient(origin, CLIENT_NAME);
    const otherClientId = await registerClient(origin, OTHER_CLIENT_NAME);
    const scope = "workspace:read documents:read documents:submit templates:write";
    const token = await connect(page, origin, clientId, scope, callbacks);
    const otherToken = await connect(page, origin, otherClientId, scope, callbacks);

    const template = await callTool(origin, token, "create_template", { operation_id: "e2e-template-0001", template: TEMPLATE });
    const templateId = String(toolOutput(template).template_id);
    expect(templateId).toMatch(/^tpl/);

    const requested = toolOutput(await callTool(origin, token, "request_document_upload", {}));
    const sourceRef = String(requested.source_ref);
    const uploadUrl = new URL(String(requested.upload_url));
    expect(uploadUrl.origin).toBe(origin);
    expect(uploadUrl.pathname).toBe(`/mcp/uploads/${sourceRef}`);

    // Nothing can be submitted until the person has chosen a file in the app.
    const early = await callTool(origin, token, "submit_document", { source_ref: sourceRef, operation_id: "e2e-submit-early" });
    expect(toolError(early)).toBe("mcp_upload_used");

    // The link belongs to the account that connected the app.
    const stranger = await browser.newContext();

    try {
      const strangerPage = await stranger.newPage();
      await submitSignUp(strangerPage, harness, STRANGER);
      await expect(strangerPage.getByRole("heading", { name: "Workspace details" })).toBeVisible();
      await strangerPage.goto(uploadUrl.href);
      await expect(strangerPage.getByRole("heading", { name: "Upload link unavailable" })).toBeVisible();
      await expect(strangerPage.getByLabel("Choose a document")).toHaveCount(0);
    } finally {
      await stranger.close();
    }

    await page.goto(uploadUrl.href);
    await expect(page.getByRole("heading", { name: "Upload a document" })).toBeVisible();
    await expect(page.getByText(`Upload for ${CLIENT_NAME}`)).toBeVisible();
    await page.getByLabel("Choose a document").setInputFiles({ name: "invoice-mcp.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
    await expect(page.getByText("invoice-mcp.png", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText(`Return to ${CLIENT_NAME} to continue.`, { exact: false })).toBeVisible();
    await expect(page.getByText("Document uploaded: invoice-mcp.png")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Uploaded", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Choose a document")).toHaveCount(0);

    // A link takes one file.
    const replaced = await uploadThroughApi(page, origin, sourceRef);
    expect(replaced.status).toBe(409);
    expect(replaced.code).toBe("mcp_upload_used");

    // Another connection, even for the same account and Workspace, can't use this file.
    const foreign = await callTool(origin, otherToken, "submit_document", { source_ref: sourceRef, operation_id: "e2e-submit-foreign" });
    expect(toolError(foreign)).toBe("mcp_upload_not_found");

    const submission = { source_ref: sourceRef, operation_id: "e2e-submit-0001", template_id: templateId };
    const submitted = toolOutput(await callTool(origin, token, "submit_document", submission));
    const jobId = String(submitted.job_id);
    expect(jobId).toBeTruthy();

    // Retrying the same operation returns the same document; the file can't start a second one.
    const retried = toolOutput(await callTool(origin, token, "submit_document", submission));
    expect(retried.job_id).toBe(jobId);
    const reused = await callTool(origin, token, "submit_document", { ...submission, operation_id: "e2e-submit-0002" });
    expect(toolError(reused)).toBe("mcp_upload_used");

    let document: JsonObject = {};

    await expect
      .poll(
        async () => {
          document = toolOutput(await callTool(origin, token, "get_document", { document_id: jobId }));

          return isJsonObject(document.document) ? document.document.status : null;
        },
        { timeout: 30_000, intervals: [500] },
      )
      .toBe("completed");

    expect(JSON.stringify(document.document)).toContain("INV-E2E-001");
    const documentUrl = new URL(String(document.url));
    expect(documentUrl.origin).toBe(origin);

    const foreignRead = await callTool(origin, otherToken, "get_document", { document_id: jobId });
    expect(toolOutput(foreignRead).document).toBeTruthy();

    await page.goto(documentUrl.href);
    await expect(page.getByText("INV-E2E-001", { exact: true }).first()).toBeVisible();

    // An expired link can't take a file or be submitted. Waiting 15 minutes isn't practical,
    // so the link's expiry is moved into the past in the installation's database.
    const expiring = toolOutput(await callTool(origin, token, "request_document_upload", {}));
    const expiredRef = String(expiring.source_ref);
    await expireUpload(harness.stateDirectory, expiredRef);
    await page.goto(String(expiring.upload_url));
    await expect(page.getByRole("heading", { name: "Upload link expired" })).toBeVisible();
    await expect(page.getByText("This upload link has expired. Ask the app for a new one.")).toBeVisible();
    const lateUpload = await uploadThroughApi(page, origin, expiredRef);
    expect(lateUpload.status).toBe(410);
    expect(lateUpload.code).toBe("mcp_upload_expired");
    const lateSubmit = await callTool(origin, token, "submit_document", { source_ref: expiredRef, operation_id: "e2e-submit-late" });
    expect(toolError(lateSubmit)).toBe("mcp_upload_expired");

    // Disconnecting closes the app's open links straight away.
    const pending = toolOutput(await callTool(origin, token, "request_document_upload", {}));
    await page.goto(`${origin}/connected-apps`);
    const row = page.getByRole("row", { name: new RegExp(`^${CLIENT_NAME}`) });
    await expect(row.getByText("Unverified app")).toBeVisible();
    await row.getByRole("button", { name: `Disconnect ${CLIENT_NAME}` }).click();
    await confirmInAppDialog(page, `Disconnect "${CLIENT_NAME}"?`, "Disconnect app");
    await expect(page.getByText(`App disconnected: ${CLIENT_NAME}`)).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(`^${OTHER_CLIENT_NAME}`) })).toBeVisible();

    await page.goto(String(pending.upload_url));
    await expect(page.getByRole("heading", { name: "Upload link unavailable" })).toBeVisible();
    const revokedUpload = await uploadThroughApi(page, origin, String(pending.source_ref));
    expect([403, 404]).toContain(revokedUpload.status);
    const afterRevoke = await callTool(origin, token, "get_document", { document_id: jobId });
    expect([401, 403]).toContain(afterRevoke.status);
  } finally {
    const stateDirectory = harness?.stateDirectory;
    await harness?.stop();

    if (stateDirectory) await expect(access(stateDirectory)).rejects.toThrow();
  }
});

test("an installation with connected apps turned off says so and offers no connection address", async ({ page }) => {
  let harness: RuntimeHarness | undefined;

  try {
    harness = await startRuntimeHarness();
    await submitSignUp(page, harness, UPLOADER);
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();

    await page.getByRole("button", { name: new RegExp(UPLOADER.name) }).click();
    await page.getByRole("dialog", { name: "Settings" }).getByRole("link", { name: "Manage connected apps" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Connected apps" })).toBeVisible();
    await expect(page.getByText(/Connected apps are turned off for this installation/)).toBeVisible();
    await expect(page.getByText("No apps are connected.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Connection address")).toHaveCount(0);

    const protocol = await callTool(harness.origin, "not-a-token", "workspace_context", {});
    expect(protocol.status).toBe(404);
  } finally {
    await harness?.stop();
  }
});

// The client's redirect target is outside the loopback test network, so the browser
// request is answered here and recorded.
async function captureClientCallbacks(page: Page) {
  const callbacks: URL[] = [];

  await page.route(`${CALLBACK}**`, async (route) => {
    callbacks.push(new URL(route.request().url()));
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Client</title><h1>Back in the client</h1>" });
  });

  return callbacks;
}

async function registerClient(origin: string, clientName: string) {
  const response = await fetch(`${origin}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });

  expect(response.status).toBe(201);
  const body = parseJson(await response.text());

  if (!isJsonObject(body) || !isString(body.client_id)) throw new Error("Client registration returned no client_id");

  return body.client_id;
}

function authorizationRequest(origin: string, clientId: string, scope: string) {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(8).toString("hex");

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: CALLBACK,
    response_type: "code",
    scope,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: `${origin}/mcp`,
  });

  return { url: `${origin}/api/auth/oauth2/authorize?${query}`, verifier, state };
}

async function exchangeCode(origin: string, clientId: string, callback: URL, request: { verifier: string }) {
  const code = callback.searchParams.get("code");
  expect(code).toBeTruthy();

  const response = await fetch(`${origin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: code!,
      code_verifier: request.verifier,
      redirect_uri: CALLBACK,
      resource: `${origin}/mcp`,
    }),
  });

  expect(response.status).toBe(200);
  const body = parseJson(await response.text());

  if (!isJsonObject(body) || !isString(body.access_token)) throw new Error("Token response had no access_token");

  return body.access_token;
}

async function callTool(origin: string, token: string, name: string, args: JsonObject) {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });

  return { status: response.status, text: await response.text() };
}

// Consent with an existing session: choose the only Workspace and allow the requested access.
async function connect(page: Page, origin: string, clientId: string, scope: string, callbacks: URL[]) {
  const request = authorizationRequest(origin, clientId, scope);
  const previous = callbacks.length;
  await page.goto(request.url);
  await expect(page.getByRole("heading", { name: /^Connect / })).toBeVisible();
  await expect(page.getByText("Unverified app").first()).toBeVisible();
  await page.getByLabel("Workspace", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Allow access" }).click();
  await expect.poll(() => callbacks.length).toBe(previous + 1);

  return exchangeCode(origin, clientId, callbacks[previous]!, request);
}

// Tool results are JSON-RPC responses carrying the structured output, sent as JSON or as one event.
function toolResultOf(response: { status: number; text: string }) {
  expect(response.status).toBe(200);
  const data = response.text.split("\n").find((line) => line.startsWith("data:"));
  const body = parseJson(data ? data.slice("data:".length) : response.text);

  if (!isJsonObject(body) || !isJsonObject(body.result)) throw new Error(`Unexpected MCP response: ${response.text}`);
  const { result } = body;

  if (!isJsonObject(result.structuredContent)) throw new Error(`MCP result had no structured content: ${response.text}`);

  return { isError: result.isError === true, output: result.structuredContent };
}

function toolOutput(response: { status: number; text: string }): JsonObject {
  const result = toolResultOf(response);

  if (result.isError) throw new Error(`MCP tool failed: ${response.text}`);

  return result.output;
}

function toolError(response: { status: number; text: string }): JsonValue {
  const result = toolResultOf(response);
  expect(result.isError).toBe(true);

  return isJsonObject(result.output.error) ? (result.output.error.code ?? null) : null;
}

// Posts straight to the upload endpoint with the browser's session, as a second tab would.
async function uploadThroughApi(page: Page, origin: string, uploadId: string) {
  const response = await page.request.post(`${origin}/v1/mcp/uploads/${encodeURIComponent(uploadId)}`, {
    headers: { origin },
    multipart: { file: { name: "second.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG } },
  });

  const body = parseJson(await response.text());
  const error = isJsonObject(body) && isJsonObject(body.error) ? body.error.code : null;

  return { status: response.status(), code: error };
}

async function expireUpload(stateDirectory: string, uploadId: string) {
  const script = `
    import { Database } from "bun:sqlite";
    const [path, id] = process.argv.slice(-2);
    const database = new Database(path, { readwrite: true, create: false });
    database.exec("PRAGMA busy_timeout = 5000");
    const changes = database.query("UPDATE mcp_uploads SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 60_000).toISOString(), id).changes;
    database.close();
    if (changes !== 1) throw new Error("upload not found");
  `;

  await promisify(execFile)(process.env.E2E_BUN_EXECUTABLE || "bun", ["-e", script, join(stateDirectory, "data", "control.sqlite"), uploadId]);
}
