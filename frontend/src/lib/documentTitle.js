import { useEffect } from "react";

export const APP_NAME = "Studio";

// "{item} · {page} · {workspace} — Studio", leaving out any part that is missing.
export function formatDocumentTitle({ item = "", page = "", workspace = "" } = {}) {
  const parts = [];

  for (const part of [item, page, workspace]) {
    const text = String(part ?? "").trim();

    if (text) parts.push(text);
  }

  const context = parts.join(" · ");

  return context ? `${context} — ${APP_NAME}` : APP_NAME;
}

// Keeps document.title in step with the open page and selection (WCAG 2.4.2).
export function useDocumentTitle(parts) {
  const title = formatDocumentTitle(parts);

  useEffect(() => {
    document.title = title;
  }, [title]);

  return title;
}
