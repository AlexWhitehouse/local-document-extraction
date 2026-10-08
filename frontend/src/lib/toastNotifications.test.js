import { describe, expect, it } from "vitest";

import { getActionToast, getDocumentUploadToast } from "./toastNotifications.js";

describe("app action toast notifications", () => {
  it("reports Workspace setting changes and model gateway results", () => {
    expect(getActionToast("workspace.documentProcessing", "success", { setting: "Smart splitting", enabled: true }).message).toBe("Smart splitting turned on");
    expect(getActionToast("workspace.sourceRetention", "success", { enabled: false }).message).toBe("New uploads keep only results");
    expect(getActionToast("workspace.modelGateway.save", "success")).toEqual({ severity: "success", message: "Model gateway saved" });
  });

  it("names removed draft items and says what was discarded", () => {
    expect(getActionToast("draft.removeField", "success", { targetName: "Total" }).message).toBe("Field removed: Total");
    expect(getActionToast("draft.removeColumn", "success", { targetName: "SKU" }).message).toBe("Column removed: SKU");
    expect(getActionToast("evaluation.removeCandidate", "success", { targetName: "gpt-4o" }).message).toBe("Candidate removed: gpt-4o");
    expect(getActionToast("evaluation.removeCandidate", "success").message).toBe("Candidate removed");
    expect(getActionToast("evaluation.removeDocument", "success", { targetName: "a.pdf" }).message).toBe("Document removed: a.pdf");
    expect(getActionToast("evaluation.discardChanges", "success").message).toBe("Changes discarded");
    expect(getActionToast("packet.removeSplit", "success").message).toBe("Document removed from the split plan");
  });

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
      message: "API key rotated",
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
      message: "Couldn't rename workspace.",
    });
    expect(notification.message).not.toContain("Database");
  });

  it("returns validation blockers as error notifications", () => {
    expect(getActionToast("document.upload", "validation", { reason: "template" })).toEqual({
      severity: "error",
      message: "Choose a template before uploading.",
    });
    expect(getActionToast("template.save", "validation", { reason: "json" })).toEqual({
      severity: "error",
      message: "Template JSON is invalid. Fix it before saving.",
    });
  });

  it("provides friendly failure copy for each app action group", () => {
    expect(getActionToast("workspace.create", "failure")).toEqual({
      severity: "error",
      message: "Couldn't create workspace.",
    });
    expect(getActionToast("workspace.leave", "failure")).toEqual({
      severity: "error",
      message: "Couldn't leave workspace.",
    });
    expect(getActionToast("workspace.delete", "failure")).toEqual({
      severity: "error",
      message: "Couldn't delete workspace.",
    });
    expect(getActionToast("template.save", "failure")).toEqual({
      severity: "error",
      message: "Couldn't save template.",
    });
    expect(getActionToast("workspaceInvitation.create", "failure")).toEqual({
      severity: "error",
      message: "Couldn't send invitation.",
    });
    expect(getActionToast("workspaceMember.remove", "failure", { targetName: "Grace Hopper" })).toEqual({
      severity: "error",
      message: "Couldn't remove Grace Hopper.",
    });
    expect(getActionToast("workspaceMember.makeAdmin", "failure", { targetEmail: "linus@example.com" })).toEqual({
      severity: "error",
      message: "Couldn't make linus@example.com an admin.",
    });
    expect(getActionToast("workspaceMember.transferOwnership", "failure")).toEqual({
      severity: "error",
      message: "Couldn't transfer ownership.",
    });
    expect(getActionToast("document.delete", "failure")).toEqual({
      severity: "error",
      message: "Couldn't delete document.",
    });
  });

  it("uses Workspace invitation terminology for invitation lifecycle actions", () => {
    expect(
      getActionToast("workspaceInvitation.create", "success", {
        targetEmail: "ada@example.com",
      }),
    ).toEqual({
      severity: "success",
      message: "Invitation sent: ada@example.com",
    });
    expect(
      getActionToast("workspaceInvitation.cancel", "success", {
        targetEmail: "grace@example.com",
      }),
    ).toEqual({
      severity: "success",
      message: "Invitation cancelled: grace@example.com",
    });
    expect(getActionToast("workspaceInvitation.accept", "success")).toEqual({
      severity: "success",
      message: "Invitation accepted",
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
      message: "Member removed: Grace Hopper",
    });
    expect(
      getActionToast("workspaceMember.makeAdmin", "success", {
        targetEmail: "linus@example.com",
      }),
    ).toEqual({
      severity: "success",
      message: "Member made admin: linus@example.com",
    });
    expect(
      getActionToast("workspaceMember.transferOwnership", "success", {
        targetName: "Katherine Johnson",
      }),
    ).toEqual({
      severity: "success",
      message: "Ownership transferred: Katherine Johnson",
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
      message: "Document already deleted: invoice.pdf",
    });
    expect(getActionToast("document.bulkDelete", "success", { removed: 1, total: 1 })).toEqual({
      severity: "success",
      message: "Deleted 1 document",
    });
    expect(getActionToast("document.bulkDelete", "success", { removed: 3, total: 3 })).toEqual({
      severity: "success",
      message: "Deleted 3 documents",
    });
    expect(getActionToast("document.bulkDelete", "failure", { removed: 7, total: 9 })).toEqual({
      severity: "error",
      message: "Deleted 7 of 9. Couldn't delete 2.",
    });
    expect(
      getActionToast("document.export", "success", {
        exportedCount: 2,
        skippedCount: 1,
      }),
    ).toEqual({
      severity: "success",
      message: "Exported 2 documents. Skipped 1 that can't be exported.",
    });
    expect(getActionToast("document.export", "failure")).toEqual({
      severity: "error",
      message: "Couldn't export selected documents.",
    });
  });

  it("names tag, template use and split plan outcomes", () => {
    expect(getActionToast("tag.rename", "success", { targetName: "finance" })).toEqual({
      severity: "success",
      message: "Tag renamed: finance",
    });
    expect(getActionToast("tag.delete", "success", { targetName: "invoice" })).toEqual({
      severity: "success",
      message: "Tag deleted: invoice",
    });
    expect(getActionToast("tag.delete", "failure")).toEqual({
      severity: "error",
      message: "Couldn't delete the tag.",
    });
    expect(
      getActionToast("document.useTemplate", "success", { targetName: "invoice.pdf", templateName: "Invoice" }),
    ).toEqual({ severity: "success", message: "Processing invoice.pdf with Invoice" });
    expect(getActionToast("document.useTemplate", "failure", { error: new TypeError("x") })).toEqual({
      severity: "error",
      message:
        "Couldn't use that template for this document. Studio can't be reached. Check your connection and try again.",
    });
    expect(getActionToast("packet.confirmPlan", "success")).toEqual({
      severity: "success",
      message: "Split plan confirmed",
    });
    expect(getActionToast("packet.confirmPlan", "failure")).toEqual({
      severity: "error",
      message: "Couldn't confirm the split plan.",
    });
  });

  it("summarizes document upload batches without per-file details", () => {
    expect(getDocumentUploadToast({ queued: 3, failed: 0 })).toEqual({
      severity: "success",
      message: "3 documents queued",
    });
    expect(getDocumentUploadToast({ queued: 2, failed: 1 })).toEqual({
      severity: "error",
      message: "2 documents queued. Couldn't queue 1.",
    });
    expect(getDocumentUploadToast({ queued: 0, failed: 4 })).toEqual({
      severity: "error",
      message: "Couldn't queue 4 documents.",
    });
  });
});
