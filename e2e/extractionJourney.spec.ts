import { expect, test } from "@playwright/test";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createBrowserEvidence } from "./support/browserEvidence";
import { startRuntimeHarness } from "./support/runtimeHarnessClient";

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

test("a verified user completes a Document Extraction job through Workspace live updates", async ({ page }, testInfo) => {
  const evidence = await createBrowserEvidence(page);
  let harness: Awaited<ReturnType<typeof startRuntimeHarness>> | undefined;

  try {
    harness = await startRuntimeHarness();
    await page.goto(harness.origin);

    await page.getByRole("link", { name: "Sign Up" }).click();
    await page.getByLabel("Name").fill(ACCOUNT.name);
    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByLabel("Password", { exact: true }).fill(ACCOUNT.password);
    await page.getByLabel("Confirm Password").fill(ACCOUNT.password);
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByRole("status")).toContainText("Check your email to verify your account");

    const verificationMail = await harness.waitForVerificationMail(ACCOUNT.email);
    const verificationResponse = await fetch(verificationMail.actionUrl, { redirect: "manual" });
    expect(verificationResponse.status).toBe(302);

    await page.goto(harness.origin);
    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByLabel("Password", { exact: true }).fill(ACCOUNT.password);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connection Settings" })).toBeVisible();
    await expect(page.getByText("API Ready", { exact: true }).first()).toBeVisible();

    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await navigation.getByRole("button", { name: /Templates/ }).click();
    await page.getByRole("button", { name: "Create Template" }).click();
    await expect(page.getByRole("heading", { name: "Create Template" })).toBeVisible();
    await page.getByRole("button", { name: "Export / Import" }).click();
    const templateDialog = page.getByRole("dialog", { name: "Export or import template JSON" });
    await templateDialog.getByRole("textbox", { name: "Template JSON", exact: true }).fill(JSON.stringify(TEMPLATE));
    const templateCreated = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/v1/templates" &&
      response.request().method() === "POST",
    );
    await templateDialog.getByRole("button", { name: "Save Template JSON" }).click();
    expect((await templateCreated).status()).toBe(201);
    await expect(page.getByText(`Template saved: ${TEMPLATE.name}`)).toBeVisible();

    await page.getByLabel("Description", { exact: true }).fill("Extract the visible invoice reference.");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText(`Template saved: ${TEMPLATE.name}`)).toBeVisible();

    await page.getByRole("button", { name: "Upload Document", exact: true }).first().click();
    const uploadDialog = page.getByRole("dialog", { name: "Upload document" });
    await uploadDialog.getByLabel("Template").selectOption({ label: TEMPLATE.name });
    await uploadDialog.locator('input[type="file"]').setInputFiles({
      name: "invoice-e2e.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    const extractionQueued = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/v1/extract" &&
      response.request().method() === "POST",
    );
    await uploadDialog.getByRole("button", { name: "Upload Documents" }).click();
    expect((await extractionQueued).status()).toBe(202);
    await expect(uploadDialog.getByText("Success", { exact: true })).toBeVisible();
    await uploadDialog.getByRole("button", { name: "Cancel" }).click();

    await navigation.getByRole("button", { name: /Documents/ }).click();
    await expect(page.getByRole("heading", { name: "Document Details" })).toBeVisible();
    await expect(page.getByText("INV-E2E-001", { exact: true })).toBeVisible();
    expect(evidence.completedWorkspaceFrames()).not.toEqual([]);
    expect(evidence.externalWebSockets()).toEqual([]);

    const jobSelection = page.getByRole("checkbox", { name: /^Select job / });
    await jobSelection.click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export 1 Job" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^browser-journey-workspace-job-export-\d{4}-\d{2}-\d{2}-\d{4}\.xlsx$/,
    );

    await jobSelection.click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete Document" }).click();
    await expect(page.getByText(/Document deleted:/)).toBeVisible();
    await expect(page.getByText("INV-E2E-001", { exact: true })).toHaveCount(0);

    await navigation.getByRole("button", { name: /Templates/ }).click();
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
