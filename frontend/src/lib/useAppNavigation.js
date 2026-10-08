import { useCallback, useEffect, useRef, useState } from "react";
import { parseAppRoute } from "./appRoutes";

const HISTORY_KEY = "studioNavigationIndex";

const currentLocation = () => window.location.pathname + window.location.search + window.location.hash;

const isPending = (value) => value instanceof Promise;

// Keep a rejected Back/Forward traversal on its original entry, preserving both
// directions of the browser's history instead of pushing a replacement entry.
export function useAppNavigation() {
  const [location, setLocation] = useState(currentLocation);
  const accepted = useRef({ location, index: window.history.state?.[HISTORY_KEY] ?? 0 });
  const restoring = useRef(false);
  const guard = useRef(null);
  const hasUnsavedChanges = useRef(false);
  const navigateRef = useRef(null);
  const approved = useRef(false);

  useEffect(() => {
    window.history.replaceState({ ...window.history.state, [HISTORY_KEY]: accepted.current.index }, "");

    function onPopState(event) {
      if (restoring.current) {
        restoring.current = false;

        return;
      }

      const next = currentLocation();
      const index = event.state?.[HISTORY_KEY];

      const verdict = approved.current ? true : guard.current?.(parseAppRoute(window.location.pathname));
      approved.current = false;

      // An asynchronous guard (an in-app confirmation) first returns to the accepted
      // entry, then navigates forward again once the user agrees.
      if (verdict === false || isPending(verdict)) {
        const traversal = Number.isInteger(index) && index !== accepted.current.index;

        if (isPending(verdict)) {
          const delta = traversal ? index - accepted.current.index : 0;

          verdict.then((allowed) => {
            if (!allowed) return;

            if (!delta) {
              navigateRef.current?.(next, { force: true });

              return;
            }

            // Repeat the original traversal so Back/Forward history stays intact.
            approved.current = true;
            window.history.go(delta);
          });
        }

        if (traversal) {
          restoring.current = true;
          window.history.go(accepted.current.index - index);
        } else {
          window.history.replaceState(
            { ...window.history.state, [HISTORY_KEY]: accepted.current.index },
            "",
            accepted.current.location,
          );
        }

        return;
      }

      accepted.current = { location: next, index: index ?? accepted.current.index + 1 };
      window.history.replaceState({ ...window.history.state, [HISTORY_KEY]: accepted.current.index }, "");
      setLocation(next);
    }

    function onBeforeUnload(event) {
      if (!hasUnsavedChanges.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  const navigate = useCallback((path, { replace = false, force = false } = {}) => {
    const url = new URL(path, window.location.origin);

    if (url.origin !== window.location.origin || restoring.current) return false;
    const next = url.pathname + url.search + url.hash;

    if (next === accepted.current.location) return true;

    if (!force) {
      const verdict = guard.current?.(parseAppRoute(url.pathname));

      if (isPending(verdict)) {
        verdict.then((allowed) => {
          if (allowed) navigateRef.current?.(next, { replace, force: true });
        });

        return false;
      }

      if (verdict === false) return false;
    }

    const index = accepted.current.index + (replace ? 0 : 1);
    window.history[replace ? "replaceState" : "pushState"]({ ...window.history.state, [HISTORY_KEY]: index }, "", next);
    accepted.current = { location: next, index };
    setLocation(next);

    return true;
  }, []);

  navigateRef.current = navigate;

  return {
    route: parseAppRoute(new URL(location, window.location.origin).pathname),
    location,
    navigate,
    guard,
    hasUnsavedChanges,
  };
}
