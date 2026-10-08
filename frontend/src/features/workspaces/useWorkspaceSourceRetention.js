import { useCallback, useEffect, useRef, useState } from "react";

const idle = (scope) => ({ scope, settings: null, loading: false, saving: false, error: "" });

/** Workspace source retention: owners/admins opt the Workspace out of retaining new originals. */
export function useWorkspaceSourceRetention({
  coreRequest,
  workspaceId,
  sessionUserId,
  role,
  enabled,
  showActionToast,
}) {
  const scope = enabled && workspaceId && sessionUserId ? `${sessionUserId}:${workspaceId}` : "";
  const canManage = role === "owner" || role === "admin";
  const [state, setState] = useState(() => idle(scope));
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const current = useRef(state);
  current.current = state;
  const pending = useRef(false);
  const notify = useRef(showActionToast);
  notify.current = showActionToast;
  const path = `/workspaces/${encodeURIComponent(workspaceId)}/source-retention`;

  const load = useCallback(async () => {
    if (!scope) return;
    setState({ ...idle(scope), loading: true });

    try {
      const settings = await coreRequest(path, { method: "GET", cache: "no-store" });

      if (activeScope.current === scope) setState({ ...idle(scope), settings });
    } catch {
      if (activeScope.current === scope)
        setState({ ...idle(scope), error: "Couldn't load document retention settings." });
    }
  }, [coreRequest, path, scope]);

  useEffect(() => {
    setState(idle(scope));
    void load();
  }, [load, scope]);

  const setRetainOriginals = useCallback(
    async (retain) => {
      if (!scope || !canManage || pending.current) return;
      const previousSettings = current.current.settings;
      pending.current = true;
      // The checkbox shows the new value at once; a failed save puts it back and says so in a toast.
      setState((previous) => ({
        ...previous,
        settings: previous.settings && { ...previous.settings, source_retention_disabled: !retain },
        saving: true,
        error: "",
      }));

      try {
        const settings = await coreRequest(path, {
          method: "PUT",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ disabled: !retain }),
        });

        if (activeScope.current === scope) {
          setState({ ...idle(scope), settings });
          notify.current?.("workspace.sourceRetention", "success", {
            enabled: settings?.source_retention_disabled === false,
          });
        }
      } catch {
        if (activeScope.current === scope) {
          setState((previous) => ({ ...previous, settings: previousSettings, saving: false }));
          notify.current?.("workspace.sourceRetention", "failure");
        }
      } finally {
        pending.current = false;
      }
    },
    [canManage, coreRequest, path, scope],
  );

  const visible = state.scope === scope ? state : idle(scope);

  return { ...visible, canManage, reload: load, setRetainOriginals };
}
