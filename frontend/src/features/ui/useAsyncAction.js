import { useCallback, useRef, useState } from "react";

// Each async action owns its pending state, so one request never disables
// unrelated controls. Returns [pending, run]; run ignores calls while pending.
export function useAsyncAction(action) {
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const latest = useRef(action);
  latest.current = action;

  const run = useCallback(async (...args) => {
    if (running.current) return undefined;

    running.current = true;
    setPending(true);

    try {
      return await latest.current(...args);
    } finally {
      running.current = false;
      setPending(false);
    }
  }, []);

  return [pending, run];
}
