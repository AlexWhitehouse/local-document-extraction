import { expect, test } from "@playwright/test";
import { access } from "node:fs/promises";

import { createBrowserEvidence } from "./support/browserEvidence";
import { ONE_PIXEL_PNG, saveModelGateway, submitSignUp } from "./support/journeyHelpers";
import { startRuntimeHarness, type RuntimeHarness } from "./support/runtimeHarnessClient";

const ACCOUNT = {
  email: "browser-evaluation@example.test",
  name: "Browser Evaluation",
  password: "Strong1!",
};

const TEMPLATE = {
  name: "E2E Evaluation Invoice",
  description: "Extract the visible invoice number.",
  fields: [{
    id: "invoice_number",
    name: "Invoice Number",
    description: "The invoice identifier printed on the source Document.",
    data_type: "string",
  }],
};

const DOCUMENT = {
  name: "evaluation-e2e.png",
  mimeType: "image/png",
  buffer: ONE_PIXEL_PNG,
};

test("a user sets up, runs and scores a model Evaluation from the setup screen", async ({ page }, testInfo) => {
  const evidence = await createBrowserEvidence(page);
  let harness: RuntimeHarness | undefined;

  try {
    harness = await startRuntimeHarness();
    await submitSignUp(page, harness, ACCOUNT);
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    await saveModelGateway(page, harness, "browser/model");

    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await navigation.getByRole("button", { name: /Templates/ }).click();
    await page.getByRole("button", { name: "Create Template" }).click();
    await page.getByRole("button", { name: "View JSON" }).click();
    const templateDialog = page.getByRole("dialog", { name: "Export or import template JSON" });
    await templateDialog.getByRole("textbox", { name: "Template JSON", exact: true }).fill(JSON.stringify(TEMPLATE));
    await templateDialog.getByRole("button", { name: "Save Template JSON" }).click();
    await expect(page.getByText(`Template saved: ${TEMPLATE.name}`)).toBeVisible();

    await navigation.getByRole("button", { name: /Evaluations/ }).click();
    const evaluations = page.getByRole("region", { name: "Evaluations" });
    await expect(evaluations.getByRole("heading", { name: "Compare extraction results on one document" })).toBeVisible();
    await expect(evaluations.getByText("Workspace model", { exact: true })).toHaveCount(0);
    await evaluations.getByRole("radio", { name: /Template versions/ }).click();
    await expect(evaluations.getByText("Workspace model", { exact: true })).toBeVisible();
    await evaluations.getByRole("radio", { name: /Models/ }).click();
    await expect(evaluations.getByText("Workspace model", { exact: true })).toHaveCount(0);

    await evaluations.getByLabel("Evaluation document").setInputFiles(DOCUMENT);
    await expect(evaluations.getByText(DOCUMENT.name, { exact: true })).toBeVisible();
    await evaluations.getByRole("combobox", { name: "Template", exact: true }).selectOption({ label: TEMPLATE.name });
    await expect(evaluations.getByText(/^1 field/)).toBeVisible();
    await expect(evaluations.getByRole("textbox", { name: "Candidate 1 model" })).toHaveValue("browser/model");
    await evaluations.getByRole("textbox", { name: "Candidate 2 model" }).fill("browser/model-b");
    await evaluations.getByRole("button", { name: "Start and run" }).click();

    const matrix = evaluations.getByRole("region", { name: "Comparison matrix" });
    await expect(matrix).toBeVisible();
    await expect(matrix.getByRole("status").filter({ hasText: "Done" })).toHaveCount(2);
    await expect(matrix.getByText("INV-E2E-001", { exact: true })).toHaveCount(2);

    await matrix.getByRole("button", { name: "Add expected Invoice Number" }).click();
    await matrix.getByRole("textbox", { name: "Expected Invoice Number" }).fill("inv-e2e-001");
    await matrix.getByRole("button", { name: "Verify" }).click();
    await expect(matrix.getByText("100%", { exact: true })).toHaveCount(2);
    await expect(matrix.getByText("Best", { exact: true })).toHaveCount(1);
    await expect(evaluations.getByText("1 of 1 verified", { exact: true })).toBeVisible();

    await matrix.getByRole("button", { name: "Inspect Invoice Number for Candidate 2" }).click();
    await expect(evaluations.getByRole("complementary", { name: "Answer inspector" }).getByText("browser/model-b")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await evaluations.getByRole("button", { name: "Clear Evaluation" }).click();
    await expect(evaluations.getByRole("heading", { name: "Compare extraction results on one document" })).toBeVisible();
    expect(evidence.externalWebSockets()).toEqual([]);
  } finally {
    try {
      await evidence.attach(testInfo);
    } finally {
      if (!page.isClosed()) await page.close();
      const stateDirectory = harness?.stateDirectory;
      await harness?.stop();
      if (stateDirectory) await expect(access(stateDirectory)).rejects.toThrow();
    }
  }
});
