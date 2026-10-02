import { useCallback, useEffect, useRef, useState } from "react";

const initial = (scope) => ({ scope, settings: null, loading: false, saving: false, error: "" });

/** Workspace policy is authoritative for every upload; each accepted request captures its own copy. */
export function useWorkspaceDocumentProcessingSettings({ coreRequest, workspaceId, sessionUserId, role, enabled }) {
  const scope = enabled && workspaceId && sessionUserId ? `${sessionUserId}:${workspaceId}:${role}` : "";
  const canManage = role === "owner" || role === "admin";
  const [state, setState] = useState(() => initial(scope));
  const activeScope = useRef(scope);
  const current = useRef(state);
  const operation = useRef(0);
  const pendingMutation = useRef(false);
  activeScope.current = scope;
  current.current = state;
  const path = `/workspaces/${encodeURIComponent(workspaceId)}/document-processing-settings`;

  const reload = useCallback(async () => {
    if (!scope || pendingMutation.current) return;
    const token = ++operation.current;
    setState((previous) => ({ ...(previous.scope === scope ? previous : initial(scope)), loading: true, error: "" }));
    try {
      const settings = await coreRequest(path, { method: "GET", cache: "no-store" });
      if (activeScope.current === scope && token === operation.current) setState({ ...initial(scope), settings });
    } catch {
      if (activeScope.current === scope && token === operation.current) setState({ ...initial(scope), error: "Document processing settings could not be loaded." });
    }
  }, [coreRequest, path, scope]);

  useEffect(() => {
    pendingMutation.current = false;
    setState(initial(scope));
    void reload();
    return () => { operation.current += 1; };
  }, [reload, scope]);

  const update = async (field, value) => {
    if (!scope || !canManage || pendingMutation.current || current.current.scope !== scope || !current.current.settings) return;
    if (!["enable_smart_splitting", "exclude_blank_pages"].includes(field) || typeof value !== "boolean") return;
    const settings = { ...current.current.settings, [field]: value };
    const token = ++operation.current;
    pendingMutation.current = true;
    setState((previous) => ({ ...previous, saving: true, loading: false, error: "" }));
    try {
      const saved = await coreRequest(path, {
        method: "PUT", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(settings),
      });
      if (activeScope.current === scope && token === operation.current) setState({ ...initial(scope), settings: saved });
    } catch {
      if (activeScope.current === scope && token === operation.current) setState((previous) => ({ ...previous, saving: false, error: "Document processing settings could not be saved. Try again." }));
    } finally {
      if (activeScope.current === scope && token === operation.current) pendingMutation.current = false;
    }
  };

  return { ...(state.scope === scope ? state : initial(scope)), canManage, reload, update };
}
