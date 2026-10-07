import { isString } from "../../../shared/json.ts";

const FALLBACK = "Something went wrong. Try again.";

// Server messages for these codes are written for people; show them as-is.
const READABLE_CODES = new Set([
  "pdf_source_file_limit_exceeded",
  "invalid_pdf_source_file",
  "source_file_too_large",
  "invalid_page_selection",
  "document_assessment_limit_exceeded",
  "workspace_model_not_configured",
  "local_admin_self_role_change_not_allowed",
  "local_admin_ban_reason_required",
  "local_application_role_not_allowed",
  "last_workspace",
  "no_exportable_jobs",
  "password_policy_not_met",
  "reference_too_large",
  "tag_name_conflict",
  "invalid_tags",
  "invalid_template_tags",
  "model_gateway_test_rejected",
]);

const CODE_MESSAGES = {
  source_missing: "The original file is no longer available.",
  source_unavailable: "The original file can't be opened right now. Try again.",
  source_not_retained: "The original file wasn't kept for this document.",
  document_deleted: "This document was deleted.",
  document_not_found: "This document no longer exists.",
  revision_conflict: "This changed while you were editing. Reload and try again.",
  operation_conflict: "Another change is in progress. Try again in a moment.",
  capacity_exhausted: "Studio is busy. Try again in a moment.",
  request_body_too_large: "This is too large to upload.",
  session_required: "Your session has ended. Sign in again.",
};

const STATUS_MESSAGES = {
  401: "Your session has ended. Sign in again.",
  403: "You don't have permission to do that.",
  404: "This item no longer exists.",
  409: "This changed since you opened it. Reload and try again.",
  413: "This is too large to upload.",
  429: "Studio is busy. Try again in a moment.",
};

function looksReadable(message) {
  return message.length > 0 && message.length <= 240 && !/[<>{}]|\n\s+at\s/.test(message);
}

// Turns any thrown value into short, user-safe text. Raw response bodies, HTML and
// stack traces never reach the UI.
export function describeError(error, fallback = FALLBACK) {
  if (!error) return fallback;

  if (error.name === "AbortError") return fallback;

  if (error instanceof TypeError && !("status" in error)) {
    return navigator.onLine === false
      ? "You appear to be offline."
      : "Studio can't be reached. Check your connection and try again.";
  }

  const code = isString(error.code) ? error.code : "";
  const message = isString(error.message) ? error.message.trim() : "";

  if (code && READABLE_CODES.has(code) && looksReadable(message)) return message;

  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];

  if (STATUS_MESSAGES[error.status]) return STATUS_MESSAGES[error.status];

  return fallback;
}
