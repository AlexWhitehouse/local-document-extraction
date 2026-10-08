import { toast as sonnerToast } from "sonner";
import { getActionToast, getDocumentUploadToast } from "./toastNotifications";

// The only module that talks to the toast library. Messages come from
// toastNotifications.js so every action reports the same way.
export const TOAST_DURATION = { success: 4000, error: 8000 };

export const defaultToast = sonnerToast;

function toastSettings(severity, { undo, retry, persistent } = {}) {
  const settings = { duration: persistent ? Infinity : TOAST_DURATION[severity] };

  if (undo) settings.action = { label: "Undo", onClick: undo };
  else if (retry) settings.action = { label: "Try again", onClick: retry };

  return settings;
}

export function showToast(toast, { severity, message }, options) {
  toast[severity](message, toastSettings(severity, options));
}

// notify(actionKey, outcome, { targetName, error, count, total, undo, retry, ... })
export function createNotifier(toast = sonnerToast) {
  const notify = (action, outcome, options = {}) => showToast(toast, getActionToast(action, outcome, options), options);

  notify.documentUpload = (options) => showToast(toast, getDocumentUploadToast(options));

  return notify;
}
