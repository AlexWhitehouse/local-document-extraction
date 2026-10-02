import { locationKey } from "../../../../shared/templateAssistant.ts";

export function focusDiagnostic(root, location) {
  const key = locationKey(location);
  const input = Array.from(root?.querySelectorAll("[data-diagnostic-location]") || []).find(node => node.dataset.diagnosticLocation === key);
  input?.focus(); input?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}
