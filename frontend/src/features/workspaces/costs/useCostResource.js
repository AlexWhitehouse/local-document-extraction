import { useCallback, useEffect, useState } from "react";

/** Scope by URL, abort obsolete requests, and poll only while the page is visible. */
export function useCostResource(request, path) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ path: "", data: null, loading: false, error: "" });
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!path) return undefined;
    let active = true, pending = false, controller;
    const load = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true; controller = new AbortController();
      setState(previous => ({ path, data: previous.path === path ? previous.data : null, loading: true, error: "" }));
      try {
        const data = await request(path, { method: "GET", cache: "no-store", signal: controller.signal });
        if (active) setState({ path, data, loading: false, error: "" });
      } catch (error) {
        if (active) setState({ path, data: null, loading: false, error: error.status === 401 || error.status === 403
          ? "Costs are available only to signed-in Workspace owners and admins."
          : "Cost history could not be loaded. Please retry." });
      } finally { pending = false; }
    };
    void load();
    const interval = setInterval(load, 30000);
    const onVisibility = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { active = false; controller?.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); };
  }, [request, path, attempt]);
  const current = state.path === path && path ? state : { data: null, loading: Boolean(path), error: "" };
  return { ...current, reload };
}
