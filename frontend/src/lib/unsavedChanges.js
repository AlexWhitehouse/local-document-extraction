import { useEffect, useId, useRef } from "react";
import { DISCARD_CHANGES, confirmDialog } from "../features/ui/confirm.jsx";

// Open editors register here while they hold unsaved edits, so navigation and page
// unload can warn without inspecting the DOM. The page-unload prompt is installed only
// while at least one editor is registered.
const dirtyEditors = new Map();

function warnBeforeUnload(event) {
  event.preventDefault();
  event.returnValue = "";
}

function register(id, editor) {
  dirtyEditors.set(id, editor);

  if (dirtyEditors.size === 1) window.addEventListener("beforeunload", warnBeforeUnload);
}

function unregister(id) {
  if (dirtyEditors.delete(id) && dirtyEditors.size === 0) window.removeEventListener("beforeunload", warnBeforeUnload);
}

export function hasUnsavedEdits() {
  return dirtyEditors.size > 0;
}

export function unsavedEditLabels() {
  return [...dirtyEditors.values()].map((editor) => editor.label);
}

/**
 * Registers an editor while `isDirty`. `leaves(route)` says whether navigating to a
 * parsed app route would lose the edits; it defaults to every navigation. Return false
 * from it for state whose owner asks separately, so it only blocks page unload.
 * `onDiscard` runs once the user agrees to leave.
 */
export function useUnsavedGuard(isDirty, label, { leaves, onDiscard } = {}) {
  const id = useId();
  const callbacks = useRef({ leaves, onDiscard });

  useEffect(() => {
    callbacks.current = { leaves, onDiscard };
  });

  useEffect(() => {
    if (!isDirty) return undefined;

    register(id, {
      label,
      leaves: (route) => callbacks.current.leaves?.(route) ?? true,
      discard: () => callbacks.current.onDiscard?.(),
    });

    return () => {
      unregister(id);
    };
  }, [id, isDirty, label]);
}

// The editors a navigation to `route` would lose. `confirm` asks once for all of them and
// stays synchronous when nothing would be lost. Call `discard` only after every other
// check has also allowed the navigation, so a later refusal keeps the edits.
export function unsavedEditsLeavingFor(route) {
  const leaving = [...dirtyEditors.values()].filter((editor) => editor.leaves(route));

  return {
    confirm: () => !leaving.length || confirmDialog(DISCARD_CHANGES),
    discard: () => {
      for (const editor of leaving) editor.discard();
    },
  };
}

export function confirmLeavingUnsavedEdits(route) {
  const leaving = unsavedEditsLeavingFor(route);

  return runDiscardChecks([leaving.confirm], leaving.discard);
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
