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
