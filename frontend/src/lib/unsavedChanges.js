import { useEffect, useId } from "react";

// Open editors register here while they hold unsaved edits, so navigation and page
// unload can warn without inspecting the DOM.
const dirtyEditors = new Map();

export function hasUnsavedEdits() {
  return dirtyEditors.size > 0;
}

export function unsavedEditLabels() {
  return [...dirtyEditors.values()];
}

export function useUnsavedGuard(isDirty, label) {
  const id = useId();
  useEffect(() => {
    if (!isDirty) return undefined;

    dirtyEditors.set(id, label);

    return () => {
      dirtyEditors.delete(id);
    };
  }, [id, isDirty, label]);
}
