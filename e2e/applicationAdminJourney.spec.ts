import { expect, test, type Page } from "@playwright/test";
import { access } from "node:fs/promises";

import { signUpAndVerify } from "./support/journeyHelpers";
import { startRuntimeHarness } from "./support/runtimeHarnessClient";

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
  let harness: Awaited<ReturnType<typeof startRuntimeHarness>> | undefined;
  const regularContext = await browser.newContext();
  const regularPage = await regularContext.newPage();

  try {
    harness = await startRuntimeHarness();
    await signUpAndVerify(regularPage, harness, REGULAR_USER);
    await regularContext.close();

    await signUpAndVerify(adminPage, harness, ADMIN);
    const navigation = adminPage.getByRole("navigation", { name: "Main navigation" });
    await navigation.getByRole("button", { name: "Admin" }).click();
    await expect(adminPage.getByRole("heading", { name: "Application Admin" })).toBeVisible();

    await adminPage.getByLabel("Search users").fill(REGULAR_USER.email);
    await adminPage.getByRole("button", { name: "Search", exact: true }).click();
    await expect(managedUserRow(adminPage)).toBeVisible();
    await expect(managedUserRow(adminPage)).toContainText("Regular User");
    await expect(managedUserRow(adminPage)).toContainText("Active");

    adminPage.once("dialog", (dialog) => dialog.accept());
    await chooseUserAction(adminPage, "Make admin");
    await expect(managedUserRow(adminPage)).toContainText("Application Admin");

    adminPage.once("dialog", (dialog) => dialog.accept());
    await chooseUserAction(adminPage, "Remove admin");
    await expect(managedUserRow(adminPage)).toContainText("Regular User");

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
    await expect(adminPage.getByRole("heading", { name: "Connection Settings" })).toBeVisible();

    await impersonation.getByRole("button", { name: "Stop impersonating" }).click();
    await expect(adminPage.getByRole("heading", { name: "Application Admin" })).toBeVisible();
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

function managedUserRow(page: Page) {
  return page.getByRole("row").filter({ hasText: REGULAR_USER.email });
}

async function chooseUserAction(page: Page, action: string): Promise<void> {
  const trigger = managedUserRow(page).getByRole("button", {
    name: `User actions for ${REGULAR_USER.email}`,
  });
  await trigger.evaluate((button, actionLabel) => new Promise<void>((resolve, reject) => {
    (button as HTMLElement).click();
    requestAnimationFrame(() => {
      const menuItem = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
        .find((candidate) => candidate.textContent?.trim() === actionLabel);
      if (!menuItem) {
        reject(new Error(`User action ${actionLabel} did not open`));
        return;
      }
      menuItem.click();
      resolve();
    });
  }), action);
}
