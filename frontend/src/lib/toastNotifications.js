const successMessages = {
  "workspace.apiKey.rotate": () => "Workspace API key rotated",
  "workspace.create": ({ target }) => withTarget("Workspace created", target),
  "workspace.rename": ({ target }) => withTarget("Workspace renamed", target),
  "workspace.leave": ({ replacementPersonalWorkspaceCreated }) =>
    replacementPersonalWorkspaceCreated
      ? "Workspace left. Replacement personal Workspace created."
      : "Workspace left",
  "workspace.delete": () => "Workspace deleted",
  "template.save": ({ target }) => withTarget("Template saved", target),
  "template.delete": ({ target }) => withTarget("Template deleted", target),
  "workspaceInvitation.create": ({ target }) => `Successfully invited ${target}`,
  "workspaceInvitation.cancel": ({ target }) => target ? `Invitation cancelled for ${target}` : "Invitation cancelled",
  "workspaceInvitation.accept": () => "Workspace invitation accepted",
  "workspaceInvitation.decline": () => "Invitation declined",
  "workspaceMember.remove": ({ target }) => `Removed ${target} from workspace`,
  "workspaceMember.makeAdmin": ({ target }) => `Made ${target} an admin`,
  "workspaceMember.transferOwnership": ({ target }) => `Workspace ownership transferred to ${target}`,
  "document.retry": () => "Document retry queued",
  "document.delete": ({ target }) => withTarget("Document deleted", target),
  "clipboard.copyTemplateJson": () => "Template JSON copied",
};

const failureMessages = {
  "workspace.apiKey.rotate": "Workspace API key could not be rotated. Please try again.",
  "workspace.create": "Workspace could not be created. Please try again.",
  "workspace.rename": "Workspace name could not be saved. Please try again.",
  "workspace.leave": "Workspace could not be left. Please try again.",
  "workspace.delete": "Workspace could not be deleted. Please try again.",
  "template.save": "Template could not be saved. Please try again.",
  "template.delete": "Template could not be deleted. Please try again.",
  "workspaceInvitation.create": "Workspace invitation could not be created. Please try again.",
  "workspaceInvitation.cancel": "Workspace invitation could not be cancelled. Please try again.",
  "workspaceInvitation.accept": "Workspace invitation could not be accepted. Please try again.",
  "workspaceInvitation.decline": "Workspace invitation could not be declined. Please try again.",
  "workspaceMember.remove": "Workspace member action failed. Please try again.",
  "workspaceMember.makeAdmin": "Workspace member action failed. Please try again.",
  "workspaceMember.transferOwnership": "Workspace member action failed. Please try again.",
  "document.upload": "Document could not be queued. Please try again.",
  "document.retry": "Document retry could not be queued. Please try again.",
  "document.delete": "Document could not be deleted. Please try again.",
  "clipboard.copyTemplateJson": "Template JSON could not be copied. Please try again.",
};

const validationMessages = {
  "workspace.create": {
    name: "Enter a Workspace name before creating it.",
  },
  "template.save": {
    draft: "Template draft is incomplete. Fix required fields before saving.",
    json: "Template JSON is invalid. Fix it before saving.",
  },
  "workspaceInvitation.create": {
    email: "Enter an email address before inviting a teammate.",
  },
  "workspaceMember.remove": {
    member: "Choose a Workspace member before changing access.",
  },
  "document.upload": {
    template: "Choose a template before uploading documents.",
    files: "Choose at least one document to upload.",
  },
  "document.retry": {
    document: "Choose a failed document before retrying.",
    status: "Only failed documents can be retried.",
  },
  "clipboard.copyTemplateJson": {
    content: "No template JSON is available to copy.",
  },
};

const alreadyRemovedMessages = {
  "document.delete": ({ target }) => withTarget("Document already removed", target),
};

export function getActionToast(action, outcome, options = {}) {
  const target = getTargetDisplay(options);

  if (outcome === "success" && successMessages[action]) {
    return {
      severity: "success",
      message: successMessages[action]({
        target,
        replacementPersonalWorkspaceCreated:
          options.replacementPersonalWorkspaceCreated,
      }),
    };
  }

  if (outcome === "alreadyRemoved" && alreadyRemovedMessages[action]) {
    return {
      severity: "success",
      message: alreadyRemovedMessages[action]({ target }),
    };
  }

  if (outcome === "validation") {
    return {
      severity: "error",
      message:
        validationMessages[action]?.[options.reason] ??
        "Action blocked. Check the form and try again.",
    };
  }

  if (outcome === "failure") {
    return {
      severity: "error",
      message: failureMessages[action] ?? "Action failed. Please try again.",
    };
  }

  return {
    severity: "error",
    message: "Action failed. Please try again.",
  };
}

export function getDocumentUploadToast({ queued = 0, failed = 0 }) {
  if (failed === 0) {
    return {
      severity: "success",
      message: `${queued} ${pluralize("document", queued)} queued`,
    };
  }

  if (queued === 0) {
    return {
      severity: "error",
      message: `${failed} ${pluralize("document", failed)} failed to queue`,
    };
  }

  return {
    severity: "error",
    message: `${queued} ${pluralize("document", queued)} queued, ${failed} failed`,
  };
}

function getTargetDisplay(options) {
  return options.targetName || options.targetEmail || options.targetId || "";
}

function withTarget(message, target) {
  return target ? `${message}: ${target}` : message;
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}
