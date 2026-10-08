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

// Runs discard checks in order. Each returns true, false or a promise of either; the
// result stays synchronous until a check needs to ask, so unguarded navigation is
// never delayed.
export function runDiscardChecks(checks, onAllowed = () => {}) {
  for (const [index, check] of checks.entries()) {
    const verdict = check();

    if (verdict === false) return false;

    if (verdict instanceof Promise) {
      return verdict.then(async (allowed) => {
        if (!allowed) return false;

        for (const rest of checks.slice(index + 1)) {
          if (!(await rest())) return false;
        }

        onAllowed();

        return true;
      });
    }
  }

  onAllowed();

  return true;
}
