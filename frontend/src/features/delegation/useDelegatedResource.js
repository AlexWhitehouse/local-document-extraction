import { useCallback, useEffect, useRef, useState } from "react";

// Loads one delegated-access resource for the current session. Pages using it are keyed
// by session, so a session change unmounts them: in-flight reads abort and late mutation
// results are dropped through isCurrent().
export function useDelegatedResource(load) {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const latestLoad = useRef(load);
  const mounted = useRef(true);
  latestLoad.current = load;

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();

    latestLoad
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: "ready", data, error: null });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ status: "error", data: null, error });
      });

    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState((previous) => (previous.status === "ready" ? previous : { status: "loading", data: null, error: null }));
    setAttempt((value) => value + 1);
  }, []);

  const replace = useCallback((data) => {
    if (mounted.current) setState({ status: "ready", data, error: null });
  }, []);

  const isCurrent = useCallback(() => mounted.current, []);

  return { ...state, reload, replace, isCurrent };
}
