import { describeError } from "./describeError";
import { pluralize } from "./text";

const successMessages = {
  "workspace.apiKey.generate": () => "API key generated",
  "workspace.apiKey.rotate": () => "API key rotated",
  "workspace.create": ({ target }) => withTarget("Workspace created", target),
  "workspace.rename": ({ target }) => withTarget("Workspace renamed", target),
  "workspace.access.changed": ({ target }) =>
    target ? `Workspace access changed. Switched to ${target}.` : "Workspace access changed.",
  "workspace.leave": ({ replacementPersonalWorkspaceCreated }) =>
    replacementPersonalWorkspaceCreated ? "Workspace left. Replacement personal Workspace created." : "Workspace left",
  "workspace.delete": () => "Workspace deleted",
  "template.save": ({ target }) => withTarget("Template saved", target),
  "template.delete": ({ target }) => withTarget("Template deleted", target),
  "workspaceInvitation.create": ({ target }) => `Invited ${target}`,
  "workspaceInvitation.cancel": ({ target }) =>
    target ? `Invitation cancelled for ${target}` : "Invitation cancelled",
  "workspaceInvitation.accept": () => "Workspace invitation accepted",
  "workspaceInvitation.decline": () => "Invitation declined",
  "workspaceMember.remove": ({ target }) => `Removed ${target} from workspace`,
  "workspaceMember.makeAdmin": ({ target }) => `Made ${target} an admin`,
  "workspaceMember.transferOwnership": ({ target }) => `Workspace ownership transferred to ${target}`,
  "applicationRole.change": ({ target }) => withTarget("Application role updated", target),
  "applicationUser.ban": ({ target }) => withTarget("User banned", target),
  "applicationUser.unban": ({ target }) => withTarget("User unbanned", target),
  "applicationUser.stopImpersonating": () => "Impersonation stopped",
  "document.delete": ({ target }) => withTarget("Document deleted", target),
  "document.bulkDelete": ({ removed = 0 }) => `Deleted ${pluralize(removed, "document")}`,
  "document.export": ({ exportedCount = 0, skippedCount = 0 }) => {
    const exported = `Exported ${pluralize(exportedCount, "document")}`;

    return skippedCount
      ? `${exported}; skipped ${skippedCount} unavailable or in-progress ${skippedCount === 1 ? "document" : "documents"}`
      : exported;
  },
  "workspace.documentProcessing": ({ setting, enabled }) => `${setting} turned ${enabled ? "on" : "off"}`,
  "workspace.sourceRetention": ({ enabled }) =>
    enabled ? "New uploads will keep their original documents" : "New uploads will keep only their extraction results",
  "workspace.modelGateway.save": () => "Model gateway saved",
  "workspace.modelGateway.clear": () => "Model gateway cleared",
  "profile.update": () => "Profile updated",
  "evaluation.templateSave": ({ target }) => withTarget("Template saved", target),
  "library.save": ({ target }) => `Saved “${target}” to the Workspace library`,
  "library.updateSaved": ({ target }) => withTarget("Saved answers updated", target),
  "library.useSaved": () => "Loaded the current saved answers. Local changes were discarded",
  "library.rename": ({ target }) => `Renamed to “${target}”`,
  "library.delete": ({ target }) => `Deleted “${target}” from the library`,
  "library.restoreOriginal": () => "The saved original is available again. Run it when you’re ready",
  "tag.rename": ({ target }) => withTarget("Tag renamed", target),
  "tag.delete": ({ target }) => withTarget("Tag deleted", target),
  "document.useTemplate": ({ target, templateName }) =>
    `Processing ${target || "document"}${templateName ? ` with ${templateName}` : ""}`,
  "packet.confirmPlan": () => "Split plan confirmed",
};

