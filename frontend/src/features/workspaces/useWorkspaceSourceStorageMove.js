import { useCallback, useEffect, useRef, useState } from "react";

// A running move is checked this often.
export const MOVE_POLL_MS = 3000;

const UNITS = ["KB", "MB", "GB", "TB"];

/** A size such as "4.4 MB". Anything under 1 KB shows as 1 KB, except nothing at all. */
export function formatSize(bytes) {
  if (!bytes) return "0 KB";
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const shown = Math.max(value, 1);

  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: shown < 10 ? 1 : 0 }).format(shown)} ${UNITS[unit]}`;
}

// The move can't start or stop because the summary is out of date, so it reloads.
const RELOADS_AFTER = new Set([
  "source_storage_move_unavailable",
  "source_storage_move_running",
  "source_storage_move_nothing_to_move",
  "source_storage_move_not_running",
]);

// `polls` counts failed checks of a running move, so the next check is still scheduled.
const initialState = (scope) => ({ scope, summary: null, loading: false, error: "", polls: 0 });

/**
 * Where this Workspace's retained originals are, and moving them into its current location.
 * `scope` is empty for members, who never load it.
 */
export function useWorkspaceSourceStorageMove({ coreRequest, path, scope, showActionToast }) {
  const [state, setState] = useState(() => initialState(scope));
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const operation = useRef(0);
  const notify = useRef(showActionToast);
  notify.current = showActionToast;
  const movePath = `${path}/move`;

  const send = useCallback(
    (method) => {
      const options = { method, cache: "no-store", responseType: "resource-json" };

      // Starting a move takes an empty JSON body.
      if (method === "POST") {
        options.headers = { "content-type": "application/json" };
        options.body = "{}";
      }

      return coreRequest(movePath, options);
    },
    [coreRequest, movePath],
  );

  // `quiet` keeps the current summary on screen and ignores failures, for polling.
  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!scope) return;
      const token = ++operation.current;

      if (!quiet) setState((previous) => ({ ...previous, scope, loading: true, error: "" }));

      try {
        const response = await send("GET");

        if (activeScope.current === scope && token === operation.current)
          setState({ ...initialState(scope), summary: response?.data ?? null });
      } catch {
        if (activeScope.current !== scope || token !== operation.current) return;

        if (quiet) {
          setState((previous) => ({ ...previous, polls: previous.polls + 1 }));

          return;
        }

        setState((previous) => ({
          ...previous,
          loading: false,
          error: previous.summary ? "" : "Couldn't load where originals are stored.",
        }));
      }
    },
    [scope, send],
  );

  useEffect(() => {
    setState(initialState(scope));
    void load();

    return () => {
      operation.current += 1;
    };
  }, [load, scope]);

  const running = state.scope === scope && state.summary?.move?.status === "running";
  const moveVersion = state.summary?.move;
  const polls = state.polls;

  // A new summary schedules the next check, so polling stops once the move finishes or the panel closes.
  useEffect(() => {
    if (!running) return undefined;
    const timer = setTimeout(() => void load({ quiet: true }), MOVE_POLL_MS);

    return () => clearTimeout(timer);
  }, [running, moveVersion, polls, load]);

  // Starting and cancelling run inside a confirmation dialog, so failures throw for the dialog to show.
  const change = async (method, action) => {
    if (!scope) throw new Error("Storage settings aren't ready.");
    const token = ++operation.current;

    try {
      const response = await send(method);

      if (activeScope.current === scope && token === operation.current) {
        setState({ ...initialState(scope), summary: response?.data ?? null });
        notify.current?.(action, "success");
      }
    } catch (error) {
      if (activeScope.current === scope && token === operation.current && RELOADS_AFTER.has(error?.code))
        void load({ quiet: true });

      throw error;
    }
  };

  const visible = state.scope === scope ? state : initialState(scope);

  return {
    ...visible,
    running,
    start: () => change("POST", "workspace.sourceStorage.moveStart"),
    cancel: () => change("DELETE", "workspace.sourceStorage.moveCancel"),
    reload: load,
  };
}
