import { useCallback, useEffect, useRef } from "react";

/**
 * Registers an Esc/Back handler with the palette while the flow is mounted. `handle` returns true when
 * it stepped back inside the flow, or when a pending action must not be left; false lets the palette
 * leave the flow.
 */
export function useFlowBack(registerBack, handle) {
  const latest = useRef(handle);
  latest.current = handle;

  useEffect(() => {
    if (!registerBack) return undefined;
    registerBack(() => latest.current());

    return () => registerBack(null);
  }, [registerBack]);
}

/** `onFinish` that does nothing once the flow has unmounted, so a late response never closes the palette. */
export function useFinish(onFinish) {
  const mounted = useRef(false);
  const latest = useRef(onFinish);
  latest.current = onFinish;

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  return useCallback(() => {
    if (mounted.current) latest.current();
  }, []);
}
