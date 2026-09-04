import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createDocumentReconciliation, documentScopeKey, EMPTY_DOCUMENT_SNAPSHOT } from "./documentReconciliation";

export function useDocumentReconciliation({ sessionId, workspaceId, enabled, requests, initialWorkspace, callbacks }) {
  const [reconciliation] = useState(() => createDocumentReconciliation({ initialWorkspace }));
  // Configure before paint, while keeping construction free of requests and
  // subscriptions. The render mask below never exposes the previous Workspace.
  useLayoutEffect(() => {
    reconciliation.configure({ sessionId, workspaceId, enabled, requests, callbacks });
  });
  useEffect(() => () => reconciliation.dispose(), [reconciliation]);
  const snapshot = useSyncExternalStore(reconciliation.subscribe, reconciliation.getSnapshot);
  const scopeKey = documentScopeKey(sessionId, workspaceId, enabled);
  return { reconciliation, snapshot: snapshot.scopeKey === scopeKey ? snapshot : EMPTY_DOCUMENT_SNAPSHOT };
}
