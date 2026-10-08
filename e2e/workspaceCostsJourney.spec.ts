import { expect, test } from "@playwright/test";
import { startRuntimeHarness } from "./support/runtimeHarnessClient";
import { ONE_PIXEL_PNG, saveModelGateway, submitSignUp } from "./support/journeyHelpers";

test("Workspace costs report processing spend and retain deleted documents through navigation and refresh", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const harness = await startRuntimeHarness({ requireEmailVerification: false });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    await submitSignUp(page, harness, { name: "Cost Owner", email: "cost-owner@example.test", password: "Strong1!" });
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    const tour = page.getByRole("complementary", { name: "Welcome tour" });

    if (await tour.isVisible()) await tour.getByRole("button", { name: "Dismiss tour" }).click();
    await saveModelGateway(page, harness, "browser/cost-dashboard");
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

    for (let i = 0; i < 3; i++) {
      const response = await page.request.post(`${harness.origin}/v1/extract`, {
        headers,
        multipart: {
          template_id: templateId,
          document: { name: `cost-invoice-${i}.png`, mimeType: "image/png", buffer: ONE_PIXEL_PNG },
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
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
    const api = `${harness.origin}/v1/workspaces/${workspace}/costs`;
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${api}/overview?start=${today}&end=${tomorrow}&unit=day`)).json()).totals
            .fullyCostedDocuments,
      )
      .toBe(3);
    await page.getByRole("button", { name: "Costs", exact: true }).click();
    await expect(page).toHaveURL(`${harness.origin}/workspaces/${workspace}/costs`);
    await expect(page.getByLabel("Headline figures")).toContainText("$0.0370");
    await page.getByRole("radio", { name: "12M", exact: true }).click();
    await expect(page.getByLabel("Headline figures")).toContainText("$0.0370");
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.screenshot({ path: testInfo.outputPath("costs-overview.png"), fullPage: true });
    await page.getByRole("radio", { name: "Table", exact: true }).click();
    await expect(page.getByRole("table").first()).toContainText("Extraction");
    await page.getByRole("tab", { name: "Documents", exact: true }).click();
    await expect(page).toHaveURL(`${harness.origin}/workspaces/${workspace}/costs/documents`);
    await expect(page.getByRole("button", { name: /cost-invoice-0.png/ })).toBeVisible();
    const deleted = await page.request.delete(`${harness.origin}/v1/jobs/${jobs[0]}`, { headers });
    expect(deleted.ok()).toBe(true);
    await expect
      .poll(async () => (await (await page.request.get(`${api}/documents/${jobs[0]}`)).json()).deleted)
      .toBe(true);
    await page.reload();
    await page.getByRole("searchbox", { name: "Search documents" }).fill("cost-invoice-0");
    await expect(page.getByRole("button", { name: /cost-invoice-\d.png/ })).toHaveCount(1);
    await page.getByRole("button", { name: /cost-invoice-0.png/ }).click();
    await expect(page.getByRole("region", { name: "cost-invoice-0.png cost" })).toContainText("Deleted");
    await expect(page.getByRole("region", { name: "cost-invoice-0.png cost" })).toContainText("$0.0123");
    await page.screenshot({ path: testInfo.outputPath("costs-deleted-document.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath("costs-mobile.png"), fullPage: true });
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link").first().click();
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await harness.stop();
  }
});
