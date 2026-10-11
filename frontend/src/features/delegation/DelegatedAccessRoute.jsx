import React, { useCallback, useMemo, useState } from "react";
import { createAppRuntimeCore } from "../../lib/appRuntime";
import { createNotifier } from "../../lib/notify";
import { useDocumentTitle } from "../../lib/documentTitle.js";
import { AuthScreen } from "../auth/AuthScreen.jsx";
import { useAuthProfileController } from "../auth/useAuthProfileController.js";
import { LoadingState } from "../ui/States.jsx";
import { ApprovalPage } from "./ApprovalPage.jsx";
import { ConsentPage } from "./ConsentPage.jsx";
import { DelegatedCard } from "./DelegatedCard.jsx";
import { continuationPath, createDelegationRequests, oauthQueryFromSearch } from "./delegationRequests.js";
import { UploadPage } from "./UploadPage.jsx";

const TITLES = { "mcp-connect": "Connect app", "mcp-approval": "Approval request", "mcp-upload": "Upload a document" };

// Pages an MCP client links to. They are account-level: no Workspace is resolved or
// selected, and sign-in returns to the same page instead of the Workspace home.
export function DelegatedAccessRoute({
  route,
  configuration,
  createAuthClient,
  createDelegatedAuthClient,
  toast,
  navigateTo = (url) => window.location.assign(url),
}) {
  useDocumentTitle({ page: TITLES[route.page] });

  const isConnect = route.page === "mcp-connect";

  // The connect page's client carries the signed authorization request into sign-in.
  const authClient = useMemo(
    () => (isConnect ? createDelegatedAuthClient() : createAuthClient()),
    [isConnect, createAuthClient, createDelegatedAuthClient],
  );

  // Signing out must not carry the request, which may have expired by then.
  const signOutClient = useMemo(() => (isConnect ? createAuthClient() : authClient), [isConnect, authClient, createAuthClient]);
  const { data: session, isPending, refetch } = authClient.useSession();
  const [loginRequiredFor, setLoginRequiredFor] = useState("");
  const notify = useMemo(() => createNotifier(toast), [toast]);

  const userId = String(session?.user?.id || "");
  const sessionKey = userId ? `${userId}:${session?.session?.id || ""}:${session?.session?.impersonatedBy || ""}` : "";
  const isImpersonating = Boolean(session?.session?.impersonatedBy);
  const account = String(session?.user?.email || session?.user?.name || "").trim();
  const search = window.location.search;
  const oauthQuery = isConnect ? oauthQueryFromSearch(search) : "";

  const requests = useMemo(() => {
    const { request } = createAppRuntimeCore({ apiBase: "/v1", toast });

    // An ended session shows the sign-in form again; the page reloads once it is back.
    return createDelegationRequests(async (path, options) => {
      try {
        return await request(path, options);
      } catch (error) {
        if (error.status === 401) void refetch();

        throw error;
      }
    });
  }, [toast, refetch]);

  const { authScreen } = useAuthProfileController({
    toast,
    authOptions: configuration.auth,
    authClient,
    refetchSession: refetch,
    hasSession: Boolean(userId),
    sessionUserName: "",
    sessionUserEmail: "",
    continuationURL: continuationPath(route, search),
    onClearWorkspaceScopedTemplates: () => {},
    onClearWorkspaceScopedDocuments: () => {},
    onClearSessionWorkspaceData: () => {},
  });

  const requireLogin = useCallback(() => setLoginRequiredFor(sessionKey), [sessionKey]);

  async function signOut() {
    try {
      const result = await signOutClient.signOut();

      if (result?.error) throw new Error(result.error.message || "Sign out failed");

      await refetch();
    } catch (error) {
      notify("auth.signOut", "failure", { error });
    }
  }

  if (isPending) {
    return (
      <DelegatedCard eyebrow={TITLES[route.page]} title={TITLES[route.page]}>
        <LoadingState variant="panel" label="Loading…" />
      </DelegatedCard>
    );
  }

  if (!userId || (sessionKey && loginRequiredFor === sessionKey)) return <AuthScreen {...authScreen} />;

  // Keyed by session: switching account discards loaded requests and ignores late responses.
  if (isConnect) {
    return (
      <ConsentPage
        key={sessionKey}
        requests={requests}
        oauthQuery={oauthQuery}
        account={account}
        isImpersonating={isImpersonating}
        toast={toast}
        navigateTo={navigateTo}
        onLoginRequired={requireLogin}
        onSignOut={() => void signOut()}
      />
    );
  }

  if (route.page === "mcp-approval") {
    return (
      <ApprovalPage
        key={sessionKey}
        requests={requests}
        approvalId={route.approvalId}
        isImpersonating={isImpersonating}
        toast={toast}
      />
    );
  }

  return <UploadPage key={sessionKey} requests={requests} uploadId={route.uploadId} toast={toast} />;
}
