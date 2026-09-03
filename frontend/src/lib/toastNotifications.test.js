import { describe, expect, it } from "vitest";

import { getActionToast, getDocumentUploadToast } from "./toastNotifications.js";

describe("app action toast notifications", () => {
  it("confirms Workspace creation with a human-readable target name", () => {
    expect(
      getActionToast("workspace.create", "success", {
        targetName: "Research Workspace",
      }),
    ).toEqual({
      severity: "success",
      message: "Workspace created: Research Workspace",
    });
  });

  it("falls back safely when a success target name is unavailable", () => {
    expect(getActionToast("template.save", "success")).toEqual({
      severity: "success",
      message: "Template saved",
    });
  });

  it("keeps API key material out of rotation notifications", () => {
    const secret = "imgx_live_new-secret-key";

    expect(
      getActionToast("workspace.apiKey.rotate", "success", {
        apiKey: secret,
      }),
    ).toEqual({
      severity: "success",
      message: "Workspace API key rotated",
    });
    expect(
      getActionToast("workspace.apiKey.rotate", "failure", {
        apiKey: secret,
        error: "Database constraint failed while saving imgx_live_new-secret-key",
      }).message,
    ).not.toContain(secret);
  });

  it("uses friendly failure copy instead of raw backend errors", () => {
    const notification = getActionToast("workspace.rename", "failure", {
      error: "Database constraint failed near secret_table",
    });

    expect(notification).toEqual({
      severity: "error",
      message: "Workspace name could not be saved. Please try again.",
    });
    expect(notification.message).not.toContain("Database");
  });

  it("returns validation blockers as error notifications", () => {
    expect(getActionToast("document.upload", "validation", { reason: "template" })).toEqual({
      severity: "error",
      message: "Choose a template before uploading documents.",
    });
    expect(getActionToast("workspace.create", "validation", { reason: "name" })).toEqual({
      severity: "error",
      message: "Enter a Workspace name before creating it.",
    });
    expect(getActionToast("template.save", "validation", { reason: "json" })).toEqual({
      severity: "error",
      message: "Template JSON is invalid. Fix it before saving.",
    });
    expect(getActionToast("workspaceInvitation.create", "validation", { reason: "email" })).toEqual({
      severity: "error",
      message: "Enter an email address before inviting a teammate.",
    });
    expect(getActionToast("workspaceMember.remove", "validation", { reason: "member" })).toEqual({
      severity: "error",
      message: "Choose a Workspace member before changing access.",
    });
    expect(getActionToast("clipboard.copyTemplateJson", "validation", { reason: "content" })).toEqual({
      severity: "error",
      message: "No template JSON is available to copy.",
    });
  });

  it("provides friendly failure copy for each app action group", () => {
    expect(getActionToast("workspace.create", "failure")).toEqual({
      severity: "error",
      message: "Workspace could not be created. Please try again.",
    });
    expect(getActionToast("workspace.leave", "failure")).toEqual({
      severity: "error",
      message: "Workspace could not be left. Please try again.",
    });
    expect(getActionToast("workspace.delete", "failure")).toEqual({
      severity: "error",
      message: "Workspace could not be deleted. Please try again.",
    });
    expect(getActionToast("template.save", "failure")).toEqual({
      severity: "error",
      message: "Template could not be saved. Please try again.",
    });
    expect(getActionToast("workspaceInvitation.create", "failure")).toEqual({
      severity: "error",
      message: "Workspace invitation could not be created. Please try again.",
    });
    expect(getActionToast("workspaceMember.remove", "failure")).toEqual({
      severity: "error",
      message: "Workspace member action failed. Please try again.",
    });
    expect(getActionToast("document.upload", "failure")).toEqual({
      severity: "error",
      message: "Document could not be queued. Please try again.",
    });
    expect(getActionToast("document.delete", "failure")).toEqual({
      severity: "error",
      message: "Document could not be deleted. Please try again.",
    });
  });

  it("uses Workspace invitation terminology for invitation lifecycle actions", () => {
    expect(
      getActionToast("workspaceInvitation.create", "success", {
        targetEmail: "ada@example.com",
      }),
    ).toEqual({
      severity: "success",
      message: "Successfully invited ada@example.com",
    });
    expect(
      getActionToast("workspaceInvitation.cancel", "success", {
        targetEmail: "grace@example.com",
      }),
    ).toEqual({
      severity: "success",
      message: "Invitation cancelled for grace@example.com",
    });
    expect(getActionToast("workspaceInvitation.accept", "success")).toEqual({
      severity: "success",
      message: "Workspace invitation accepted",
    });
    expect(getActionToast("workspaceInvitation.decline", "success")).toEqual({
      severity: "success",
      message: "Invitation declined",
    });
  });

  it("uses Workspace member action terminology for access-management changes", () => {
    expect(
      getActionToast("workspaceMember.remove", "success", {
        targetName: "Grace Hopper",
      }),
    ).toEqual({
      severity: "success",
      message: "Removed Grace Hopper from workspace",
    });
    expect(
      getActionToast("workspaceMember.makeAdmin", "success", {
        targetEmail: "linus@example.com",
      }),
    ).toEqual({
      severity: "success",
      message: "Made linus@example.com an admin",
    });
    expect(
      getActionToast("workspaceMember.transferOwnership", "success", {
        targetName: "Katherine Johnson",
      }),
    ).toEqual({
      severity: "success",
      message: "Workspace ownership transferred to Katherine Johnson",
    });
  });

  it("covers document and clipboard action feedback", () => {
    expect(
      getActionToast("document.delete", "success", {
        targetName: "invoice.pdf",
      }),
    ).toEqual({
      severity: "success",
      message: "Document deleted: invoice.pdf",
    });
    expect(
      getActionToast("document.delete", "alreadyRemoved", {
        targetName: "invoice.pdf",
      }),
    ).toEqual({
      severity: "success",
      message: "Document already removed: invoice.pdf",
    });
    expect(
      getActionToast("document.bulkDelete", "success", {
        targetName: "3 documents",
      }),
    ).toEqual({
      severity: "success",
      message: "3 documents deleted",
    });
    expect(getActionToast("document.bulkDelete", "failure")).toEqual({
      severity: "error",
      message: "Some selected documents could not be deleted. Try again.",
    });
    expect(
      getActionToast("document.export", "success", {
        exportedCount: 2,
        skippedCount: 1,
      }),
    ).toEqual({
      severity: "success",
      message: "Exported 2 documents; skipped 1 unavailable or in-progress document",
    });
    expect(getActionToast("document.export", "failure")).toEqual({
      severity: "error",
      message: "Selected documents could not be exported. Please try again.",
    });
    expect(getActionToast("clipboard.copyTemplateJson", "success")).toEqual({
      severity: "success",
      message: "Template JSON copied",
    });
    expect(getActionToast("clipboard.copyTemplateJson", "failure")).toEqual({
      severity: "error",
      message: "Template JSON could not be copied. Please try again.",
    });
  });

  it("summarizes document upload batches without per-file details", () => {
    expect(getDocumentUploadToast({ queued: 3, failed: 0 })).toEqual({
      severity: "success",
      message: "3 documents queued",
    });
    expect(getDocumentUploadToast({ queued: 2, failed: 1 })).toEqual({
      severity: "error",
      message: "2 documents queued, 1 failed",
    });
    expect(getDocumentUploadToast({ queued: 0, failed: 4 })).toEqual({
      severity: "error",
      message: "4 documents failed to queue",
    });
  });
});
