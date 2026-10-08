import { expect, test, type Page } from "@playwright/test";

import { signIn, submitSignUp, type BrowserAccount } from "./support/journeyHelpers";
import { startRuntimeHarness, type RuntimeHarness } from "./support/runtimeHarnessClient";

const ACCOUNT: BrowserAccount = {
  name: "Consistency Reviewer",
  email: "consistency@example.test",
  password: "Strong1!",
};

async function listTemplateIds(page: Page, harness: RuntimeHarness, workspace: string): Promise<string[]> {
  const response = await page.request.get(`${harness.origin}/v1/templates`, {
    headers: { "x-workspace-id": workspace },
  });

  const body: { templates: { id: string }[] } = await response.json();

  return body.templates.map((item) => item.id);
}

function trackNativeDialogs(page: Page): string[] {
  const nativeDialogs: string[] = [];

  page.on("dialog", (dialog) => {
    nativeDialogs.push(`${dialog.type()}: ${dialog.message()}`);

    void dialog.dismiss();
  });

  return nativeDialogs;
}

async function createWorkspaceAndTemplate(page: Page, harness: RuntimeHarness, templateName: string) {
  const createdWorkspace = await page.request.post(`${harness.origin}/v1/workspaces`, {
    data: { name: "Disposable Workspace" },
  });

  expect(createdWorkspace.ok()).toBe(true);
  const workspace = (await createdWorkspace.json()).workspace_id;

  const createdTemplate = await page.request.post(`${harness.origin}/v1/templates`, {
    headers: { "x-workspace-id": workspace },
    data: {
      name: templateName,
      description: "Created for the destructive flow",
      fields: [{ name: "Total", description: "Invoice total", data_type: "string" }],
    },
  });

  expect(createdTemplate.ok()).toBe(true);

  const created: { template_id: string } = await createdTemplate.json();

  return { workspace, template: created.template_id };
}

test("destructive flows use the in-app dialog and never a native dialog", async ({ page }) => {
  const harness = await startRuntimeHarness();
  const nativeDialogs = trackNativeDialogs(page);

  try {
    await submitSignUp(page, harness, ACCOUNT);
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();

    const templateName = "Disposable Template";
    const { workspace, template } = await createWorkspaceAndTemplate(page, harness, templateName);
    await page.goto(`${harness.origin}/workspaces/${workspace}/templates/${template}`);
    await expect(page.getByLabel("Template name", { exact: true })).toHaveValue(templateName);

    // Cancel keeps the template.
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete template" }).click();

    const confirm = page.getByRole("alertdialog", { name: `Delete "${templateName}"?` });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await expect(confirm.getByRole("button", { name: "Delete template", exact: true })).toBeVisible();

    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByLabel("Template name", { exact: true })).toHaveValue(templateName);

    expect(await listTemplateIds(page, harness, workspace)).toContain(template);

    // Confirming deletes the template.
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete template" }).click();
    const confirmAgain = page.getByRole("alertdialog", { name: `Delete "${templateName}"?` });
    await confirmAgain.getByRole("button", { name: "Delete template", exact: true }).click();

    await expect(page.getByText(/Template deleted/).first()).toBeVisible();
    await expect(confirmAgain).toHaveCount(0);

    expect(await listTemplateIds(page, harness, workspace)).not.toContain(template);
    await expect(page.getByRole("link", { name: new RegExp(templateName) })).toHaveCount(0);

    // Deleting a workspace uses the same in-app dialog.
    await page.goto(`${harness.origin}/workspaces/${workspace}`);
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete workspace" }).click();

    const workspaceConfirm = page.getByRole("alertdialog", { name: 'Delete "Disposable Workspace"?' });
    await expect(workspaceConfirm).toBeVisible();
    await expect(workspaceConfirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await workspaceConfirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(workspaceConfirm).toHaveCount(0);

    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete workspace" }).click();
    await page
      .getByRole("alertdialog", { name: 'Delete "Disposable Workspace"?' })
      .getByRole("button", { name: "Delete workspace", exact: true })
      .click();
    await expect(page.getByText("Workspace deleted")).toBeVisible();

    const workspacesAfter = await (await page.request.get(`${harness.origin}/v1/workspaces`)).json();
    expect(workspacesAfter.workspaces.map((item: { id: string }) => item.id)).not.toContain(workspace);

    expect(nativeDialogs).toEqual([]);
  } finally {
    await harness.stop();
  }
});

test("the sign-in form shows field errors inline and a rejected password as a form alert", async ({ page, request }) => {
  const harness = await startRuntimeHarness();

  try {
    // A separate request context keeps the API sign-up from signing the page in.
    await request.post(`${harness.origin}/api/auth/sign-up/email`, {
      data: { name: ACCOUNT.name, email: ACCOUNT.email, password: ACCOUNT.password },
    });

    await page.goto(harness.origin);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    const email = page.getByLabel("Email", { exact: true });
    const password = page.getByLabel("Password", { exact: true });
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);

    await email.fill(ACCOUNT.email);
    await password.fill("Wrong-password1!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    const formAlert = page.locator("form").getByRole("alert");
    await expect(formAlert).toHaveCount(1);
    await expect(formAlert).toBeVisible();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);

    // The alert sits above the Sign in button, not beside the fields.
    const alertBox = await formAlert.boundingBox();
    const submitBox = await page.getByRole("button", { name: "Sign in", exact: true }).boundingBox();
    expect(alertBox && submitBox && alertBox.y + alertBox.height <= submitBox.y).toBe(true);

    await password.fill(ACCOUNT.password);
    await signIn(page, ACCOUNT);
  } finally {
    await harness.stop();
  }
});

test("a failed Document list offers Try again instead of the empty state", async ({ page }) => {
  const harness = await startRuntimeHarness();
  const nativeDialogs = trackNativeDialogs(page);

  try {
    await submitSignUp(page, harness, { ...ACCOUNT, email: "documents-retry@example.test" });
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();

    // The Document list loads with the Workspace, so the forced failure is armed before a reload.
    const isDocumentList = (url: URL) => url.pathname === "/v1/jobs";

    await page.route(isDocumentList, (route) => {
      if (route.request().method() !== "GET") return route.fallback();

      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "internal_error", message: "forced failure" } }),
      });
    });
    await page.reload();

    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await navigation.getByRole("link", { name: /Documents/ }).click();

    const failure = page.getByRole("alert").filter({ has: page.getByRole("button", { name: "Try again" }) });
    await expect(failure).toBeVisible();
    await expect(page.getByText("No documents yet")).toHaveCount(0);

    await page.unroute(isDocumentList);
    await failure.getByRole("button", { name: "Try again" }).click();

    await expect(failure).toHaveCount(0);
    await expect(page.getByText("No documents yet")).toBeVisible();
    expect(nativeDialogs).toEqual([]);
  } finally {
    await harness.stop();
  }
});