const failureMessages = {
  "workspace.apiKey.generate": () => "Workspace API key could not be generated. Please try again.",
  "workspace.apiKey.rotate": () => "Workspace API key could not be rotated. Please try again.",
  "workspace.create": () => "Workspace could not be created. Please try again.",
  "workspace.rename": () => "Workspace name could not be saved. Please try again.",
  "workspace.leave": () => "Workspace could not be left. Please try again.",
  "workspace.delete": () => "Workspace could not be deleted. Please try again.",
  "template.save": () => "Template could not be saved. Please try again.",
  "template.delete": () => "Template could not be deleted. Please try again.",
  "workspaceInvitation.create": () => "Workspace invitation could not be created. Please try again.",
  "workspaceInvitation.cancel": () => "Workspace invitation could not be cancelled. Please try again.",
  "workspaceInvitation.accept": () => "Workspace invitation could not be accepted. Please try again.",
  "workspaceInvitation.decline": () => "Workspace invitation could not be declined. Please try again.",
  "workspaceMember.remove": ({ target }) => (target ? `Couldn't remove ${target}.` : "Couldn't remove this member."),
  "workspaceMember.makeAdmin": ({ target }) =>
    target ? `Couldn't make ${target} an admin.` : "Couldn't make this member an admin.",
  "workspaceMember.transferOwnership": () => "Couldn't transfer ownership.",
  "applicationRole.change": () => "Application role could not be updated. Please try again.",
  "applicationUser.ban": () => "User could not be banned. Please try again.",
  "applicationUser.unban": () => "User could not be unbanned. Please try again.",
  "applicationUser.impersonate": () => "Impersonation could not be started. Please try again.",
  "applicationUser.stopImpersonating": () => "Impersonation could not be stopped. Please try again.",
  "document.delete": () => "Document could not be deleted. Please try again.",
  "document.bulkDelete": ({ removed = 0, total = 0 }) =>
    `Deleted ${removed} of ${total}. ${total - removed} couldn't be deleted.`,
  "document.export": () => "Selected documents could not be exported. Please try again.",
  "document.downloadOriginal": () =>
    "The original document couldn't be downloaded because storage can't be reached. Please try again.",
  "document.downloadOriginalMissing": () =>
    "The original document couldn't be downloaded because it's missing from storage.",
  "workspace.documentProcessing": () => "Document processing settings could not be saved. Please try again.",
  "workspace.sourceRetention": () => "Document retention could not be updated. Please try again.",
  "workspace.modelGateway.save": () =>
    "Model gateway could not be saved. Replace an unavailable credential or try again.",
  "workspace.modelGateway.clear": () => "Model gateway could not be cleared. Please try again.",
  "auth.signOut": () => "Couldn't sign out. Try again.",
  "library.rename": ({ target }) => `Couldn't rename “${target}”.`,
  "library.restoreOriginal": () => "Couldn't make the saved original available.",
  "library.loadLatest": () => "Couldn't load the latest saved answers.",
  "tag.rename": () => "Couldn't rename the tag.",
  "tag.delete": () => "Couldn't delete the tag.",
  "document.useTemplate": () => "Couldn't use that template for this document.",
  "packet.confirmPlan": () => "Couldn't confirm the split plan.",
};

const validationMessages = {
  "template.save": {
    draft: "Template draft is incomplete. Fix required fields before saving.",
    json: "Template JSON is invalid. Fix it before saving.",
  },
  "document.upload": {
    template: "Choose a template before uploading documents.",
    files: "Choose at least one document to upload.",
  },
};

const alreadyRemovedMessages = {
  "document.delete": ({ target }) => withTarget("Document already removed", target),
};

export function getActionToast(action, outcome, options = {}) {
  const target = options.targetName || options.targetEmail || options.targetId || "";

  if (outcome === "success" && successMessages[action]) {
    return { severity: "success", message: successMessages[action]({ ...options, target }) };
  }

  if (outcome === "alreadyRemoved" && alreadyRemovedMessages[action]) {
    return { severity: "success", message: alreadyRemovedMessages[action]({ target }) };
  }

  if (outcome === "validation") {
    return {
      severity: "error",
      message: validationMessages[action]?.[options.reason] ?? "Action blocked. Check the form and try again.",
    };
  }

  const message =
    (outcome === "failure" && failureMessages[action]?.({ ...options, target })) || "Action failed. Please try again.";

  return { severity: "error", message: withReason(message, options.error) };
}

// Adds the mapped reason (permission, conflict, limit…) when one is known.
function withReason(message, error) {
  const reason = error ? describeError(error, "") : "";

  return reason && !message.includes(reason) ? `${message} ${reason}` : message;
}

export function getDocumentUploadToast({ queued = 0, failed = 0 }) {
  if (failed === 0) {
    return {
      severity: "success",
      message: `${pluralize(queued, "document")} queued`,
    };
  }

  if (queued === 0) {
    return {
      severity: "error",
      message: `${pluralize(failed, "document")} failed to queue`,
    };
  }

  return {
    severity: "error",
    message: `${pluralize(queued, "document")} queued, ${failed} failed`,
  };
}

function withTarget(message, target) {
  return target ? `${message}: ${target}` : message;
}
