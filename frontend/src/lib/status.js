const STATUS_LABELS = {
  queued: "Queued",
  pending: "Queued",
  processing: "Processing",
  running: "Processing",
  processing_children: "Extracting",
  materializing: "Preparing",
  assessing: "Assessing",
  splitting: "Splitting",
  completed: "Completed",
  success: "Completed",
  failed: "Failed",
  error: "Failed",
  interrupted: "Interrupted",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  awaiting_template: "Needs template",
  awaiting_review: "Needs review",
};

export function statusLabel(status) {
  const key = String(status || "").toLowerCase();

  if (!key) return "";

  if (STATUS_LABELS[key]) return STATUS_LABELS[key];

  const words = key.replace(/[_-]+/g, " ").trim();

  return words.charAt(0).toUpperCase() + words.slice(1);
}

// One tone vocabulary for every status display: neutral | info | success | warning | danger.
const STATUS_TONES = {
  queued: "neutral",
  pending: "neutral",
  processing: "info",
  running: "info",
  processing_children: "info",
  materializing: "info",
  assessing: "info",
  splitting: "info",
  completed: "success",
  success: "success",
  failed: "danger",
  error: "danger",
  interrupted: "warning",
  cancelled: "neutral",
  canceled: "neutral",
  awaiting_template: "warning",
  awaiting_review: "warning",
};

const BUSY_STATUSES = new Set(["processing", "running", "processing_children", "materializing", "assessing", "splitting"]);

export function statusTone(status) {
  return STATUS_TONES[String(status || "").toLowerCase()] || "neutral";
}

export function isBusyStatus(status) {
  return BUSY_STATUSES.has(String(status || "").toLowerCase());
}
