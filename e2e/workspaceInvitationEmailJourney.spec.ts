import { expect, test, type Page } from "@playwright/test";

import { signUpAndVerify, type BrowserAccount } from "./support/journeyHelpers";
import { startRuntimeHarness, type RuntimeHarness } from "./support/runtimeHarnessClient";

const OWNER = { email: "invitation-owner@example.test", name: "Invitation Owner", password: "Strong1!" };

const INVITEE = { email: "invitation-guest@example.test", name: "Invitation Guest", password: "Strong1!" };

// The harness makes this address an installation admin, who can sign up when sign-up is invite-only.
const ADMIN = { email: "browser-admin@example.test", name: "Browser Admin", password: "Strong1!" };

test("an invitation's link is shared and resent, and the emailed link leads through sign-up to it", async ({
  browser,
}) => {
  test.setTimeout(150_000);

  let harness: RuntimeHarness | undefined;
  const ownerContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const inviteeContext = await browser.newContext();

  try {
    harness = await startRuntimeHarness({ requireEmailVerification: true });
    const owner = await ownerContext.newPage();
    await signUpAndVerify(owner, harness, OWNER);

    await invite(owner, INVITEE.email);
    const link = owner.getByRole("textbox", { name: `Invite link for ${INVITEE.email}` });
    const sharedUrl = await link.inputValue();
    // The inviter's copy never says whether the address has an account.
    expect(new URL(sharedUrl).pathname).toMatch(/^\/invitations\/[^/]+$/);
    expect(new URL(sharedUrl).searchParams.get("email")).toBe(INVITEE.email);
    expect(new URL(sharedUrl).searchParams.has("auth")).toBe(false);

    await owner.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(owner.getByText("Invite link copied")).toBeVisible();
    expect(await owner.evaluate(() => navigator.clipboard.readText())).toBe(sharedUrl);

    // The first email starts the resend cooldown, and the row says when it ends.
    const row = owner.getByRole("row").filter({ hasText: INVITEE.email });
    const resend = row.getByRole("button", { name: `Resend email to ${INVITEE.email}`, exact: true });
    await expect(row).toContainText("Resend from");
    await expect(resend).toBeDisabled();

    await harness.endInvitationEmailCooldown();
    await owner.reload();
    await expect(resend).toBeEnabled();
    await resend.click();
    await expect(
      owner.getByText(`Invitation renewed for ${INVITEE.email}. This setup doesn't send email, so share the invite link.`),
    ).toBeVisible();
    await expect(row).toContainText("Resend from");
    await expect(resend).toBeDisabled();

    await row.getByRole("button", { name: `Copy link for ${INVITEE.email}`, exact: true }).click();
    expect(await owner.evaluate(() => navigator.clipboard.readText())).toBe(sharedUrl);

    // Signed in as someone else, the link explains rather than failing.
    await owner.goto(sharedUrl);
    await expect(owner.getByRole("heading", { name: "Invitation for another email" })).toBeVisible();

    const emailed = await harness.waitForInvitationMail(INVITEE.email);
    expect(new URL(emailed.actionUrl).searchParams.get("auth")).toBe("signup");

    const invitee = await inviteeContext.newPage();
    await invitee.goto(emailed.actionUrl);
    await expect(invitee.getByRole("heading", { name: "Create account" })).toBeVisible();
    await expect(invitee.getByLabel("Email")).toHaveValue(INVITEE.email);
    await expect(invitee.getByText(`Create an account with ${INVITEE.email} to accept it.`)).toBeVisible();

    await completeSignUp(invitee, INVITEE);
    await expect(invitee.getByText("Check your email")).toBeVisible();
    await invitee.goto((await harness.waitForVerificationMail(INVITEE.email)).actionUrl);

    await expect(invitee.getByRole("heading", { name: "Pending invitation" })).toBeVisible();
    expect(new URL(invitee.url()).pathname).toBe(new URL(sharedUrl).pathname);
    await invitee.getByRole("button", { name: "Accept invitation" }).click();
    await expect(invitee.getByText("Invitation accepted")).toBeVisible();
  } finally {
    await ownerContext.close();
    await inviteeContext.close();
    await harness?.stop();
  }
});

test("with invite-only sign-up, the emailed link lands in the workspace that accepted the new account", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  let harness: RuntimeHarness | undefined;
  const adminContext = await browser.newContext();
  const inviteeContext = await browser.newContext();

  try {
    harness = await startRuntimeHarness({ requireEmailVerification: true, signupEnabled: false });
    const admin = await adminContext.newPage();
    await signUpAndVerify(admin, harness, ADMIN);
    const workspaceName = await admin.getByLabel("Workspace name").inputValue();
    await invite(admin, INVITEE.email);

    const invitee = await inviteeContext.newPage();
    await invitee.goto((await harness.waitForInvitationMail(INVITEE.email)).actionUrl);
    await expect(invitee.getByLabel("Email")).toHaveValue(INVITEE.email);
    await completeSignUp(invitee, INVITEE);
    await expect(invitee.getByText("Check your email")).toBeVisible();
    await invitee.goto((await harness.waitForVerificationMail(INVITEE.email)).actionUrl);

    await expect(invitee.getByRole("heading", { name: "Workspace details" })).toBeVisible();
    await expect(invitee.getByLabel("Workspace name")).toHaveValue(workspaceName);
    expect(new URL(invitee.url()).pathname).toMatch(/^\/workspaces\/[^/]+$/);
    await expect(invitee.getByText(/unavailable/)).toHaveCount(0);
  } finally {
    await adminContext.close();
    await inviteeContext.close();
    await harness?.stop();
  }
});

async function invite(page: Page, email: string) {
  const inviteEmail = page.getByLabel("Invite email", { exact: true });

  if (!(await inviteEmail.count())) await page.getByRole("button", { name: "Invite user", exact: true }).click();
  await inviteEmail.fill(email);
  await page.getByRole("button", { name: "Invite user", exact: true }).click();
  await expect(page.getByText(`Invitation created for ${email}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: `Invite link for ${email}` })).toBeVisible();
}

// The invite link has already filled in the address.
async function completeSignUp(page: Page, account: BrowserAccount) {
  await page.getByLabel("Name").fill(account.name);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByLabel("Confirm password").fill(account.password);
  await page.getByRole("button", { name: "Create account" }).click();
}
