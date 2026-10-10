import { describeError } from "./describeError";
import { pluralize } from "./text";

// Success: "{Thing} {past verb}: {target}" when a name is known, otherwise "{Thing} {past verb}".
// Failure: "Couldn't {verb} {target}." Mapped reasons are appended by withReason.
const successMessages = {
  "workspace.apiKey.generate": () => "API key generated",
  "workspace.apiKey.rotate": () => "API key rotated",
  "workspace.create": ({ target }) => withTarget("Workspace created", target),
  "workspace.rename": ({ target }) => withTarget("Workspace renamed", target),
  "workspace.access.changed": ({ target }) => (target ? `Switched to workspace: ${target}` : "Workspace access changed"),
  "workspace.leave": ({ replacementPersonalWorkspaceCreated }) =>
    replacementPersonalWorkspaceCreated
      ? "Workspace left. A personal workspace was created to replace it."
      : "Workspace left",
  "workspace.delete": () => "Workspace deleted",
  "template.save": ({ target }) => withTarget("Template saved", target),
  "template.delete": ({ target }) => withTarget("Template deleted", target),
  "workspaceInvitation.create": ({ target }) => withTarget("Invitation sent", target),
  "workspaceInvitation.cancel": ({ target }) => withTarget("Invitation cancelled", target),
  "workspaceInvitation.accept": () => "Invitation accepted",
  "workspaceInvitation.decline": () => "Invitation declined",
  "workspaceMember.remove": ({ target }) => withTarget("Member removed", target),
  "workspaceMember.makeAdmin": ({ target }) => withTarget("Member made admin", target),
  "workspaceMember.makeMember": ({ target }) => withTarget("Admin made member", target),
  "workspaceMember.transferOwnership": ({ target }) => withTarget("Ownership transferred", target),
  "applicationRole.change": ({ target }) => withTarget("Application role updated", target),
  "applicationUser.ban": ({ target }) => withTarget("User banned", target),
  "applicationUser.unban": ({ target }) => withTarget("User unbanned", target),
  "applicationUser.stopImpersonating": () => "Impersonation stopped",
  "document.delete": ({ target }) => withTarget("Document deleted", target),
  "document.bulkDelete": ({ removed = 0 }) => `Deleted ${pluralize(removed, "document")}`,
  "document.export": ({ exportedCount = 0, skippedCount = 0 }) => {
    const exported = `Exported ${pluralize(exportedCount, "document")}`;

    return skippedCount ? `${exported}. Skipped ${skippedCount} that can't be exported.` : exported;
  },
  "workspace.documentProcessing": ({ setting, enabled }) => `${setting} turned ${enabled ? "on" : "off"}`,
  "workspace.sourceRetention": ({ enabled }) =>
    enabled ? "New uploads keep their originals" : "New uploads keep only results",
  "workspace.modelGateway.save": () => "Model gateway saved",
  "workspace.modelGateway.clear": () => "Model gateway cleared",
  "workspace.modelGateway.test": ({ message }) => message,
  "workspace.extractionModel": ({ target }) => withTarget("Extraction model changed", target),
  "profile.update": () => "Profile updated",
  "evaluation.templateSave": ({ target }) => withTarget("Template saved", target),
  "library.save": ({ target }) => withTarget("Saved to library", target),
  "library.updateSaved": ({ target }) => withTarget("Saved answers updated", target),
  "library.useSaved": () => "Saved answers loaded. Unsaved changes were discarded.",
  "library.rename": ({ target }) => withTarget("Library item renamed", target),
  "library.delete": ({ target }) => withTarget("Library item deleted", target),
  "library.restoreOriginal": () => "Original restored. Run it when you're ready.",
  "tag.rename": ({ target }) => withTarget("Tag renamed", target),
  "tag.delete": ({ target }) => withTarget("Tag deleted", target),
  "document.useTemplate": ({ target, templateName }) =>
    `Processing ${target || "document"}${templateName ? ` with ${templateName}` : ""}`,
  "packet.confirmPlan": () => "Split plan confirmed",
  "draft.removeField": ({ target }) => withTarget("Field removed", target),
  "draft.removeColumn": ({ target }) => withTarget("Column removed", target),
  "evaluation.removeCandidate": ({ target }) => withTarget("Candidate removed", target),
  "evaluation.testChanges": ({ target }) => withTarget("Copy created to test changes", target),
  "evaluation.applyAssistant": ({ target }) => withTarget("Changes applied. Run again to test them", target),
  "evaluation.removeDocument": ({ target }) => withTarget("Document removed", target),
  "evaluation.discardChanges": () => "Changes discarded",
  "evaluation.acceptAnswers": ({ count = 0, target }) =>
    `${pluralize(count, "expected answer")} accepted${target ? ` from ${target}` : ""}`,
  "packet.removeSplit": () => "Document removed from the split plan",
};

