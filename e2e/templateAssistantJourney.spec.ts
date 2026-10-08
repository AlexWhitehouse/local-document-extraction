import { expect, test } from "@playwright/test";
import { saveModelGateway, submitSignUp } from "./support/journeyHelpers";
import { startRuntimeHarness } from "./support/runtimeHarnessClient";

test("review a focused VAT column proposal, apply to the draft once, and save explicitly", async ({
  page,
}, testInfo) => {
  const harness = await startRuntimeHarness();

  try {
    await submitSignUp(page, harness, {
      name: "Template Reviewer",
      email: "template-reviewer@example.test",
      password: "Strong1!",
    });
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    await saveModelGateway(page, harness, "browser/template-assistant");
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: /Templates/ })
      .click();
    await page.getByRole("button", { name: "Create template", exact: true }).click();
    await page.getByLabel("Template name", { exact: true }).fill("VAT invoice");

    const creation = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/v1/templates" && response.request().method() === "POST",
    );

    await page.getByRole("button", { name: "Save new template", exact: true }).click();
    const created = await creation;
    expect(created.status()).toBe(201);
    const { template_id: templateId } = await created.json();
    const workspaceId = created.request().headers()["x-workspace-id"];

    const readSaved = async () => {
      const result = await page.request.get(`${harness.origin}/v1/templates/${templateId}`, {
        headers: { "x-workspace-id": workspaceId },
      });

      expect(result.status()).toBe(200);

      return result.json();
    };

    const original = await readSaved();
    // The save toast sits over the header; close it before opening the assistant.

    for (const close of await page.getByRole("button", { name: "Close toast" }).all()) await close.click();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    const assistant = page.getByRole("complementary", { name: "Template assistant" });
    await expect(assistant.getByText("From the model", { exact: true })).toBeVisible();
    // The edit icon fills the request without sending it; the card itself sends in one click.
    await assistant.getByRole("button", { name: "Edit “Add VAT rate to each line item” before sending" }).click();
    await expect(assistant.getByRole("textbox", { name: "What do you need?", exact: true })).toHaveValue(
      "Add VAT rate to each line item.",
    );
    const proposal = page.waitForResponse((response) => new URL(response.url()).pathname === "/v1/templates/assist");
    await assistant.getByRole("button", { name: "Send", exact: true }).click();
    const proposed = await proposal;
    expect(proposed.status()).toBe(200);
    expect(proposed.headers()["cache-control"]).toContain("no-store");
    await expect(assistant.getByText("Add VAT rate", { exact: true })).toBeVisible();
    await expect(assistant.getByText(/vat_rate/).first()).toBeVisible();
    expect(await readSaved()).toEqual(original);
    expect((await page.locator(".field-detail").boundingBox())!.width).toBeGreaterThan(250);
    await page.screenshot({ path: testInfo.outputPath("assistant-proposal-review.png"), fullPage: true });
    await page.setViewportSize({ width: 1600, height: 1000 });
    expect((await page.locator(".field-detail").boundingBox())!.width).toBeGreaterThan(250);
    await page.screenshot({ path: testInfo.outputPath("assistant-proposal-review-wide.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await assistant.getByRole("button", { name: "Apply 1 change to draft", exact: true }).click();
    await expect(page.getByText("6 fields · Unsaved changes", { exact: true })).toBeVisible();
    await expect(assistant.getByRole("button", { name: "Apply 1 change to draft", exact: true })).toBeHidden();
    expect(await readSaved()).toEqual(original);
    await assistant.getByRole("button", { name: "Close assistant", exact: true }).click();
    await page.locator(".ui-page-header").getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "View JSON" }).click();
    const jsonDialog = page.getByRole("dialog", { name: "Export or import JSON" });

    const draft = JSON.parse(
      await jsonDialog.getByRole("textbox", { name: "Template JSON", exact: true }).inputValue(),
    );

    expect(draft.fields.slice(0, 5)).toEqual(
      original.fields
        .slice(0, 5)
        .map(({ name, description, data_type }: { name: string; description: string; data_type: string }) => ({
          name,
          description,
          data_type,
        })),
    );
    expect(draft.fields[5].object_schema.columns.map((column: { heading: string }) => column.heading)).toEqual([
      "Line Number",
      "Description",
      "Quantity",
      "Unit Price",
      "Line Total",
      "VAT Rate",
    ]);
    await jsonDialog.getByRole("button", { name: "Cancel", exact: true }).click();

    const save = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/v1/templates/${templateId}` && response.request().method() === "PATCH",
    );

    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    expect((await save).status()).toBe(200);
    const saved = await readSaved();
    expect(saved.current_version).toBe(original.current_version + 1);
    expect(saved.fields.slice(0, 5)).toEqual(original.fields.slice(0, 5));
    expect(saved.fields[5].description).toContain('"key":"vat_rate"');
    await expect(page.getByText("6 fields · All changes saved", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("assistant-saved-template.png"), fullPage: true });
  } finally {
    await page.close();
    await harness.stop();
  }
});
