import { expect, test } from "@playwright/test";
import { submitSignUp } from "./support/journeyHelpers";
import { startRuntimeHarness } from "./support/runtimeHarnessClient";

test("manage shared template tags in the frontend without creating field versions", async ({ page }, testInfo) => {
  const harness = await startRuntimeHarness();
  try {
    await submitSignUp(page, harness, { name: "Tag Editor", email: "tag-editor@example.test", password: "Strong1!" });
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Templates/ }).click();
    await page.getByRole("button", { name: "Create Template", exact: true }).click();
    await page.getByLabel("Template name", { exact: true }).fill("Tagged invoice");
    const creation = page.waitForResponse(response => new URL(response.url()).pathname === "/v1/templates" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Save new template", exact: true }).click();
    const created = await creation;
    expect(created.status()).toBe(201);
    const { template_id: firstId } = await created.json();
    const headers = { "x-workspace-id": created.request().headers()["x-workspace-id"] };
    const readTemplate = async (id: string) => {
      const response = await page.request.get(`${harness.origin}/v1/templates/${id}`, { headers });
      expect(response.status()).toBe(200);
      return response.json();
    };
    const readTags = async () => {
      const response = await page.request.get(`${harness.origin}/v1/template-tags`, { headers });
      expect(response.status()).toBe(200);
      return (await response.json()).tags as { id: string; name: string; template_count: number }[];
    };
    const saveChanges = async (id: string) => {
      const response = page.waitForResponse(value => new URL(value.url()).pathname === `/v1/templates/${id}` && value.request().method() === "PATCH");
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      expect((await response).status()).toBe(200);
      await expect(page.getByText("6 fields · All changes saved", { exact: true })).toBeVisible();
    };
    const original = await readTemplate(firstId);
    const descriptionBox = (await page.getByLabel("Description", { exact: true }).boundingBox())!;
    const tagsBox = (await page.getByRole("button", { name: "Template tags", exact: true }).boundingBox())!;
    expect(tagsBox.x).toBeGreaterThan(descriptionBox.x);
    expect(tagsBox.y).toBeLessThan(descriptionBox.y + descriptionBox.height);
    const dropdown = page.getByRole("dialog", { name: "Template tags", exact: true });
    const openTags = async () => {
      await page.getByRole("button", { name: "Template tags", exact: true }).click();
      await expect(dropdown).toBeVisible();
    };
    const closeTags = async () => {
      await page.getByRole("button", { name: "Template tags", exact: true }).click();
      await expect(dropdown).toBeHidden();
    };

    await openTags();
    await dropdown.getByRole("textbox", { name: "Search or create tags", exact: true }).fill("  INVOICE  ");
    await dropdown.getByRole("button", { name: "Create “invoice”", exact: true }).click();
    await expect(dropdown.getByRole("checkbox", { name: "invoice", exact: true })).toBeChecked();
    expect(await readTags()).toEqual([]);
    expect((await readTemplate(firstId)).tags).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("template-tags-dropdown.png"), fullPage: true });
    await closeTags();
    await saveChanges(firstId);
    expect(await readTags()).toMatchObject([{ name: "invoice", template_count: 1 }]);
    expect(await readTemplate(firstId)).toMatchObject({ tags: ["invoice"], current_version: original.current_version, fields: original.fields });

    await page.getByRole("button", { name: "Create Template", exact: true }).click();
    await page.getByLabel("Template name", { exact: true }).fill("Tagged receipt");
    await openTags();
    await dropdown.getByRole("checkbox", { name: "invoice", exact: true }).check();
    await closeTags();
    const secondCreation = page.waitForResponse(response => new URL(response.url()).pathname === "/v1/templates" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Save new template", exact: true }).click();
    const secondCreated = await secondCreation;
    expect(secondCreated.status()).toBe(201);
    const { template_id: secondId } = await secondCreated.json();
    await expect(page.getByText("6 fields · All changes saved", { exact: true })).toBeVisible();
    expect(await readTags()).toMatchObject([{ name: "invoice", template_count: 2 }]);

    // A global rename must preserve unrelated edits in the active draft.
    await page.getByLabel("Description", { exact: true }).fill("An unsaved receipt description");
    await openTags();
    await dropdown.getByRole("button", { name: "Manage tags", exact: true }).click();
    await expect(dropdown.getByText("Manage template tags", { exact: true })).toBeVisible();
    await dropdown.getByRole("button", { name: "Rename invoice", exact: true }).click();
    await dropdown.getByRole("textbox", { name: "New tag name", exact: true }).fill("  FINANCE   DOCS  ");
    await dropdown.getByRole("button", { name: "Save tag name", exact: true }).click();
    await expect(dropdown.getByRole("button", { name: "Rename finance docs", exact: true })).toBeVisible();
    expect(await readTemplate(firstId)).toMatchObject({ tags: ["finance docs"], current_version: original.current_version });
    expect(await readTemplate(secondId)).toMatchObject({ tags: ["finance docs"], current_version: 1 });
    await page.screenshot({ path: testInfo.outputPath("template-tags-management.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dropdown.getByRole("button", { name: "Rename finance docs", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("template-tags-management-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await closeTags();
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue("An unsaved receipt description");
    await saveChanges(secondId);
    expect((await readTemplate(secondId)).current_version).toBe(1);

    await page.getByRole("region", { name: "Template list", exact: true }).getByRole("button", { name: /Tagged invoice/ }).click();
    await expect(page.getByLabel("Template name", { exact: true })).toHaveValue("Tagged invoice");
    await openTags();
    await dropdown.getByRole("checkbox", { name: "finance docs", exact: true }).uncheck();
    await closeTags();
    await saveChanges(firstId);
    expect((await readTemplate(firstId)).tags).toEqual([]);
    expect((await readTemplate(secondId)).tags).toEqual(["finance docs"]);
    expect(await readTags()).toMatchObject([{ name: "finance docs", template_count: 1 }]);

    await openTags();
    await dropdown.getByRole("checkbox", { name: "finance docs", exact: true }).check();
    await closeTags();
    await saveChanges(firstId);
    await openTags();
    await dropdown.getByRole("button", { name: "Manage tags", exact: true }).click();
    page.once("dialog", async dialog => {
      expect(dialog.message()).toContain("2");
      await dialog.accept();
    });
    await dropdown.getByRole("button", { name: "Delete finance docs", exact: true }).click();
    await expect(dropdown.getByRole("button", { name: "Delete finance docs", exact: true })).toBeHidden();
    expect(await readTags()).toEqual([]);
    expect(await readTemplate(firstId)).toMatchObject({ tags: [], current_version: original.current_version, fields: original.fields });
    expect(await readTemplate(secondId)).toMatchObject({ tags: [], current_version: 1 });
    await closeTags();
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();

    // A normal metadata save after deletion must not recreate the deleted tag.
    await page.getByLabel("Description", { exact: true }).fill("After shared tag deletion");
    await saveChanges(firstId);
    expect(await readTags()).toEqual([]);
  } finally {
    await page.close();
    await harness.stop();
  }
});