const failureMessages = {
  "workspace.apiKey.generate": () => "Couldn't generate API key.",
  "workspace.apiKey.rotate": () => "Couldn't rotate API key.",
  "workspace.create": () => "Couldn't create workspace.",
  "workspace.rename": () => "Couldn't rename workspace.",
  "workspace.leave": () => "Couldn't leave workspace.",
  "workspace.delete": () => "Couldn't delete workspace.",
  "template.save": ({ target }) => (target ? `Couldn't save ${target}.` : "Couldn't save template."),
  "template.delete": ({ target }) => (target ? `Couldn't delete ${target}.` : "Couldn't delete template."),
  "workspaceInvitation.create": ({ target }) => (target ? `Couldn't invite ${target}.` : "Couldn't send invitation."),
  "workspaceInvitation.cancel": () => "Couldn't cancel invitation.",
  "workspaceInvitation.accept": () => "Couldn't accept invitation.",
  "workspaceInvitation.decline": () => "Couldn't decline invitation.",
  "workspaceMember.remove": ({ target }) => (target ? `Couldn't remove ${target}.` : "Couldn't remove this member."),
  "workspaceMember.makeAdmin": ({ target }) =>
    target ? `Couldn't make ${target} an admin.` : "Couldn't make this member an admin.",
  "workspaceMember.makeMember": ({ target }) =>
    target ? `Couldn't make ${target} a member.` : "Couldn't make this admin a member.",
  "workspaceMember.transferOwnership": () => "Couldn't transfer ownership.",
  "applicationRole.change": () => "Couldn't update application role.",
  "applicationUser.ban": () => "Couldn't ban user.",
  "applicationUser.unban": () => "Couldn't unban user.",
  "applicationUser.impersonate": () => "Couldn't start impersonation.",
  "applicationUser.stopImpersonating": () => "Couldn't stop impersonation.",
  "document.delete": ({ target }) => (target ? `Couldn't delete ${target}.` : "Couldn't delete document."),
  "document.bulkDelete": ({ removed = 0, total = 0 }) => `Deleted ${removed} of ${total}. Couldn't delete ${total - removed}.`,
  "document.export": () => "Couldn't export selected documents.",
  "document.downloadOriginal": () => "Couldn't download the original.",
  "document.downloadOriginalMissing": () => "Couldn't download the original. The original file is no longer available.",
  "workspace.documentProcessing": () => "Couldn't save document processing settings.",
  "workspace.sourceRetention": () => "Couldn't update retention settings.",
  "workspace.modelGateway.save": () => "Couldn't save Model gateway.",
  "workspace.modelGateway.clear": () => "Couldn't clear Model gateway.",
  "workspace.modelGateway.test": ({ message }) => message,
  "auth.signOut": () => "Couldn't sign out.",
  "auth.signIn": ({ message }) => message,
  "auth.signUp": ({ message }) => message,
  "auth.googleSignIn": () => "Couldn't start Google sign-in.",
  "auth.requestPasswordReset": () => "Couldn't send reset link.",
  "auth.resetPassword": () => "Couldn't reset password. Request a new link.",
  "library.rename": ({ target }) => (target ? `Couldn't rename ${target}.` : "Couldn't rename library item."),
  "library.restoreOriginal": () => "Couldn't restore the original.",
  "library.loadLatest": () => "Couldn't load the latest saved answers.",
  "tag.rename": () => "Couldn't rename the tag.",
  "tag.delete": () => "Couldn't delete the tag.",
  "document.useTemplate": () => "Couldn't use that template for this document.",
  "packet.confirmPlan": () => "Couldn't confirm the split plan.",
  "evaluation.start": () => "Couldn't start the evaluation.",
  "assistant.request": () => "Couldn't get a response. Your draft is unchanged.",
  "assistant.evidence": () => "Couldn't load that document. Choose it again or continue without it.",
  "assistant.sample": () => "Couldn't load the original. Try again or send the results only.",
  "evaluation.improve": () => "Couldn't load the results for this candidate.",
  "evaluation.applyAssistant": () => "Couldn't apply the changes. Try again.",
};

const validationMessages = {
  "template.save": {
    draft: "Template draft is incomplete. Fix required fields before saving.",
    json: "Template JSON is invalid. Fix it before saving.",
  },
  "library.save": {
    unverified: "Verify every field before saving to the library.",
  },
  "library.updateSaved": {
    unverified: "Verify every field before updating saved answers.",
  },
  "document.upload": {
    template: "Choose a template before uploading.",
    files: "Choose at least one file.",
  },
};

const alreadyRemovedMessages = {
  "document.delete": ({ target }) => withTarget("Document already deleted", target),
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
      message: validationMessages[action]?.[options.reason] ?? "Check the form and try again.",
    };
  }

  const message =
    (outcome === "failure" && failureMessages[action]?.({ ...options, target })) || "Something went wrong. Try again.";

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
      message: `Couldn't queue ${pluralize(failed, "document")}.`,
    };
  }

  return {
    severity: "error",
    message: `${pluralize(queued, "document")} queued. Couldn't queue ${failed}.`,
  };
}

function withTarget(message, target) {
  return target ? `${message}: ${target}` : message;
}
