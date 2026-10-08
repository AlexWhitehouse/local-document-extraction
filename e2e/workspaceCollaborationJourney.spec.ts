import { expect, test, type Page } from "@playwright/test";
import { access } from "node:fs/promises";

import { chooseMoreAction, confirmInAppDialog, signUpAndVerify } from "./support/journeyHelpers";
import { startRuntimeHarness, type RuntimeHarness } from "./support/runtimeHarnessClient";

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
  test.setTimeout(180_000);

  let harness: RuntimeHarness | undefined;
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();

  try {
    harness = await startRuntimeHarness({ requireEmailVerification: true });
    await signUpAndVerify(ownerPage, harness, OWNER);
    await signUpAndVerify(memberPage, harness, MEMBER);

    await ownerPage.getByRole("button", { name: "Create Workspace" }).click();
    await expect(ownerPage.getByText("Workspace created: New workspace")).toBeVisible();

    const workspaceName = ownerPage.getByLabel("Workspace name");
    await expect(workspaceName).toHaveValue("New workspace");
    await workspaceName.fill("Shared Research");
    await ownerPage.getByRole("button", { name: "Save name" }).click();
    await expect(ownerPage.getByText("Workspace renamed: Shared Research")).toBeVisible();

    const apiKey = ownerPage.getByRole("textbox", { name: "Workspace API key", exact: true });
    await ownerPage.getByRole("button", { name: "Generate API key" }).click();
    await expect(apiKey).not.toHaveValue("");
    const generatedApiKey = await apiKey.inputValue();

    await ownerPage.getByRole("button", { name: "Rotate API key" }).click();
    await confirmInAppDialog(ownerPage, "Rotate the API key?", "Rotate key");
    await expect(apiKey).not.toHaveValue(generatedApiKey);

    await invite(ownerPage, MEMBER.email);

    await memberPage.reload();
    await selectInvitation(memberPage, "Shared Research");
    await expect(memberPage.getByRole("heading", { name: "Pending invitation" })).toBeVisible();
    await expect(memberPage.getByText("No workspace access yet")).toBeVisible();
    await memberPage.getByRole("button", { name: "Accept invitation" }).click();
    await expect(memberPage.getByText("Invitation accepted")).toBeVisible();
    await expect(memberPage.getByLabel("Workspace name")).toHaveValue("Shared Research");

    await ownerPage.reload();
    const memberRow = ownerPage.getByRole("listitem").filter({ hasText: MEMBER.email });
    await expect(memberRow).toBeVisible();
    await memberRow.getByRole("button", { name: `Edit ${MEMBER.name}`, exact: true }).click();
    const manageMember = ownerPage.getByRole("dialog", { name: "Manage user", exact: true });
    await manageMember.getByRole("button", { name: "Make admin" }).click();
    await expect(ownerPage.getByText(/^Member made admin/)).toBeVisible();
    await expect(ownerPage.getByRole("listitem").filter({ hasText: MEMBER.email })).toContainText("Admin");

    await memberPage.reload();
    await chooseMoreAction(memberPage, "Leave workspace");
    await confirmInAppDialog(memberPage, "Leave this workspace?", "Leave workspace");
    await expect(memberPage.getByText("Workspace left")).toBeVisible();
    await expect(memberPage.getByLabel("Workspace name")).not.toHaveValue("Shared Research");

    await ownerPage.reload();
    await expect(ownerPage.getByRole("listitem").filter({ hasText: MEMBER.email })).toHaveCount(0);

    await invite(ownerPage, MEMBER.email);
    await memberPage.reload();
    await selectInvitation(memberPage, "Shared Research");
    await memberPage.getByRole("button", { name: "Decline invitation" }).click();
    await expect(memberPage.getByText("Invitation declined")).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: "Pending invitation" })).toHaveCount(0);

    const cancelledEmail = "cancelled-invitation@example.test";
    await invite(ownerPage, cancelledEmail);
    const cancelledRow = ownerPage.getByRole("row").filter({ hasText: cancelledEmail });
    await cancelledRow.getByRole("button", { name: `Cancel invitation for ${cancelledEmail}` }).click();
    await confirmInAppDialog(ownerPage, `Cancel the invitation for ${cancelledEmail}?`, "Cancel invitation");
    await expect(ownerPage.getByText(/^Invitation cancelled/)).toBeVisible();
    await expect(ownerPage.getByRole("row").filter({ hasText: cancelledEmail })).toHaveCount(0);

    await chooseMoreAction(ownerPage, "Delete workspace");
    await confirmInAppDialog(ownerPage, 'Delete "Shared Research"?', "Delete workspace");
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
  const openInvite = page.getByRole("button", { name: "Invite user", exact: true });
  const inviteEmail = page.getByLabel("Invite email", { exact: true });

  if (!(await inviteEmail.count())) await openInvite.click();
  await expect(inviteEmail).toBeVisible();
  await inviteEmail.fill(email);
  await page.getByRole("button", { name: "Invite user", exact: true }).click();
  await expect(page.getByText(`Invitation sent: ${email}`)).toBeVisible();
}

async function selectInvitation(page: Page, workspaceName: string) {
  await page.getByRole("link").filter({ hasText: workspaceName }).filter({ hasText: "Invited as Member" }).click();
}
