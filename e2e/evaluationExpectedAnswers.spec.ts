import { expect, test } from "@playwright/test";
import { createBrowserEvidence } from "./support/browserEvidence";
import { ONE_PIXEL_PNG, saveModelGateway, submitSignUp } from "./support/journeyHelpers";
import { startRuntimeHarness, type RuntimeHarness } from "./support/runtimeHarnessClient";

test("date formats, field errors and table cell statuses survive saving and reusing expected answers", async ({
  page,
}, testInfo) => {
  const evidence = await createBrowserEvidence(page);
  let harness: RuntimeHarness | undefined;

  try {
    harness = await startRuntimeHarness({ sourceStorage: "local" });
    await submitSignUp(page, harness, {
      email: "expected-answers@example.test",
      name: "Expected Answers",
      password: "Strong1!",
    });
    await saveModelGateway(page, harness, "browser/expected-answers");
    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await navigation.getByRole("link", { name: /Templates/ }).click();
    await page.getByRole("button", { name: "Create Template" }).click();
    await page.locator(".ui-page-header").getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "View JSON" }).click();
    const templateDialog = page.getByRole("dialog", { name: "Export or import template JSON" });
    await templateDialog.getByRole("textbox", { name: "Template JSON", exact: true }).fill(
      JSON.stringify({
        name: "Expected answer checks",
        description: "Check dates and optional table cells.",
        fields: [
          { id: "dob", name: "Date of birth", description: "Date printed on document", data_type: "date" },
          {
            id: "items",
            name: "Items",
            description: "Document items",
            data_type: "array<object>",
            object_schema: {
              mode: "table",
              columns: [
                { key: "sku", heading: "SKU", data_type: "string", description: "Item identifier" },
                { key: "quantity", heading: "Quantity", data_type: "number", description: "Item quantity" },
              ],
            },
          },
        ],
      }),
    );
    await templateDialog.getByRole("button", { name: "Save Template JSON" }).click();
    await expect(page.getByText("Template saved: Expected answer checks")).toBeVisible();
    await navigation.getByRole("link", { name: /Evaluations/ }).click();
    const evaluations = page.getByRole("region", { name: "Evaluations" });

    const start = async () => {
      await evaluations
        .getByRole("combobox", { name: "Template", exact: true })
        .selectOption({ label: "Expected answer checks" });
      await evaluations.getByRole("textbox", { name: "Candidate 2 model" }).fill("browser/expected-answers-b");
      await evaluations.getByRole("button", { name: "Start and run" }).click();
      await expect(evaluations.getByRole("status").filter({ hasText: "Done" })).toHaveCount(2);
    };

    await evaluations
      .getByLabel("Evaluation document")
      .setInputFiles({ name: "expected-answers.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
    await start();
    await evaluations.getByRole("button", { name: "Add expected Date of birth" }).click();
    await evaluations.getByRole("button", { name: "More options" }).click();
    const editor = page.getByRole("dialog", { name: "Verify expected answer" });
    const value = editor.getByRole("textbox", { name: "Expected value", exact: true });
    await value.fill("30/02/2026");
    await editor.getByRole("button", { name: "Use as expected answer" }).click();
    await expect(value).toHaveAttribute("aria-invalid", "true");
    await expect(value).toBeFocused();
    await expect(editor.getByRole("alert")).toContainText("valid calendar date");
    await page.screenshot({ path: testInfo.outputPath("date-validation.png") });
    await value.fill("08/09/1871");
    await expect(editor.getByRole("alert")).toHaveCount(0);
    await expect(editor.getByText("Interpreted as 8 September 1871")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("date-expected-answer.png") });
    await editor.getByRole("button", { name: "Use as expected answer" }).click();
    await expect(evaluations.getByRole("button", { name: "Edit expected Date of birth" })).toContainText("1871-09-08");
    await expect(evaluations.getByRole("button", { name: "Inspect Date of birth for Candidate 1" })).toContainText(
      "08/09/1871",
    );
    await expect(evaluations.getByText("100%", { exact: true })).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath("date-matching.png") });

    await evaluations.getByRole("button", { name: "Add expected rows" }).click();
    await editor.getByRole("textbox", { name: "Expected row 1 SKU", exact: true }).fill("A");
    await editor.getByRole("combobox", { name: "Expected row 1 Quantity status" }).selectOption("absent");
    await editor.getByRole("button", { name: "Add row" }).click();
    await editor.getByRole("textbox", { name: "Expected row 2 SKU", exact: true }).fill("B");
    await editor.getByRole("combobox", { name: "Expected row 2 Quantity status" }).selectOption("ignored");
    await editor.getByRole("combobox", { name: "Compare rows" }).selectOption("sku");
    await page.screenshot({ path: testInfo.outputPath("table-cell-status.png") });
    await editor.getByRole("button", { name: "Use as expected answer" }).click();
    await evaluations.getByRole("button", { name: "Save to library…" }).click();

    const saving = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === "/v1/evaluations/documents",
    );

    await page
      .getByRole("dialog", { name: "Save to Evaluation library" })
      .getByRole("button", { name: "Save", exact: true })
      .click();
    const saved = await saving;
    expect(saved.status()).toBe(201);
    const payload = await saved.json();
    expect(payload.reference.references["date of birth:date"].value).toBe("1871-09-08");
    expect(payload.reference.references["items:array<object>"].cellStates).toEqual([
      { quantity: "absent" },
      { quantity: "ignored" },
    ]);
    await expect(page.getByRole("dialog", { name: "Save to Evaluation library" })).toHaveCount(0);
    await evaluations.getByRole("button", { name: /^Clear Evaluation/ }).click();
    await page
      .getByRole("dialog", { name: "Clear Evaluation" })
      .getByRole("button", { name: "Clear Evaluation", exact: true })
      .click();
    await evaluations.getByRole("button", { name: "Library" }).first().click();
    const picker = page.getByRole("dialog", { name: "Evaluation library" });
    await picker.getByRole("checkbox", { name: "Select expected-answers" }).check();
    await picker.getByRole("button", { name: "Add 1 document" }).click();
    await start();
    await expect(evaluations.getByText("100%", { exact: true })).toHaveCount(2);
    await evaluations.getByRole("button", { name: "2 rows verified" }).click();
    await expect(editor.getByRole("combobox", { name: "Expected row 1 Quantity status" })).toHaveValue("absent");
    await editor.getByRole("button", { name: "Select row 2" }).click();
    await expect(editor.getByRole("combobox", { name: "Expected row 2 Quantity status" })).toHaveValue("ignored");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
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
