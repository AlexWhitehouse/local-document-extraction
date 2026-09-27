import { expect, test } from "@playwright/test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { startRuntimeHarness } from "./support/runtimeHarnessClient";

test("generate a template from a sample, review the draft, then explicitly save", async ({ page }, testInfo) => {
  const harness = await startRuntimeHarness();
  try {
    await page.goto(harness.origin);
    await page.getByRole("link", { name: "Sign Up" }).click();
    await page.getByLabel("Name").fill("Template Designer");
    await page.getByLabel("Email").fill("template-designer@example.test");
    await page.getByLabel("Password", { exact: true }).fill("Strong1!");
    await page.getByLabel("Confirm Password").fill("Strong1!");
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    await page.getByLabel("Gateway URL", { exact: true }).fill(harness.gatewayOrigin);
    await page.getByLabel("Model name", { exact: true }).fill("browser/template-generator");
    await page.getByLabel("Gateway API key", { exact: true }).fill("browser-journey-key");
    await page.getByRole("button", { name: "Save configuration", exact: true }).click();
    await expect(page.getByText("Model gateway saved.", { exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Templates/ }).click();
    await page.getByRole("button", { name: "Create Template" }).click();
    await page.getByLabel("Template name", { exact: true }).fill("Unsaved work");
    await page.getByRole("button", { name: "Auto generate", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Auto generate template" });
    const sample = { name: "Purchase order with a very long document name that should truncate without moving the Pending pill or Remove button.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") };
    await dialog.getByLabel("Sample file").setInputFiles(sample);
    await expect(dialog.getByRole("button", { name: /Drag and drop a sample document/ })).toBeHidden();
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(dialog.getByRole("button", { name: /Drag and drop a sample document/ })).toBeVisible();
    await dialog.getByLabel("Sample file").setInputFiles(sample);
    await expect(dialog.getByRole("button", { name: /Drag and drop a sample document/ })).toBeHidden();
    await dialog.getByLabel("What should this template capture? (optional)").fill("Capture totals and purchased items.");
    await expect(dialog.getByRole("button", { name: "Generate template", exact: true })).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await page.screenshot({ path: testInfo.outputPath("generation-dialog.png"), fullPage: true });
    let releaseGeneration!: () => void;
    const generationGate = new Promise<void>((resolve) => { releaseGeneration = resolve; });
    await page.route("**/v1/templates/generate", async (route) => {
      await generationGate;
      await route.continue();
    });
    const generated = page.waitForResponse((response) => new URL(response.url()).pathname === "/v1/templates/generate");
    await dialog.getByRole("button", { name: "Generate template", exact: true }).click();
    try {
      await expect(dialog.getByText("Combobulating response…", { exact: true })).toBeVisible();
      await expect(dialog.getByText("Consulting the schema sprites…", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath("generation-progress.png"), fullPage: true });
    } finally {
      releaseGeneration();
    }
    const response = await generated;
    expect(response.status()).toBe(200);
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel("Template name", { exact: true })).toHaveValue("Generated Receipt");
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Capture receipt totals and purchases.");
    await expect(page.getByText("2 fields · New template", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("generated-draft.png"), fullPage: true });
    const workspaceId = response.request().headers()["x-workspace-id"];
    const saved = await page.request.get(`${harness.origin}/v1/templates`, { headers: { "x-workspace-id": workspaceId } });
    expect((await saved.json()).templates.some((template: { name: string }) => template.name === "Generated Receipt")).toBe(false);
    expect(await readdir(join(harness.stateDirectory, "temporary", "submissions"))).toEqual([]);
    await page.getByRole("button", { name: "View JSON" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("template-field-actions.png"), fullPage: true });
    await page.getByRole("button", { name: "View JSON" }).click();
    const jsonDialog = page.getByRole("dialog", { name: "Export or import template JSON" });
    const json = JSON.parse(await jsonDialog.getByRole("textbox", { name: "Template JSON", exact: true }).inputValue());
    expect(json.fields[1].object_schema.columns).toHaveLength(2);
    await jsonDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    const creation = page.waitForResponse((response) => new URL(response.url()).pathname === "/v1/templates" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Save new template", exact: true }).click();
    expect((await creation).status()).toBe(201);
    await expect(page.getByText("2 fields · All changes saved", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("create-template-split-button.png"), fullPage: true });
    await page.getByRole("button", { name: "Auto generate new template", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByText("2 fields · All changes saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Auto generate new template", exact: true }).click();
    await dialog.getByLabel("Sample file").setInputFiles(sample);
    await dialog.getByRole("button", { name: "Generate template", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Save new template", exact: true })).toBeVisible();
    const secondCreation = page.waitForResponse((response) => new URL(response.url()).pathname === "/v1/templates" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Save new template", exact: true }).click();
    expect((await secondCreation).status()).toBe(201);

  } finally {
    await page.close();
    await harness.stop();
  }
});
