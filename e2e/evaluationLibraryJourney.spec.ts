import { expect, test } from "@playwright/test";

import { createBrowserEvidence } from "./support/browserEvidence";
import { ONE_PIXEL_PNG, saveModelGateway, submitSignUp } from "./support/journeyHelpers";
import { startRuntimeHarness, type RuntimeHarness } from "./support/runtimeHarnessClient";

const ACCOUNT = {
  email: "browser-evaluation-library@example.test",
  name: "Browser Library",
  password: "Strong1!",
};

const TEMPLATE = {
  name: "E2E Library Invoice",
  description: "Extract the visible invoice number.",
  fields: [{
    id: "invoice_number",
    name: "Invoice Number",
    description: "The invoice identifier printed on the source Document.",
    data_type: "string",
  }],
};

const SAVED = { name: "library-invoice.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG };
const FRESH = { name: "fresh-invoice.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG };

test("a user saves a verified document to the library and reuses it in a Batch Evaluation", async ({ page }, testInfo) => {
  const evidence = await createBrowserEvidence(page);
  let harness: RuntimeHarness | undefined;

  try {
    harness = await startRuntimeHarness({ sourceStorage: "local" });
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

    const evaluations = page.getByRole("region", { name: "Evaluations" });
    const setUp = async () => {
      await evaluations.getByRole("combobox", { name: "Template", exact: true }).selectOption({ label: TEMPLATE.name });
      await expect(evaluations.getByRole("textbox", { name: "Candidate 1 model" })).toHaveValue("browser/model");
      await evaluations.getByRole("textbox", { name: "Candidate 2 model" }).fill("browser/model-b");
      await evaluations.getByRole("button", { name: "Start and run" }).click();
    };

    // One upload, verified and then explicitly saved; running never saves anything by itself.
    await navigation.getByRole("button", { name: /Evaluations/ }).click();
    await evaluations.getByLabel("Evaluation document").setInputFiles(SAVED);
    await setUp();
    const matrix = evaluations.getByRole("region", { name: "Comparison matrix" });
    await expect(matrix.getByRole("status").filter({ hasText: "Done" })).toHaveCount(2);
    await matrix.getByRole("button", { name: "Add expected Invoice Number" }).click();
    await matrix.getByRole("textbox", { name: "Expected Invoice Number" }).fill("INV-E2E-001");
    await matrix.getByRole("button", { name: "Verify" }).click();
    await expect(matrix.getByText("100%", { exact: true })).toHaveCount(2);

    await evaluations.getByRole("button", { name: "Save to library…" }).click();
    const saveDialog = page.getByRole("dialog", { name: "Save to Evaluation library" });
    await expect(saveDialog.getByText(/1 of 1 answers verified/)).toBeVisible();
    await saveDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(evaluations.getByText("Saved “library-invoice” to the Workspace library.")).toBeVisible();

    await evaluations.getByRole("button", { name: /^Clear Evaluation/ }).click();
    const clearDialog = page.getByRole("dialog", { name: "Clear Evaluation" });
    await expect(clearDialog.getByText("Nothing unsaved. Saved library documents stay in the library.")).toBeVisible();
    await clearDialog.getByRole("button", { name: "Clear Evaluation" }).click();

    // A new Evaluation mixes the saved entry with a fresh upload; every document runs against the same candidates.
    await evaluations.getByRole("button", { name: "Choose from library" }).first().click();
    const picker = page.getByRole("dialog", { name: "Choose from library" });
    await picker.getByRole("checkbox", { name: "Select library-invoice" }).check();
    await picker.getByRole("button", { name: "Add 1 document" }).click();
    await evaluations.getByLabel("Evaluation document").setInputFiles(FRESH);
    await expect(evaluations.getByText("library-invoice", { exact: true })).toBeVisible();
    await expect(evaluations.getByText(FRESH.name, { exact: true })).toBeVisible();
    await setUp();

    const summary = evaluations.getByRole("region", { name: "Batch summary" });
    await expect(summary.getByRole("status").filter({ hasText: "Done" })).toHaveCount(4);
    // Equal field accuracy over the same verified scope stays tied rather than picking a winner.
    await expect(evaluations.getByText(/^Tied best: browser\/model, browser\/model-b/)).toBeVisible();

    // Answer edits stay in this tab until the user explicitly updates the shared copy.
    await evaluations.getByRole("tab", { name: "library-invoice" }).click();
    const savedMatrix = evaluations.getByRole("region", { name: "Comparison matrix" });
    await savedMatrix.getByRole("button", { name: "Edit expected Invoice Number" }).click();
    await savedMatrix.getByRole("textbox", { name: "Expected Invoice Number" }).fill("INV-E2E-999");
    await savedMatrix.getByRole("button", { name: "Verify" }).click();
    await expect(evaluations.getByText("Working copy.")).toBeVisible();
    await expect(savedMatrix.getByText("0%", { exact: true })).toHaveCount(2);
    await evaluations.getByRole("button", { name: "Update saved answers…" }).click();
    const review = page.getByRole("dialog", { name: "Review saved answer update" });
    await expect(review.getByText(/INV-E2E-999/)).toBeVisible();
    await review.getByRole("button", { name: "Update saved answers" }).click();
    await expect(evaluations.getByText("Saved answers updated for the Workspace.")).toBeVisible();

    // Refresh discards the private Evaluation; the saved document stays in the library.
    await page.reload();
    await navigation.getByRole("button", { name: /Evaluations/ }).click();
    await expect(evaluations.getByRole("heading", { name: "Compare extraction results on your documents" })).toBeVisible();
    await expect(evaluations.getByRole("tab", { name: "library-invoice" })).toHaveCount(0);
    await evaluations.getByRole("button", { name: "Manage library" }).first().click();
    const library = page.getByRole("dialog", { name: "Manage library" });
    await expect(library.getByText("library-invoice", { exact: true })).toBeVisible();
    expect(evidence.externalWebSockets()).toEqual([]);
  } finally {
    try {
      await evidence.attach(testInfo);
    } finally {
      if (!page.isClosed()) await page.close();
      await harness?.stop();
    }
  }
});
