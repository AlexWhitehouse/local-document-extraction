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
  fields: [
    {
      id: "invoice_number",
      name: "Invoice Number",
      description: "The invoice identifier printed on the source Document.",
      data_type: "string",
    },
  ],
};

const SAVED = { name: "library-invoice.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG };

const FRESH = { name: "fresh-invoice.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG };

test("a user saves a verified document to the library and reuses it in a Batch Evaluation", async ({
  page,
}, testInfo) => {
  const evidence = await createBrowserEvidence(page);
  let harness: RuntimeHarness | undefined;

  try {
    harness = await startRuntimeHarness({ sourceStorage: "local" });
    await submitSignUp(page, harness, ACCOUNT);
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    await saveModelGateway(page, harness, "browser/model");

    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await navigation.getByRole("link", { name: /Templates/ }).click();
    await page.getByRole("button", { name: "Create template" }).click();
    await page.locator(".ui-page-header").getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "View JSON" }).click();
    const templateDialog = page.getByRole("dialog", { name: "Export or import JSON" });
    await templateDialog.getByRole("textbox", { name: "Template JSON", exact: true }).fill(JSON.stringify(TEMPLATE));

    const creation = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/v1/templates" && response.request().method() === "POST",
    );

    await templateDialog.getByRole("button", { name: "Save JSON" }).click();
    const created = await creation;
    const { template_id: templateId } = await created.json();
    const headers = { "x-workspace-id": created.request().headers()["x-workspace-id"] };
    await expect(page.getByText(`Template saved: ${TEMPLATE.name}`)).toBeVisible();

    const evaluations = page.getByRole("region", { name: "Evaluations" });

    const setUp = async () => {
      await evaluations.getByRole("combobox", { name: "Template", exact: true }).selectOption({ label: TEMPLATE.name });
      await expect(evaluations.getByRole("textbox", { name: "Candidate 1 model" })).toHaveValue("browser/model");
      await evaluations.getByRole("textbox", { name: "Candidate 2 model" }).fill("browser/model-b");
      await evaluations.getByRole("button", { name: "Start and run" }).click();
    };

    // One upload, verified and then explicitly saved; running never saves anything by itself.
    await navigation.getByRole("link", { name: /Evaluations/ }).click();
    await evaluations.getByLabel("Evaluation document").setInputFiles(SAVED);
    await setUp();
    const matrix = evaluations.getByRole("region", { name: "Comparison matrix" });
    await expect(matrix.locator(".evaluation-status", { hasText: "Completed" })).toHaveCount(2);
    await matrix.getByRole("button", { name: "Add expected Invoice Number" }).click();
    await matrix.getByRole("textbox", { name: "Expected Invoice Number" }).fill("INV-E2E-001");
    await matrix.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(matrix.getByText("100%", { exact: true })).toHaveCount(2);

    await evaluations.getByRole("button", { name: "Save to library…" }).click();
    const saveDialog = page.getByRole("dialog", { name: "Save to evaluation library" });
    await expect(saveDialog.getByText(/1 of 1 answers verified/)).toBeVisible();
    await saveDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/^Saved to library: library-invoice$/)).toBeVisible();

    await evaluations.getByRole("button", { name: /^Clear evaluation/ }).click();
    const clearDialog = page.getByRole("dialog", { name: "Clear evaluation" });
    await expect(clearDialog.getByText("Nothing unsaved.", { exact: true })).toBeVisible();
    await clearDialog.getByRole("button", { name: "Clear evaluation" }).click();

    // A new Evaluation mixes the saved entry with a fresh upload; every document runs against the same candidates.
    await evaluations.getByRole("button", { name: "Library" }).first().click();
    const picker = page.getByRole("dialog", { name: "Evaluation library" });
    await picker.getByRole("checkbox", { name: "Select library-invoice" }).check();
    await picker.getByRole("button", { name: "Add 1 document" }).click();
    await expect(evaluations.getByText("library-invoice", { exact: true })).toBeVisible();
    await evaluations.getByLabel("Evaluation document").setInputFiles(FRESH);
    await expect(evaluations.getByText(FRESH.name, { exact: true })).toBeVisible();
    await setUp();

    const documents = evaluations.getByRole("navigation", { name: "Documents in this evaluation" });
    const savedMatrix = evaluations.getByRole("region", { name: "Comparison matrix" });
    await expect(documents.getByText("Document 1 of 2", { exact: true })).toBeVisible();
    await expect(savedMatrix.locator(".evaluation-status", { hasText: "Completed" })).toHaveCount(2);
    await expect(savedMatrix.getByText("100%", { exact: true })).toHaveCount(2);
    await documents.getByRole("button", { name: "Next", exact: true }).click();
    await expect(documents.getByText("Document 2 of 2", { exact: true })).toBeVisible();
    await expect(evaluations.getByTitle(FRESH.name)).toBeVisible();
    await expect(savedMatrix.locator(".evaluation-status", { hasText: "Completed" })).toHaveCount(2);
    await documents.getByRole("button", { name: "Previous", exact: true }).click();

    // Answer edits stay in this tab until the user explicitly updates the shared copy.
    await expect(documents.getByText("Document 1 of 2", { exact: true })).toBeVisible();
    await savedMatrix.getByRole("button", { name: "Edit expected Invoice Number" }).click();
    await savedMatrix.getByRole("textbox", { name: "Expected Invoice Number" }).fill("INV-E2E-999");
    await savedMatrix.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(evaluations.getByTitle("library-invoice")).toContainText("answer changes not saved");
    await expect(savedMatrix.getByText("0%", { exact: true })).toHaveCount(2);
    await evaluations.getByRole("button", { name: "Update saved answers…" }).click();
    const review = page.getByRole("dialog", { name: "Review saved answer update" });
    await expect(review.getByText(/INV-E2E-999/)).toBeVisible();
    await review.getByRole("button", { name: "Update saved answers" }).click();
    await expect(review).toBeHidden();
    await expect(page.getByText(/^Saved answers updated/).last()).toBeVisible();

    // Refresh discards the private Evaluation; the saved document stays in the library.
    await page.reload();
    await navigation.getByRole("link", { name: /Evaluations/ }).click();
    await expect(
      evaluations.getByRole("heading", { name: "Documents", exact: true }),
    ).toBeVisible();
    await expect(evaluations.getByRole("navigation", { name: "Documents in this evaluation" })).toHaveCount(0);
    await evaluations.getByRole("button", { name: "Manage library" }).first().click();
    const library = page.getByRole("dialog", { name: "Manage library" });
    await expect(library.getByText("library-invoice", { exact: true })).toBeVisible();

    // The library editor opens only saved fields and answers, and saves without a model call.
    const modelRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/evaluations\/(run|actions)$/.test(new URL(request.url()).pathname)) modelRequests.push(request.url());
    });
    await library.getByRole("button", { name: "Edit library-invoice" }).click();
    const editorMatrix = evaluations.getByRole("region", { name: "Comparison matrix" });
    await expect(editorMatrix).toBeVisible();
    await expect(editorMatrix.getByRole("columnheader")).toHaveCount(2);
    await expect(evaluations.getByRole("textbox", { name: /model/ })).toHaveCount(0);
    await expect(evaluations.getByRole("button", { name: /^Run/ })).toHaveCount(0);
    await editorMatrix.getByRole("button", { name: "Edit expected Invoice Number" }).click();
    await editorMatrix.getByRole("textbox", { name: "Expected Invoice Number" }).fill("INV-EDITED");
    await editorMatrix.getByRole("button", { name: "Verify", exact: true }).click();
    await evaluations.getByRole("button", { name: "Update saved answers…" }).click();
    await page.getByRole("dialog", { name: "Review saved answer update" }).getByRole("button", { name: "Update saved answers" }).click();
    await expect(review).toBeHidden();
    await expect(page.getByText(/^Saved answers updated/).last()).toBeVisible();
    await page.reload();
    await evaluations.getByRole("button", { name: "Manage library" }).click();
    await library.getByRole("button", { name: "Edit library-invoice" }).click();
    await expect(editorMatrix.getByText("INV-EDITED", { exact: true })).toBeVisible();

    // A saved Template changes later. Select historical or current fields without rerunning the document.
    const updated = await page.request.patch(`${harness.origin}/v1/templates/${templateId}`, {
      headers,
      data: {
        ...TEMPLATE,
        fields: [...TEMPLATE.fields, { id: "reviewed", name: "Reviewed", data_type: "boolean", description: "Whether the invoice is reviewed." }],
      },
    });

    expect(updated.status()).toBe(200);
    await page.reload();
    await evaluations.getByRole("button", { name: "Manage library" }).click();
    await library.getByRole("button", { name: "Edit library-invoice" }).click();
    await evaluations.getByRole("button", { name: "Choose template version" }).click();
    const versions = page.getByRole("dialog", { name: "Choose template version" });
    await versions.getByRole("combobox", { name: "Template", exact: true }).selectOption(templateId);
    await expect(versions.getByRole("combobox", { name: "Version" })).toContainText("Current · v2");
    await versions.getByRole("combobox", { name: "Version" }).selectOption("1");
    await versions.getByRole("button", { name: "Use template version" }).click();
    await expect(evaluations.getByTitle(`${TEMPLATE.name} · v1`)).toBeVisible();
    await expect(editorMatrix.getByRole("button", { name: "Add expected Reviewed" })).toHaveCount(0);
    await evaluations.getByRole("button", { name: "Choose template version" }).click();
    await expect(versions.getByRole("combobox", { name: "Template", exact: true })).toHaveValue(templateId);
    await versions.getByRole("button", { name: "Use template version" }).click();
    await expect(evaluations.getByTitle(`${TEMPLATE.name} · v2`)).toBeVisible();
    await expect(editorMatrix.getByText("INV-EDITED", { exact: true })).toBeVisible();

    // Editing here saves the selected Template and uses its new version immediately.
    await evaluations.getByRole("button", { name: "Edit template" }).click();
    const templateEditor = page.getByRole("dialog", { name: "Edit template" });
    await expect(templateEditor.getByRole("textbox", { name: "Template name" })).toHaveValue(TEMPLATE.name);
    await templateEditor.getByRole("combobox", { name: "Type", exact: true }).selectOption("number");
    await templateEditor.getByRole("button", { name: "Save template", exact: true }).click();
    await expect(templateEditor).toHaveCount(0);
    await expect(evaluations.getByTitle(`${TEMPLATE.name} · v3`)).toBeVisible();
    await expect(editorMatrix.getByRole("rowheader", { name: /^Invoice Number/ })).toHaveCount(1);
    await expect(editorMatrix.getByRole("button", { name: "Edit expected Invoice Number" })).toHaveCount(0);
    await expect(editorMatrix.getByText('Previously saved as Text: “INV-EDITED”')).toBeVisible();
    const persisted = await page.request.get(`${harness.origin}/v1/templates/${templateId}`, { headers });
    expect(await persisted.json()).toMatchObject({ name: TEMPLATE.name, current_version: 3, fields: [{ ...TEMPLATE.fields[0], data_type: "number" }, { name: "Reviewed" }] });
    const previous = await page.request.get(`${harness.origin}/v1/evaluations/templates/${templateId}?version=2`, { headers });
    expect((await previous.json()).fields[0].data_type).toBe("string");
    await editorMatrix.getByRole("button", { name: "Review as Number" }).click();
    const expected = page.getByRole("dialog", { name: "Verify expected answer" });
    await expected.getByRole("textbox", { name: "Expected value", exact: true }).fill("1001");
    await expected.getByRole("button", { name: "Use as expected answer" }).click();

    await editorMatrix.getByRole("button", { name: "Add expected Reviewed" }).click();
    await editorMatrix.getByRole("combobox", { name: "Expected Reviewed", exact: true }).selectOption("false");
    await editorMatrix.getByRole("button", { name: "Verify", exact: true }).click();
    await evaluations.getByRole("button", { name: "Update saved answers…" }).click();
    await page.getByRole("dialog", { name: "Review saved answer update" }).getByRole("button", { name: "Update saved answers" }).click();
    await expect(review).toBeHidden();
    await expect(page.getByText(/^Saved answers updated/).last()).toBeVisible();
    await page.reload();
    await evaluations.getByRole("button", { name: "Manage library" }).click();
    await library.getByRole("button", { name: "Edit library-invoice" }).click();
    await expect(editorMatrix.getByRole("button", { name: "Edit expected Reviewed" })).toContainText("No");
    await expect(editorMatrix.getByRole("button", { name: "Edit expected Invoice Number" })).toContainText("1001");
    expect(modelRequests).toEqual([]);
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
