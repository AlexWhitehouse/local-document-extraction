import { expect, test, type Locator, type Page } from "@playwright/test";
import { chooseMoreAction, confirmInAppDialog, ONE_PIXEL_PNG, saveModelGateway, submitSignUp } from "./support/journeyHelpers";
import { startRuntimeHarness } from "./support/runtimeHarnessClient";

const template = {
  name: "Tagged invoice",
  description: "Invoices with an invoice number and amount due.",
  tags: ["finance"],
  fields: [{ id: "invoice_number", name: "Invoice Number", description: "Invoice reference", data_type: "string" }],
};

function pdfFixture(blank = false, pageCount = 3) {
  const pageRefs = Array.from({ length: pageCount }, (_, index) => `${index * 2 + 3} 0 R`).join(" ");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pageRefs}] /Count ${pageCount} >>`];

  for (let index = 1; index <= pageCount; index += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 240] /Resources << /Font << /F1 ${pageCount * 2 + 3} 0 R >> >> /Contents ${index * 2 + 2} 0 R >>`,
    );
    const content = blank ? "" : `BT /F1 14 Tf 15 200 Td (Invoice ${index}) Tj ET`;
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }

  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${start}\n%%EOF\n`;

  return Buffer.from(pdf);
}

test("tag routing, split review, page preview and all-blank completion work through the browser", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const harness = await startRuntimeHarness({ sourceStorage: "local" });

  try {
    await submitSignUp(page, harness, {
      name: "Processing Editor",
      email: "processing@example.test",
      password: "Strong1!",
    });
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    await saveModelGateway(page, harness, "browser/model");
    const model = page.getByRole("article", { name: "Model gateway" });
    await model.getByRole("button", { name: "Edit", exact: true }).click();
    await model.getByLabel("Document classification & splitting model source").selectOption("custom");
    await model
      .getByLabel("Document classification & splitting model", { exact: true })
      .fill("browser/document-classifier");
    await model.getByRole("checkbox", { name: "Document classification & splitting: Direct PDF input" }).check();
    await model.getByRole("button", { name: "Save configuration", exact: true }).click();
    await expect(model.getByText("browser/document-classifier", { exact: true })).toBeVisible();

    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await navigation.getByRole("link", { name: /Templates/ }).click();
    await page.getByRole("button", { name: "Create template", exact: true }).click();
    await page.locator(".ui-page-header").getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "View JSON" }).click();
    const json = page.getByRole("dialog", { name: "Export or import JSON" });
    await json.getByRole("textbox", { name: "Template JSON", exact: true }).fill(JSON.stringify(template));

    const createdPromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/v1/templates" && response.request().method() === "POST",
    );

    await json.getByRole("button", { name: "Save JSON", exact: true }).click();
    const created = await createdPromise;
    expect(created.status()).toBe(201);
    const headers = { "x-workspace-id": created.request().headers()["x-workspace-id"]! };
    const templateId = (await created.json()).template_id;

    async function openUpload() {
      const trigger = page.getByRole("button", { name: "Upload documents", exact: true }).first();
      await expect(trigger).toBeEnabled();
      await trigger.click();
      await expect(page.getByRole("dialog", { name: "Upload documents", exact: true })).toBeVisible();

      return page.getByRole("dialog", { name: "Upload documents", exact: true });
    }

    let upload = await openUpload();
    await upload.getByRole("combobox", { name: "Template", exact: true }).selectOption("automatic");
    await upload
      .locator('input[type="file"]')
      .setInputFiles({ name: "invoice.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
    await expect(upload.getByRole("button", { name: "Upload documents", exact: true })).toBeDisabled();
    await upload.getByRole("checkbox", { name: "finance", exact: true }).check();
    await upload.screenshot({ path: testInfo.outputPath("upload-tag-picker.png") });
    await upload.getByRole("button", { name: "Upload documents", exact: true }).click();
    await expect(upload.getByText("Queued", { exact: true })).toBeVisible();
    await closeQueuedUpload(page, upload);
    await expect(page.getByText("Tagged invoice · version 1 · selected automatically", { exact: true })).toBeVisible();
    await expect(page.getByText("INV-E2E-001", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("automatic-template-selection.png"), fullPage: true });

    // A valid unknown tag cannot broaden the pool; resolve the held document without uploading again.
    const unknown = await page.request.post(`${harness.origin}/v1/extract`, {
      headers,
      multipart: {
        template_tags: JSON.stringify(["unmatched"]),
        document: { name: "unknown.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
      },
    });

    expect(unknown.status()).toBe(202);
    const unknownId = (await unknown.json()).job_id;
    await expect(
      page
        .getByRole("region", { name: "Document list", exact: true })
        .locator("a.context-item-main")
        .filter({ hasText: unknownId }),
    ).toBeVisible();
    await page
      .getByRole("region", { name: "Document list", exact: true })
      .locator("a.context-item-main")
      .filter({ hasText: unknownId })
      .click();
    await expect(page.getByRole("heading", { name: "Choose a template to continue" })).toBeVisible();
    await page.getByRole("combobox", { name: "Template for this document", exact: true }).selectOption(templateId);
    await page.getByRole("button", { name: "Use template and continue", exact: true }).click();
    await expect(page.getByText("INV-E2E-001", { exact: true })).toBeVisible();

    await navigation.getByRole("link", { name: /Workspaces/ }).click();
    const settings = page.getByRole("region", { name: "Document processing", exact: true });
    await settings.getByRole("checkbox", { name: "Enable smart splitting" }).click();
    await expect(settings.getByRole("checkbox", { name: "Enable smart splitting" })).toBeChecked();
    await model.getByRole("button", { name: "Edit", exact: true }).click();
    await model.getByLabel("Document classification & splitting model", { exact: true }).fill("browser/split-review");
    await model.getByRole("button", { name: "Save configuration", exact: true }).click();
    await expect(model.getByText("browser/split-review", { exact: true })).toBeVisible();
    upload = await openUpload();
    await upload.getByRole("combobox", { name: "Template", exact: true }).selectOption(templateId);
    await upload
      .locator('input[type="file"]')
      .setInputFiles({ name: "packet.pdf", mimeType: "application/pdf", buffer: await pdfFixture() });

    const queuedPromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/v1/extract" && response.request().method() === "POST",
    );

    await upload.getByRole("button", { name: "Upload documents", exact: true }).click();
    const queued = await queuedPromise;
    expect(queued.status()).toBe(202);
    const packetId = (await queued.json()).packet_id;
    await expect(upload.getByText("Queued", { exact: true })).toBeVisible();
    await closeQueuedUpload(page, upload);
    await expect(page.getByRole("heading", { name: "Review document boundaries" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByAltText("Original page 1")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("split-review-original-pages.png"), fullPage: true });
    await page.getByRole("button", { name: "Confirm plan and extract", exact: true }).click();
    await expect(page.getByRole("region", { name: "Documents in this packet" })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath("packet-overview.png"), fullPage: true });
    await page.getByRole("tab", { name: /Document 1/ }).click();
    await expect(page.getByText("INV-E2E-001", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/packets/${packetId}/documents/[^/]+$`));
    await page.reload();
    await expect(page.getByText("INV-E2E-001", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("packet-document-tab.png"), fullPage: true });
    await page.getByRole("tab", { name: /^Overview/ }).click();
    await chooseMoreAction(page, /^Delete/);
    await confirmInAppDialog(page, /^Delete/, "Delete packet");
    await expect
      .poll(async () => (await page.request.get(`${harness.origin}/v1/packets/${packetId}`, { headers })).status())
      .toBe(404);

    await navigation.getByRole("link", { name: /Workspaces/ }).click();
    await settings.getByRole("checkbox", { name: "Exclude blank pages" }).click();
    await expect(settings.getByRole("checkbox", { name: "Exclude blank pages" })).toBeChecked();
    await model.getByRole("button", { name: "Edit", exact: true }).click();
    await model.getByLabel("Document classification & splitting model", { exact: true }).fill("browser/split-blank");
    await model.getByRole("button", { name: "Save configuration", exact: true }).click();
    await expect(model.getByText("browser/split-blank", { exact: true })).toBeVisible();
    upload = await openUpload();
    await upload.getByRole("combobox", { name: "Template", exact: true }).selectOption(templateId);
    await upload
      .locator('input[type="file"]')
      .setInputFiles({ name: "blank.pdf", mimeType: "application/pdf", buffer: await pdfFixture(true) });
    await upload.getByRole("button", { name: "Upload documents", exact: true }).click();
    await expect(upload.getByText("Queued", { exact: true })).toBeVisible();
    await closeQueuedUpload(page, upload);
    await expect(page.getByRole("heading", { name: "No documents to extract", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("region", { name: "Excluded pages" }).getByRole("row", { name: "3 Verified blank page" }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("all-blank-completion.png"), fullPage: true });
  } finally {
    await page.close();
    await harness.stop();
  }
});

