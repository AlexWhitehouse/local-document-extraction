import { useCallback, useEffect, useState } from "react";

export const DOCUMENT_LAYOUTS = Object.freeze(["results", "side-by-side"]);

const DEFAULT_LAYOUT = "results";

export function documentViewingPreferenceKey(userId) {
  return `document-extraction.document-viewing.v1:${userId}`;
}

function readStoredLayout(userId) {
  if (!userId) return DEFAULT_LAYOUT;

  try {
    const stored = window.localStorage.getItem(documentViewingPreferenceKey(userId));

    return DOCUMENT_LAYOUTS.includes(stored) ? stored : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/**
 * The Document viewing preference: browser-local and keyed by Account. During impersonation the
 * impersonated Account's choice is shown, and changes last only for this page, never stored.
 */
export function useDocumentViewingPreference({ userId, readOnly = false }) {
  const [state, setState] = useState(() => ({ userId, layout: readStoredLayout(userId) }));
  const layout = state.userId === userId ? state.layout : readStoredLayout(userId);

  useEffect(() => {
    setState({ userId, layout: readStoredLayout(userId) });
  }, [userId]);

  const setLayout = useCallback(
    (next) => {
      if (!DOCUMENT_LAYOUTS.includes(next)) return;
      setState({ userId, layout: next });

      if (readOnly || !userId) return;

      try {
        window.localStorage.setItem(documentViewingPreferenceKey(userId), next);
      } catch {
        // Storage can be unavailable (private windows, blocked site data); the choice still applies here.
      }
    },
    [readOnly, userId],
  );

  return [layout, setLayout];
}

/** Maps retrieval failures to the Document pane's availability states. */
export function originalAvailability(error) {
  if (error?.code === "source_not_retained") return "not_retained";

  if (error?.code === "source_missing") return "missing";

  return "unavailable";
}

/**
 * Loads a retained original into memory for preview while `enabled`. The request is aborted and
 * the object URL revoked when the Document or visibility changes, so nothing outlives the pane.
 */
export function useDocumentOriginal({ documentId, enabled, loadOriginal }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ key: "", status: "idle", url: "", mimeType: "" });
  const key = enabled && documentId ? `${documentId}:${attempt}` : "";

  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    let url = "";
    setState({ key, status: "loading", url: "", mimeType: "" });
    loadOriginal(documentId, { signal: controller.signal }).then(
      ({ blob }) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setState({ key, status: "ready", url, mimeType: blob.type });
      },
      (error) => {
        if (controller.signal.aborted) return;
        setState({ key, status: originalAvailability(error), url: "", mimeType: "" });
      },
    );

    return () => {
      controller.abort();

      if (url) URL.revokeObjectURL(url);
    };
  }, [documentId, key, loadOriginal]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const visible = state.key === key ? state : { status: key ? "loading" : "idle", url: "", mimeType: "" };

  return { ...visible, retry };
}
