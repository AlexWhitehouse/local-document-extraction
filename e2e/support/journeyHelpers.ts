import { expect, type Page } from "@playwright/test";

import type { RuntimeHarness } from "./runtimeHarnessClient";

export type BrowserAccount = {
  email: string;
  name: string;
  password: string;
};

export const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

/** Submits the sign-up form; the caller asserts what happens next. */
export async function submitSignUp(page: Page, harness: RuntimeHarness, account: BrowserAccount): Promise<void> {
  await page.goto(harness.origin);
  await page.getByRole("link", { name: "Sign up" }).click();
  await page.getByLabel("Name").fill(account.name);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByLabel("Confirm Password").fill(account.password);
  await page.getByRole("button", { name: "Create Account" }).click();
}

export async function signUpAndVerify(
  page: Page,
  harness: RuntimeHarness,
  account: BrowserAccount,
): Promise<void> {
  await submitSignUp(page, harness, account);
  await expect(page.getByRole("status")).toContainText(
    "Open your local verification link",
  );

  const verificationMail = await harness.waitForVerificationMail(account.email);
  await page.goto(verificationMail.actionUrl);
  await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
  await expect(page.getByText("API Ready", { exact: true }).first()).toBeVisible();
}

export async function saveModelGateway(page: Page, harness: RuntimeHarness, modelName: string): Promise<void> {
  await page.getByLabel("Gateway URL", { exact: true }).fill(harness.gatewayOrigin);
  await page.getByLabel("Extraction model", { exact: true }).fill(modelName);
  await page.getByLabel("Gateway API key", { exact: true }).fill("browser-journey-key");
  await page.getByRole("button", { name: "Save configuration", exact: true }).click();
  await expect(page.getByText("Model gateway saved.", { exact: true })).toBeVisible();
}

export async function signIn(page: Page, account: BrowserAccount): Promise<void> {
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  const signInResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/sign-in/email" &&
    response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const response = await signInResponse;
  if (!response.ok()) {
    throw new Error(`Sign in failed (${response.status()}): ${await response.text()}`);
  }
  await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
}

export async function signOut(page: Page, account: BrowserAccount): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`${escapeRegExp(account.name)}.*${escapeRegExp(account.email)}`) }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