test("single-page uploads and one-document split plans display as ordinary documents", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const harness = await startRuntimeHarness({ sourceStorage: "local" });

  try {
    await submitSignUp(page, harness, {
      name: "Single Document Editor",
      email: "single-document@example.test",
      password: "Strong1!",
    });
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    await saveModelGateway(page, harness, "browser/model");
    const model = page.getByRole("article", { name: "Model gateway" });
    await model.getByRole("button", { name: "Edit", exact: true }).click();
    await model.getByLabel("Document classification & splitting model source").selectOption("custom");
    await model.getByLabel("Document classification & splitting model", { exact: true }).fill("browser/split-single");
    await model.getByRole("checkbox", { name: "Document classification & splitting: Direct PDF input" }).check();
    await model.getByRole("button", { name: "Save configuration", exact: true }).click();
    await expect(model.getByText("browser/split-single", { exact: true })).toBeVisible();
    const settings = page.getByRole("region", { name: "Document processing", exact: true });
    await settings.getByRole("checkbox", { name: "Enable smart splitting" }).click();
    await expect(settings.getByRole("checkbox", { name: "Enable smart splitting" })).toBeChecked();

    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await navigation.getByRole("link", { name: /Templates/ }).click();
    await page.getByRole("button", { name: "Create template", exact: true }).click();
    await page.locator(".ui-page-header").getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "View JSON" }).click();
    const json = page.getByRole("dialog", { name: "Export or import JSON" });
    await json.getByRole("textbox", { name: "Template JSON", exact: true }).fill(JSON.stringify(template));

    const createdPromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/v1/templates" && response.request().method() === "POST",
    );

    await json.getByRole("button", { name: "Save JSON", exact: true }).click();
    const created = await createdPromise;
    expect(created.status()).toBe(201);
    const headers = { "x-workspace-id": created.request().headers()["x-workspace-id"]! };
    const templateId = (await created.json()).template_id;

    for (const pageCount of [1, 3]) {
      const sourceName = `single-document-${pageCount}-pages.pdf`;
      await page.getByRole("button", { name: "Upload documents", exact: true }).first().click();
      const upload = page.getByRole("dialog", { name: "Upload documents", exact: true });
      await upload.getByRole("combobox", { name: "Template", exact: true }).selectOption(templateId);
      await upload
        .locator('input[type="file"]')
        .setInputFiles({ name: sourceName, mimeType: "application/pdf", buffer: pdfFixture(false, pageCount) });

      const queuedPromise = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/v1/extract" && response.request().method() === "POST",
      );

      await upload.getByRole("button", { name: "Upload documents", exact: true }).click();
      const queued = await queuedPromise;
      expect(queued.status()).toBe(202);
      const admission = await queued.json();

      if (pageCount === 1) {
        expect(admission.job_id).toBeTruthy();
        expect(admission).not.toHaveProperty("packet_id");
      } else expect(admission.packet_id).toBeTruthy();
      await expect(upload.getByText("Queued", { exact: true })).toBeVisible();
      await closeQueuedUpload(page, upload);

      await expect(page.getByRole("region", { name: "Document results", exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("INV-E2E-001", { exact: true })).toBeVisible();
      await expect(page.getByText("Tagged invoice · version 1", { exact: true })).toBeVisible();
      await expect(page.getByRole("tab", { name: /^Overview/ })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Documents in this packet" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "View parent packet", exact: true })).toHaveCount(0);
      let documentId = admission.job_id;

      if (pageCount > 1) {
        const packet = await (
          await page.request.get(`${harness.origin}/v1/packets/${admission.packet_id}`, { headers })
        ).json();

        expect(packet.children).toHaveLength(1);
        documentId = packet.children[0].job_id;
      }

      const documentList = page.getByRole("region", { name: "Document list", exact: true });
      const row = documentList.locator("a.context-item-main").filter({ hasText: sourceName });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(documentId);
      await expect(documentList.locator(".context-item-packet")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`single-document-${pageCount}-pages.png`), fullPage: true });

      // Reloading preserves ordinary Document presentation for both submission paths.
      await page.reload();
      await navigation.getByRole("link", { name: /Documents/ }).click();
      await expect(row).toBeVisible();
      await row.click();
      await expect(page.getByText("INV-E2E-001", { exact: true })).toBeVisible();
      await expect(page.getByRole("tab", { name: /^Overview/ })).toHaveCount(0);
      await chooseMoreAction(page, /^Delete/);
      await confirmInAppDialog(page, /^Delete/, /^Delete (document|packet)$/);

      if (pageCount > 1)
        await expect
          .poll(async () =>
            (await page.request.get(`${harness.origin}/v1/packets/${admission.packet_id}`, { headers })).status(),
          )
          .toBe(404);
      await expect
        .poll(async () => (await page.request.get(`${harness.origin}/v1/jobs/${documentId}`, { headers })).status())
        .toBe(404);
      await expect(row).toHaveCount(0);
      await expect(documentList.locator(".context-item-packet")).toHaveCount(0);
    }
  } finally {
    await page.close();
    await harness.stop();
  }
});

// Cancel on a dialog with queued files asks before discarding them.
async function closeQueuedUpload(page: Page, upload: Locator): Promise<void> {
  await upload.getByRole("button", { name: "Cancel", exact: true }).click();
  await confirmInAppDialog(page, "Discard changes?", "Discard");
}
