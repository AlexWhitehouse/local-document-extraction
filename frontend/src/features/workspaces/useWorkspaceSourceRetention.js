import { useCallback, useEffect, useRef, useState } from "react";

const idle = (scope) => ({ scope, settings: null, loading: false, saving: false, error: "" });

/** Workspace source retention: owners/admins opt the Workspace out of retaining new originals. */
export function useWorkspaceSourceRetention({ coreRequest, workspaceId, sessionUserId, role, enabled }) {
  const scope = enabled && workspaceId && sessionUserId ? `${sessionUserId}:${workspaceId}` : "";
  const canManage = role === "owner" || role === "admin";
  const [state, setState] = useState(() => idle(scope));
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const path = `/workspaces/${encodeURIComponent(workspaceId)}/source-retention`;

  const load = useCallback(async () => {
    if (!scope) return;
    setState({ ...idle(scope), loading: true });
    try {
      const settings = await coreRequest(path, { method: "GET", cache: "no-store" });
      if (activeScope.current === scope) setState({ ...idle(scope), settings });
    } catch {
      if (activeScope.current === scope) setState({ ...idle(scope), error: "Document retention settings could not be loaded." });
    }
  }, [coreRequest, path, scope]);

  useEffect(() => {
    setState(idle(scope));
    void load();
  }, [load, scope]);

  const setRetainOriginals = useCallback(async (retain) => {
    if (!scope || !canManage) return;
    setState((previous) => ({ ...previous, saving: true, error: "" }));
    try {
      const settings = await coreRequest(path, {
        method: "PUT",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disabled: !retain }),
      });
      if (activeScope.current === scope) setState({ ...idle(scope), settings });
    } catch {
      if (activeScope.current === scope) setState((previous) => ({ ...previous, saving: false, error: "Document retention could not be updated. Try again." }));
    }
  }, [canManage, coreRequest, path, scope]);

  const visible = state.scope === scope ? state : idle(scope);
  return { ...visible, canManage, reload: load, setRetainOriginals };
}
