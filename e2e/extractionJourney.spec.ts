import { expect, test } from "@playwright/test";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { createBrowserEvidence } from "./support/browserEvidence";
import { ONE_PIXEL_PNG, saveModelGateway, submitSignUp } from "./support/journeyHelpers";
import { startRuntimeHarness, type RuntimeHarness } from "./support/runtimeHarnessClient";

const ACCOUNT = {
  email: "browser-journey@example.test",
  name: "Browser Journey",
  password: "Strong1!",
};

const TEMPLATE = {
  name: "E2E Invoice",
  description: "Extract the visible invoice number.",
  fields: [{
    id: "invoice_number",
    name: "Invoice Number",
    description: "The invoice identifier printed on the source Document.",
    data_type: "string",
  }],
};

test("a new user completes a Document Extraction job without email verification by default", async ({ page }, testInfo) => {
  const evidence = await createBrowserEvidence(page);
  let harness: RuntimeHarness | undefined;

  try {
    harness = await startRuntimeHarness();
    await submitSignUp(page, harness, ACCOUNT);
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    await expect(page.getByText("API Ready", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Open your local verification link.", { exact: true })).toHaveCount(0);
    expect(await readdir(join(harness.stateDirectory, "mail"))).toEqual([]);

    await saveModelGateway(page, harness, "browser/model");
    await expect(page.getByLabel("Gateway API key", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("article", { name: "Workspace Model gateway" }).getByText("browser/model", { exact: true })).toBeVisible();

    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await navigation.getByRole("link", { name: /Templates/ }).click();
    await page.getByRole("button", { name: "Create Template" }).click();
    await expect(page.getByRole("region", { name: "Template editor" })).toBeVisible();
    await expect(page.getByLabel("Template name", { exact: true })).toHaveValue("Invoice Template");
    await page.getByRole("button", { name: "View JSON" }).click();
    const templateDialog = page.getByRole("dialog", { name: "Export or import template JSON" });
    await templateDialog.getByRole("textbox", { name: "Template JSON", exact: true }).fill(JSON.stringify(TEMPLATE));
    const templateCreated = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/v1/templates" &&
      response.request().method() === "POST",
    );
    await templateDialog.getByRole("button", { name: "Save Template JSON" }).click();
    const createdResponse = await templateCreated;
    expect(createdResponse.status()).toBe(201);
    const { template_id: templateId } = await createdResponse.json();
    await expect(page.getByText(`Template saved: ${TEMPLATE.name}`)).toBeVisible();

    await page.getByLabel("Description", { exact: true }).fill("Extract the visible invoice reference.");
    const templateUpdated = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/v1/templates/${encodeURIComponent(templateId)}` &&
      response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    expect((await templateUpdated).status()).toBe(200);
    // Creation and editing can leave identical success toasts on screen.
    await expect(page.getByRole("region", { name: "Template editor" }).getByText(/All changes saved$/)).toBeVisible();

    await page.getByRole("button", { name: "Upload Document", exact: true }).first().click();
    const uploadDialog = page.getByRole("dialog", { name: "Upload document" });
    await uploadDialog.getByLabel("Template").selectOption({ label: TEMPLATE.name });
    await uploadDialog.locator('input[type="file"]').setInputFiles({
      name: "invoice-e2e.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });
    const extractionQueued = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/v1/extract" &&
      response.request().method() === "POST",
    );
    await uploadDialog.getByRole("button", { name: "Upload Documents" }).click();
    expect((await extractionQueued).status()).toBe(202);
    await expect(uploadDialog.getByText("Success", { exact: true })).toBeVisible();
    await uploadDialog.getByRole("button", { name: "Cancel" }).click();

    await navigation.getByRole("link", { name: /Documents/ }).click();
    await expect(page.getByRole("region", { name: "Document results" })).toBeVisible();
    await expect(page.getByText("INV-E2E-001", { exact: true })).toBeVisible();
    expect(evidence.completedWorkspaceFrames()).not.toEqual([]);
    expect(evidence.externalWebSockets()).toEqual([]);

    const jobSelection = page.getByRole("checkbox", { name: /^Select document / });
    await jobSelection.click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export 1" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^browser-journey-workspace-job-export-\d{4}-\d{2}-\d{2}-\d{4}\.xlsx$/,
    );

    await jobSelection.click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(/Document deleted:/)).toBeVisible();
    await expect(page.getByText("INV-E2E-001", { exact: true })).toHaveCount(0);

    await navigation.getByRole("link", { name: /Templates/ }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete Template" }).click();
    await expect(page.getByText(`Template deleted: ${TEMPLATE.name}`)).toBeVisible();
  } finally {
    try {
      await evidence.attach(testInfo);
    } finally {
      try {
        if (!page.isClosed()) {
          const screenshot = await page.screenshot({ fullPage: true });
          const screenshotPath = resolve(
            process.cwd(),
            ".scratch/ci/playwright/evidence/browser-final-state.png",
          );
          await mkdir(dirname(screenshotPath), { recursive: true });
          await writeFile(screenshotPath, screenshot);
          await testInfo.attach("browser-final-state", {
            path: screenshotPath,
            contentType: "image/png",
          });
          await page.close();
        }
      } finally {
        const stateDirectory = harness?.stateDirectory;
        await harness?.stop();
        if (stateDirectory) {
          await expect(access(stateDirectory)).rejects.toThrow();
        }
      }
    }
  }
});
