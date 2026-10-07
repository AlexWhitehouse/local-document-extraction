import { showToast } from "./notify";

// Copies text and reports the outcome with one toast. Resolves true when copied, so
// buttons can briefly show a check mark.
export async function copyWithFeedback(toast, value, label) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(toast, { severity: "success", message: `${label} copied` });

    return true;
  } catch {
    showToast(toast, { severity: "error", message: "Couldn't copy. Select the text and copy it manually." });

    return false;
  }
}
