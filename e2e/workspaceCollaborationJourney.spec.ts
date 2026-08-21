import { expect, test, type Page } from "@playwright/test";
import { access } from "node:fs/promises";

import { signUpAndVerify } from "./support/journeyHelpers";
import { startRuntimeHarness } from "./support/runtimeHarnessClient";

const OWNER = {
  email: "workspace-owner@example.test",
  name: "Workspace Owner",
  password: "Strong1!",
};

const MEMBER = {
  email: "workspace-member@example.test",
  name: "Workspace Member",
  password: "Strong1!",
};

test("people collaborate through the complete Workspace lifecycle in the frontend", async ({
  browser,
  page: ownerPage,
}) => {
  let harness: Awaited<ReturnType<typeof startRuntimeHarness>> | undefined;
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();

  try {
    harness = await startRuntimeHarness();
    await signUpAndVerify(ownerPage, harness, OWNER);
    await signUpAndVerify(memberPage, harness, MEMBER);

    await ownerPage.getByRole("button", { name: "Create Workspace" }).click();
    await expect(ownerPage.getByText("Workspace created: New Workspace")).toBeVisible();

    const workspaceName = ownerPage.getByLabel("Workspace name");
    await expect(workspaceName).toHaveValue("New Workspace");
    await workspaceName.fill("Shared Research");
    await ownerPage.getByRole("button", { name: "Save Changes" }).click();
    await expect(ownerPage.getByText("Workspace renamed: Shared Research")).toBeVisible();

    const apiKey = ownerPage.getByRole("textbox", { name: /API key/ });
    await ownerPage.getByRole("button", { name: "Generate API Key" }).click();
    await expect(apiKey).not.toHaveValue("");
    const generatedApiKey = await apiKey.inputValue();

    ownerPage.once("dialog", (dialog) => dialog.accept());
    await ownerPage.getByRole("button", { name: "Rotate API Key" }).click();
    await expect(apiKey).not.toHaveValue(generatedApiKey);

    await invite(ownerPage, MEMBER.email);

    await memberPage.reload();
    await selectInvitation(memberPage, "Shared Research");
    await expect(memberPage.getByRole("heading", { name: "Pending Invitation" })).toBeVisible();
    await expect(memberPage.getByText("No workspace access yet")).toBeVisible();
    await memberPage.getByRole("button", { name: "Accept Invitation" }).click();
    await expect(memberPage.getByText("Workspace invitation accepted")).toBeVisible();
    await expect(memberPage.getByLabel("Workspace name")).toHaveValue("Shared Research");

    await ownerPage.reload();
    const memberRow = ownerPage.getByRole("row").filter({ hasText: MEMBER.email });
    await expect(memberRow).toBeVisible();
    await memberRow.getByRole("button", { name: "Edit user" }).click();
    const manageMember = ownerPage.getByRole("dialog", { name: "Manage workspace user" });
    await manageMember.getByRole("button", { name: "Make Admin" }).click();
    await expect(ownerPage.getByText(`Made ${MEMBER.name} an admin`)).toBeVisible();
    await expect(ownerPage.getByRole("row").filter({ hasText: MEMBER.email })).toContainText("Admin");

    await memberPage.reload();
    memberPage.once("dialog", (dialog) => dialog.accept());
    await memberPage.getByRole("button", { name: "Leave Workspace" }).click();
    await expect(memberPage.getByText("Workspace left")).toBeVisible();
    await expect(memberPage.getByLabel("Workspace name")).not.toHaveValue("Shared Research");

    await ownerPage.reload();
    await expect(ownerPage.getByRole("row").filter({ hasText: MEMBER.email })).toHaveCount(0);

    await invite(ownerPage, MEMBER.email);
    await memberPage.reload();
    await selectInvitation(memberPage, "Shared Research");
    await memberPage.getByRole("button", { name: "Decline Invitation" }).click();
    await expect(memberPage.getByText("Invitation declined")).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: "Pending Invitation" })).toHaveCount(0);

    const cancelledEmail = "cancelled-invitation@example.test";
    await invite(ownerPage, cancelledEmail);
    const cancelledRow = ownerPage.getByRole("row").filter({ hasText: cancelledEmail });
    ownerPage.once("dialog", (dialog) => dialog.accept());
    await cancelledRow.getByRole("button", { name: `Cancel invitation for ${cancelledEmail}` }).click();
    await expect(ownerPage.getByText(`Invitation cancelled for ${cancelledEmail}`)).toBeVisible();
    await expect(ownerPage.getByRole("row").filter({ hasText: cancelledEmail })).toHaveCount(0);

    ownerPage.once("dialog", (dialog) => dialog.accept());
    await ownerPage.getByRole("button", { name: "Delete Workspace" }).click();
    await expect(ownerPage.getByText("Workspace deleted")).toBeVisible();
    await expect(ownerPage.getByLabel("Workspace name")).not.toHaveValue("Shared Research");
  } finally {
    await memberContext.close();
    const stateDirectory = harness?.stateDirectory;
    await harness?.stop();
    if (stateDirectory) {
      await expect(access(stateDirectory)).rejects.toThrow();
    }
  }
});

async function invite(page: Page, email: string) {
  await page.getByLabel("Invite email").fill(email);
  await page.getByRole("button", { name: "Invite User" }).click();
  await expect(page.getByText(`Successfully invited ${email}`)).toBeVisible();
}

async function selectInvitation(
  page: Page,
  workspaceName: string,
) {
  await page
    .getByRole("button")
    .filter({ hasText: workspaceName })
    .filter({ hasText: "Invited as Member" })
    .click();
}
