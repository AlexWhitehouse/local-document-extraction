import { expect, test, type Page } from "@playwright/test";
import { access } from "node:fs/promises";

import {
  signIn,
  signOut,
  signUpAndVerify,
} from "./support/journeyHelpers";
import { startRuntimeHarness, type RuntimeHarness } from "./support/runtimeHarnessClient";

const ACCOUNT = {
  email: "account-recovery@example.test",
  name: "Account Recovery",
  password: "Strong1!",
};

test("a user manages local settings and recovers access through the frontend", async ({ page }) => {
  let harness: RuntimeHarness | undefined;

  try {
    harness = await startRuntimeHarness({ requireEmailVerification: true });
    await signUpAndVerify(page, harness, ACCOUNT);
    const updatedAccount = await updateLocalSettings(page);
    await signOut(page, updatedAccount);

    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText(
      `If an account exists for ${ACCOUNT.email}, a reset link has been saved`,
    );

    const resetMail = await harness.waitForPasswordResetMail(ACCOUNT.email);
    await page.goto(resetMail.actionUrl);
    await expect(page.getByRole("heading", { name: "Set new password" })).toBeVisible();

    const newPassword = "Changed2!";
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await signIn(page, { ...ACCOUNT, password: newPassword });
  } finally {
    const stateDirectory = harness?.stateDirectory;
    await harness?.stop();
    if (stateDirectory) {
      await expect(access(stateDirectory)).rejects.toThrow();
    }
  }
});

async function updateLocalSettings(page: Page) {
  const updatedAccount = { ...ACCOUNT, name: "Recovered Account" };
  await page.getByRole("button", { name: new RegExp(ACCOUNT.email) }).click();

  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByLabel("Name").fill(updatedAccount.name);
  await settings.getByRole("button", { name: "Save profile" }).click();
  await expect(settings).toHaveCount(0);
  await expect(page.getByRole("button", { name: new RegExp(updatedAccount.name) })).toBeVisible();

  const gateway = page.getByRole("article", { name: "Workspace Model gateway" });
  await gateway.getByLabel("Gateway URL", { exact: true }).fill("http://127.0.0.1:11434/v1");
  await gateway.getByLabel("Extraction model", { exact: true }).fill("browser/vision-model");
  const apiKey = gateway.getByLabel("Gateway API key", { exact: true });
  await apiKey.fill("local-browser-token");
  await gateway.getByRole("checkbox", { name: /Sequential calls/ }).check();
  await expect(gateway.getByRole("checkbox", { name: "Extraction: Direct PDF input" })).not.toBeChecked();
  await expect(gateway.getByRole("checkbox", { name: "Extraction: Structured output" })).not.toBeChecked();
  await gateway.getByLabel("Template assistant model source").selectOption("custom");
  await gateway.getByLabel("Template assistant model", { exact: true }).fill("browser/assistant-model");
  await gateway.getByRole("button", { name: "Save configuration" }).click();
  await expect(page.getByText("Model gateway saved", { exact: true }).last()).toBeVisible();
  await expect(gateway.getByText("browser/assistant-model", { exact: true })).toBeVisible();
  await gateway.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(apiKey).toHaveValue("");
  await expect(apiKey).toHaveAttribute("placeholder", /Saved/);
  await apiKey.fill("replacement-browser-token");
  await gateway.getByRole("button", { name: "Save configuration" }).click();
  await expect(page.getByText("Model gateway saved", { exact: true }).last()).toBeVisible();
  await gateway.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(apiKey).toHaveValue("");
  await gateway.getByRole("button", { name: "Clear configuration" }).click();
  await gateway.getByRole("button", { name: "Confirm clear" }).click();
  await expect(gateway.getByText("Not configured", { exact: true })).toBeVisible();
  await expect(gateway.getByLabel("Gateway URL", { exact: true })).toHaveValue("");

  return updatedAccount;
}
