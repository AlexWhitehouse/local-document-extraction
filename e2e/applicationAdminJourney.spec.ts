import { expect, test, type Page } from "@playwright/test";
import { access } from "node:fs/promises";

import { signUpAndVerify } from "./support/journeyHelpers";
import { startRuntimeHarness, type RuntimeHarness } from "./support/runtimeHarnessClient";

const ADMIN = {
  email: "browser-admin@example.test",
  name: "Browser Admin",
  password: "Strong1!",
};

const REGULAR_USER = {
  email: "admin-managed-user@example.test",
  name: "Managed User",
  password: "Strong1!",
};

test("an Application admin manages account access through the frontend", async ({
  browser,
  page: adminPage,
}) => {
  let harness: RuntimeHarness | undefined;
  const regularContext = await browser.newContext();
  const regularPage = await regularContext.newPage();

  try {
    harness = await startRuntimeHarness({ requireEmailVerification: true });
    await signUpAndVerify(regularPage, harness, REGULAR_USER);
    await regularContext.close();

    await signUpAndVerify(adminPage, harness, ADMIN);
    const navigation = adminPage.getByRole("navigation", { name: "Main navigation" });
    await navigation.getByRole("link", { name: "Admin" }).click();
    await expect(adminPage.getByRole("region", { name: "Account list" })).toBeVisible();

    await adminPage.getByLabel("Search users").fill(REGULAR_USER.email);
    await managedUserListItem(adminPage).click();
    await expect(managedUserRow(adminPage).getByRole("heading", { name: REGULAR_USER.name })).toBeVisible();
    await expect(managedUserRow(adminPage)).toContainText("Regular user");
    await expect(managedUserRow(adminPage)).toContainText("Active");

    adminPage.once("dialog", (dialog) => dialog.accept());
    await chooseUserAction(adminPage, "Make admin");
    await expect(managedUserRow(adminPage)).toContainText("Application admin");

    adminPage.once("dialog", (dialog) => dialog.accept());
    await chooseUserAction(adminPage, "Remove admin");
    await expect(managedUserRow(adminPage)).toContainText("Regular user");

    await chooseUserAction(adminPage, "Ban user");
    const banDialog = adminPage.getByRole("dialog", { name: `Ban ${REGULAR_USER.email}` });
    await banDialog.getByLabel("Ban reason").fill("Repeated access abuse");
    await banDialog.getByRole("button", { name: "Confirm ban" }).click();
    await expect(managedUserRow(adminPage)).toContainText("Banned");
    await expect(managedUserRow(adminPage)).toContainText("Repeated access abuse");

    await chooseUserAction(adminPage, "Unban user");
    const unbanDialog = adminPage.getByRole("dialog", { name: `Unban ${REGULAR_USER.email}` });
    await expect(unbanDialog).toContainText("Repeated access abuse");
    await unbanDialog.getByRole("button", { name: "Confirm unban" }).click();
    await expect(managedUserRow(adminPage)).toContainText("Active");
    await expect(managedUserRow(adminPage)).toContainText("Not banned");

    adminPage.once("dialog", (dialog) => dialog.accept());
    await chooseUserAction(adminPage, "Impersonate user");
    const impersonation = adminPage.getByRole("status", { name: "Impersonation mode" });
    await expect(impersonation).toContainText(`Impersonating ${REGULAR_USER.email}`);
    await expect(adminPage.getByRole("heading", { name: "Workspace details" })).toBeVisible();

    await impersonation.getByRole("button", { name: "Stop impersonating" }).click();
    await expect(adminPage.getByRole("region", { name: "Account list" })).toBeVisible();
    await expect(adminPage.getByText("Impersonation stopped")).toBeVisible();
  } finally {
    if (!regularContext.pages().every((page) => page.isClosed())) {
      await regularContext.close();
    }
    const stateDirectory = harness?.stateDirectory;
    await harness?.stop();
    if (stateDirectory) {
      await expect(access(stateDirectory)).rejects.toThrow();
    }
  }
});

// The selected account's details and actions fill the main pane.
function managedUserRow(page: Page) {
  return page.getByRole("main");
}

function managedUserListItem(page: Page) {
  return page
    .getByRole("region", { name: "Account list" })
    .getByRole("button", { name: new RegExp(`^${REGULAR_USER.name}`) });
}

async function chooseUserAction(page: Page, action: string): Promise<void> {
  await managedUserListItem(page).click();
  await managedUserRow(page).getByRole("button", { name: action, exact: true }).click();
}
