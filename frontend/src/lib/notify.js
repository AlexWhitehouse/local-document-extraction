import { toast as sonnerToast } from "sonner";
import { getActionToast, getDocumentUploadToast } from "./toastNotifications";

// The only module that talks to the toast library. Messages come from
// toastNotifications.js so every action reports the same way.
export const TOAST_DURATION = { success: 4000, warning: 8000, error: 8000 };

export const defaultToast = sonnerToast;

// `link` is a follow-up such as opening related settings: { label, onClick }.
// A shared `id` replaces the previous toast with that id instead of stacking another.
function toastSettings(severity, { undo, retry, link, persistent, id } = {}) {
  const settings = { duration: persistent ? Infinity : TOAST_DURATION[severity] };

  if (id) settings.id = id;

  if (undo) settings.action = { label: "Undo", onClick: undo };
  else if (retry) settings.action = { label: "Try again", onClick: retry };
  else if (link) settings.action = { label: link.label, onClick: link.onClick };

  return settings;
}

export function showToast(toast, { severity, message }, options) {
  toast[severity](message, toastSettings(severity, options));
}

// notify(actionKey, outcome, { targetName, error, count, total, undo, retry, link, ... })
export function createNotifier(toast = sonnerToast) {
  const notify = (action, outcome, options = {}) => showToast(toast, getActionToast(action, outcome, options), options);

  notify.documentUpload = (options) => showToast(toast, getDocumentUploadToast(options));

  // Takes down the toast shown with this `id` once what it says no longer applies.
  notify.dismiss = (id) => toast.dismiss(id);

  return notify;
}
