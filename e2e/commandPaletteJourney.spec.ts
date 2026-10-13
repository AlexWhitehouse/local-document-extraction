import { expect, test } from "@playwright/test";

import { ONE_PIXEL_PNG, saveModelGateway, submitSignUp } from "./support/journeyHelpers";
import { startRuntimeHarness } from "./support/runtimeHarnessClient";

test("the command palette searches extracted values, exports and deletes results, and runs actions", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const harness = await startRuntimeHarness({ requireEmailVerification: false });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    await submitSignUp(page, harness, { name: "Palette User", email: "palette@example.test", password: "Strong1!" });
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    const tour = page.getByRole("complementary", { name: "Welcome tour" });

    if (await tour.isVisible()) await tour.getByRole("button", { name: "Dismiss tour" }).click();
    await saveModelGateway(page, harness, "browser/model");
    const workspace = new URL(page.url()).pathname.split("/")[2]!;
    const headers = { "x-workspace-id": workspace, origin: harness.origin };

    const created = await page.request.post(`${harness.origin}/v1/templates`, {
      headers,
      data: {
        name: "Invoice",
        fields: [{ name: "Invoice Number", description: "Invoice identifier", data_type: "string" }],
      },
    });

    expect(created.ok()).toBe(true);
    const templateId = (await created.json()).template_id;
    const jobs: string[] = [];

    for (const name of ["palette-a.png", "palette-b.png"]) {
      const response = await page.request.post(`${harness.origin}/v1/extract`, {
        headers,
        multipart: {
          template_id: templateId,
          document: { name, mimeType: "image/png", buffer: ONE_PIXEL_PNG },
        },
      });

      expect(response.status()).toBe(202);
      jobs.push((await response.json()).job_id);
    }

    for (const id of jobs)
      await expect
        .poll(
          async () => (await (await page.request.get(`${harness.origin}/v1/jobs/${id}`, { headers })).json()).status,
        )
        .toBe("completed");

    // The sidebar button opens the palette and Esc closes it, returning focus to the button.
    const searchButton = page.getByRole("button", { name: "Search", exact: true });
    await searchButton.click();
    const palette = page.getByRole("dialog", { name: "Search and actions" });
    const input = palette.getByRole("combobox", { name: "Search or ask" });
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await expect(searchButton).toBeFocused();

    // Local matches appear as you type, before Enter.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(input).toBeFocused();
    await input.fill("export");
    await expect(palette.getByRole("option", { name: /Export documents/ })).toBeVisible();

    // A fully recognised sentence becomes pills and is answered from the index without a model call.
    let interpreted = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/v1/search/interpret") interpreted += 1;
    });

    await input.fill('Find invoices where the invoice number starts with "inv-e2e"');
    await input.press("Enter");
    const request = palette.getByRole("combobox", { name: "Your request" });
    await expect(request.getByText("starts with", { exact: false })).toBeVisible();
    await expect(palette.locator("strong", { hasText: /^2 documents$/ })).toBeVisible();
    await expect(palette.getByRole("option", { name: /palette-a\.png/ })).toBeVisible();
    await expect(palette.getByRole("option", { name: /palette-b\.png/ })).toBeVisible();
    await expect(palette.locator("mark").first()).toHaveText(/INV-E2E/i);
    expect(interpreted).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("palette-search.png") });

    // Export the results as CSV inside the palette.
    await palette.getByRole("button", { name: "Export 2", exact: true }).click();
    await palette.getByRole("radio", { name: "CSV", exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await palette.getByRole("button", { name: "Export 2 documents", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    await expect(page.getByText("Exported 2 documents", { exact: true })).toBeVisible();
    await expect(palette).toBeHidden();

    // A sentence with unknown words is interpreted once by the assistant model; unused words are flagged.
    await page.keyboard.press("ControlOrMeta+k");
    await input.fill("Find invoices billed to Leeds");

    const interpretation = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/v1/search/interpret",
    );

    await input.press("Enter");
    expect((await interpretation).status()).toBe(200);
    await expect(palette.getByRole("option", { name: /palette-a\.png/ })).toBeVisible();

    // Esc steps back once at a time: pills, then text, then close.
    await page.keyboard.press("Escape");
    await expect(input).toHaveValue("Find invoices billed to Leeds");
    await page.keyboard.press("Escape");
    await expect(input).toHaveValue("");
    await expect(palette).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();

    // Delete stops at a confirmation inside the palette with Cancel focused.
    await page.keyboard.press("ControlOrMeta+k");
    await input.fill('Find invoices where the invoice number starts with "inv"');
    await input.press("Enter");
    await expect(palette.locator("strong", { hasText: /^2 documents$/ })).toBeVisible();
    await palette.getByRole("button", { name: "Delete…", exact: true }).click();
    await expect(palette.getByRole("heading", { name: "Delete 2 documents?" })).toBeVisible();
    await expect(palette.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("palette-delete.png") });
    await palette.getByRole("button", { name: "Delete 2 documents", exact: true }).click();
    await expect(page.getByText("Deleted 2 documents", { exact: true })).toBeVisible();
    await expect(palette).toBeHidden();

    for (const id of jobs)
      expect((await page.request.get(`${harness.origin}/v1/jobs/${id}`, { headers })).status()).toBe(404);

    // Go to page actions run straight away.
    await page.keyboard.press("ControlOrMeta+k");
    await input.fill("Go to costs");
    await input.press("Enter");
    await expect(page).toHaveURL(`${harness.origin}/workspaces/${workspace}/costs`);
    await expect(palette).toBeHidden();
    await expect(page.getByText(/^Search:/)).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await harness.stop();
  }
});

test("the command palette proposes a template change with the assistant and saves it as a new version", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const harness = await startRuntimeHarness();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    await submitSignUp(page, harness, { name: "Palette Editor", email: "palette-editor@example.test", password: "Strong1!" });
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    await saveModelGateway(page, harness, "browser/template-assistant");
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /Templates/ }).click();
    await page.getByRole("button", { name: "Create template", exact: true }).click();
    await page.getByLabel("Template name", { exact: true }).fill("VAT invoice");

    const creation = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/v1/templates" && response.request().method() === "POST",
    );

    await page.getByRole("button", { name: "Save new template", exact: true }).click();
    const created = await creation;
    expect(created.status()).toBe(201);
    const { template_id: templateId } = await created.json();
    const headers = { "x-workspace-id": created.request().headers()["x-workspace-id"]! };

    for (const close of await page.getByRole("button", { name: "Close toast" }).all()) await close.click();

    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Search and actions" });
    const input = palette.getByRole("combobox", { name: "Search or ask" });
    await input.fill("Edit the VAT invoice template to add VAT rate to each line item");
    const proposal = page.waitForResponse((response) => new URL(response.url()).pathname === "/v1/templates/assist");
    await input.press("Enter");
    expect((await proposal).status()).toBe(200);
    await expect(palette.getByText("Proposed changes", { exact: true })).toBeVisible();
    await expect(palette.getByText("Add VAT rate", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("palette-edit-template.png") });

    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/v1/templates/${templateId}` && response.request().method() === "PATCH",
    );

    await palette.getByRole("button", { name: "Save 1 change as v2", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByText("Template saved: VAT invoice", { exact: true })).toBeVisible();
    await expect(palette).toBeHidden();
    const template = await (await page.request.get(`${harness.origin}/v1/templates/${templateId}`, { headers })).json();
    expect(template.version ?? template.current_version).toBe(2);
    expect(JSON.stringify(template.fields)).toContain("VAT Rate");
    expect(errors).toEqual([]);
  } finally {
    await harness.stop();
  }
});
