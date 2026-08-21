import { expect, type Page } from "@playwright/test";

import { startRuntimeHarness } from "./runtimeHarnessClient";

export type BrowserAccount = {
  email: string;
  name: string;
  password: string;
};

type RuntimeHarness = Awaited<ReturnType<typeof startRuntimeHarness>>;

export async function signUpAndVerify(
  page: Page,
  harness: RuntimeHarness,
  account: BrowserAccount,
): Promise<void> {
  await page.goto(harness.origin);
  await page.getByRole("link", { name: "Sign Up" }).click();
  await page.getByLabel("Name").fill(account.name);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByLabel("Confirm Password").fill(account.password);
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Check your email to verify your account",
  );

  const verificationMail = await harness.waitForVerificationMail(account.email);
  await page.goto(verificationMail.actionUrl);
  await expect(page.getByRole("heading", { name: "Connection Settings" })).toBeVisible();
  await expect(page.getByText("API Ready", { exact: true }).first()).toBeVisible();
}

export async function signIn(page: Page, account: BrowserAccount): Promise<void> {
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  const signInResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/sign-in/email" &&
    response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  const response = await signInResponse;
  if (!response.ok()) {
    throw new Error(`Sign in failed (${response.status()}): ${await response.text()}`);
  }
  await expect(page.getByRole("heading", { name: "Connection Settings" })).toBeVisible();
}

export async function signOut(page: Page, account: BrowserAccount): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`${escapeRegExp(account.name)}.*${escapeRegExp(account.email)}`) }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Sign Out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
