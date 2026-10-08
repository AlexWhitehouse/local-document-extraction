import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { startRuntimeHarness } from "./support/runtimeHarnessClient";
import { submitSignUp } from "./support/journeyHelpers";

test("authorized links restore through sign-in, refresh, new tabs and browser history", async ({ page, browser }) => {
  const harness = await startRuntimeHarness();
  const account = { name: "Navigation Reader", email: "navigation@example.test", password: "Strong1!" };
  const loginContext = await browser.newContext();

  try {
    await submitSignUp(page, harness, account);
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    const workspaces = await (await page.request.get(`${harness.origin}/v1/workspaces`)).json();
    const firstWorkspace = workspaces.workspaces[0].id;

    const createdWorkspace = await page.request.post(`${harness.origin}/v1/workspaces`, {
      data: { name: "Linked Workspace" },
    });

    expect(createdWorkspace.ok()).toBe(true);
    const workspace = (await createdWorkspace.json()).workspace_id;

    const createdTemplate = await page.request.post(`${harness.origin}/v1/templates`, {
      headers: { "x-workspace-id": workspace },
      data: {
        name: "Linked Template",
        description: "A bookmarkable Template",
        fields: [{ name: "Total", description: "Invoice total", data_type: "string" }],
      },
    });

    expect(createdTemplate.ok()).toBe(true);
    const template = (await createdTemplate.json()).template_id;
    const path = `/workspaces/${workspace}/templates/${template}`;
    await page.goto(`${harness.origin}${path}`);
    await expect(page.getByLabel("Template name", { exact: true })).toHaveValue("Linked Template");
    await page.reload();
    await expect(page.getByLabel("Template name", { exact: true })).toHaveValue("Linked Template");

    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await navigation.getByRole("link", { name: /Documents/ }).click();
    await expect(page).toHaveURL(`${harness.origin}/workspaces/${workspace}/documents`);
    await page.goBack();
    await expect(page.getByLabel("Template name", { exact: true })).toHaveValue("Linked Template");
    await page.goForward();
    await expect(page).toHaveURL(`${harness.origin}/workspaces/${workspace}/documents`);

    const tab = await page.context().newPage();
    await tab.goto(`${harness.origin}${path}`);
    await expect(tab.getByLabel("Template name", { exact: true })).toHaveValue("Linked Template");
    await expect(tab.getByRole("link", { name: new RegExp(`Linked Template.*${template}`) })).toHaveAttribute(
      "href",
      path,
    );
    await tab.close();

    const loginPage = await loginContext.newPage();
    await loginPage.goto(`${harness.origin}${path}`);
    await expect(loginPage.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await loginPage.getByLabel("Email", { exact: true }).fill(account.email);
    await loginPage.getByLabel("Password", { exact: true }).fill(account.password);
    await loginPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(loginPage.getByLabel("Template name", { exact: true })).toHaveValue("Linked Template");
    await expect(loginPage).toHaveURL(`${harness.origin}${path}`);

    await loginPage.goto(`${harness.origin}/workspaces/${firstWorkspace}`);
    await expect(loginPage.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    await loginPage.goto(`${harness.origin}${path}`);
    await expect(loginPage.getByLabel("Template name", { exact: true })).toHaveValue("Linked Template");

    await loginPage.goto(`${harness.origin}/workspaces/inaccessible/templates/${template}`);
    await expect(loginPage.getByText(/Workspace or invitation is unavailable/)).toBeVisible();
    await loginPage.goto(`${harness.origin}/workspaces/${workspace}/templates/deleted`);
    await expect(loginPage.getByText(/This Template is unavailable/)).toBeVisible();
    await loginPage.goto(`${harness.origin}/invalid/route`);
    await expect(loginPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
  } finally {
    await loginContext.close();
    await page.close();
    await harness.stop();
  }
});

test("Vite serves and restores an authenticated deep link", async ({ page }) => {
  const harness = await startRuntimeHarness();

  const vite = spawn(
    process.env.E2E_BUN_EXECUTABLE || "bun",
    ["run", "--cwd", "frontend", "dev", "--host", "127.0.0.1", "--port", "0"],
    {
      env: { ...process.env, DEV_API_ORIGIN: harness.origin },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const exited = new Promise((resolve) => vite.once("exit", resolve));
  let output = "";

  const captureOutput = (chunk: Buffer) => {
    output = (output + String(chunk)).slice(-16_384);
  };

  vite.stdout.on("data", captureOutput);
  vite.stderr.on("data", captureOutput);

  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Vite did not start: ${stripVTControlCharacters(output)}`)),
        15_000,
      );

      vite.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      vite.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error("Vite exited before readiness"));
      });
      vite.stdout.on("data", () => {
        const match = stripVTControlCharacters(output).match(/http:\/\/127\.0\.0\.1:\d+/);

        if (match) {
          clearTimeout(timeout);
          resolve(match[0]);
        }
      });
    });

    const signup = await page.request.post(`${harness.origin}/api/auth/sign-up/email`, {
      data: { name: "Dev Reader", email: "dev-reader@example.test", password: "Strong1!" },
    });

    expect(signup.ok()).toBe(true);
    const { workspaces } = await (await page.request.get(`${harness.origin}/v1/workspaces`)).json();
    const workspace = workspaces[0].id;

    const { templates } = await (
      await page.request.get(`${harness.origin}/v1/templates`, { headers: { "x-workspace-id": workspace } })
    ).json();

    expect(templates.length).toBeGreaterThan(0);
    await page.goto(`${origin}/workspaces/${workspace}/templates/${templates[0].id}`);
    await expect(page.getByLabel("Template name", { exact: true })).toHaveValue(templates[0].name);
    await page.reload();
    await expect(page.getByLabel("Template name", { exact: true })).toHaveValue(templates[0].name);
  } finally {
    await page.close();
    vite.kill("SIGTERM");
    await exited;
    await harness.stop();
  }
});
