import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createNotifier } from "../../lib/notify";
import { Button } from "../ui/Button.jsx";
import { Callout } from "../ui/Callout.jsx";
import { CheckboxField, Field, Select } from "../ui/Field.jsx";
import { Badge } from "../ui/Status.jsx";
import { LoadingState } from "../ui/States.jsx";
import { useAsyncAction } from "../ui/useAsyncAction";
import { DelegatedCard, DelegatedLoadFailure, DelegatedSignedInAs } from "./DelegatedCard.jsx";
import { clientHost, clientName, provenanceLabel, scopeDescriptors } from "./delegationFormat.js";
import { consentRedirectTarget } from "./delegationRequests.js";
import { useDelegatedResource } from "./useDelegatedResource.js";

const REQUIRED_SCOPE = "workspace:read";

const OFFLINE_SCOPE = "offline_access";

const TERMINAL_CODES = new Set(["mcp_authorization_expired", "mcp_authorization_invalid", "mcp_disabled"]);

// Consent for one MCP client: pick one accepted workspace and the requested access to grant.
export function ConsentPage({ requests, oauthQuery, account, isImpersonating, toast, navigateTo, onLoginRequired, onSignOut }) {
  const consent = useDelegatedResource((signal) => requests.getConsent(oauthQuery, signal));
  const [terminalError, setTerminalError] = useState(null);
  const loginRequired = consent.data?.login_required === true;

  // A request that asks for a fresh sign-in goes back to the sign-in form; the server resumes it.
  useEffect(() => {
    if (loginRequired) onLoginRequired();
  }, [loginRequired, onLoginRequired]);

  if (consent.status === "loading") {
    return (
      <DelegatedCard eyebrow="Connect app" title="Connect app">
        <LoadingState variant="panel" label="Loading request…" />
      </DelegatedCard>
    );
  }

  const failure = terminalError || consent.error;

  if (failure && TERMINAL_CODES.has(failure.code)) return <ConsentUnavailable error={failure} />;

  if (consent.status === "error") {
    return (
      <DelegatedCard eyebrow="Connect app" title="Connect app">
        <DelegatedLoadFailure error={consent.error} fallback="Couldn't load this request." onRetry={consent.reload} />
      </DelegatedCard>
    );
  }

  if (loginRequired) return null;

  return (
    <ConsentForm
      consent={consent.data}
      requests={requests}
      oauthQuery={oauthQuery}
      account={account}
      isImpersonating={isImpersonating}
      toast={toast}
      navigateTo={navigateTo}
      isCurrent={consent.isCurrent}
      onTerminalError={setTerminalError}
      onSignOut={onSignOut}
    />
  );
}

function ConsentUnavailable({ error }) {
  const expired = error.code === "mcp_authorization_expired";
  const disabled = error.code === "mcp_disabled";

  return (
    <DelegatedCard
      eyebrow="Connect app"
      title={disabled ? "Connected apps are off" : expired ? "Request expired" : "Request not valid"}
    >
      <Callout tone="warning" role="alert">
        {disabled
          ? "Connected apps are turned off for this installation."
          : "Go back to your app and connect again."}
      </Callout>
    </DelegatedCard>
  );
}

function ConsentForm({
  consent,
  requests,
  oauthQuery,
  account,
  isImpersonating,
  toast,
  navigateTo,
  isCurrent,
  onTerminalError,
  onSignOut,
}) {
  const notify = useMemo(() => createNotifier(toast), [toast]);
  const name = clientName(consent.client);
  const host = clientHost(consent.client?.uri);
  const provenance = provenanceLabel(consent.client?.provenance);
  const workspaces = Array.isArray(consent.workspaces) ? consent.workspaces : [];
  const descriptors = scopeDescriptors(consent.scopes);
  const requested = Array.isArray(consent.requested_scopes) ? consent.requested_scopes : [];
  const offered = requested.flatMap((id) => (descriptors.has(id) ? [descriptors.get(id)] : []));
  const unrecognisedCount = requested.length - offered.length;
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [selected, setSelected] = useState(() => new Set(requested.filter((id) => id !== OFFLINE_SCOPE)));
  const [redirecting, setRedirecting] = useState(false);
  const workspaceRef = useRef(null);
  const capabilitiesId = useId();

  const [isAllowing, runAllow] = useAsyncAction(() => decide(true));
  const [isDenying, runDeny] = useAsyncAction(() => decide(false));
  const busy = isAllowing || isDenying || redirecting;

  async function decide(accept) {
    if (accept && !workspaceId) {
      setWorkspaceError("Choose a workspace.");
      workspaceRef.current?.focus();

      return;
    }

    const body = accept
      ? {
          oauth_query: oauthQuery,
          accept: true,
          workspace_id: workspaceId,
          scopes: offered.flatMap((scope) => (scope.id === REQUIRED_SCOPE || selected.has(scope.id) ? [scope.id] : [])),
        }
      : { oauth_query: oauthQuery, accept: false };

    try {
      const result = await requests.submitConsent(body);

      if (!isCurrent()) return;

      const target = consentRedirectTarget(result?.redirect_uri);

      if (!target) {
        onTerminalError({ code: "mcp_authorization_invalid" });

        return;
      }

      setRedirecting(true);
      navigateTo(target);
    } catch (error) {
      if (!isCurrent()) return;

      if (TERMINAL_CODES.has(error.code)) {
        onTerminalError(error);

        return;
      }

      notify(accept ? "mcpConsent.allow" : "mcpConsent.deny", "failure", { error });
    }
  }

  if (redirecting) {
    return (
      <DelegatedCard eyebrow="Connect app" title={`Connect ${name}`}>
        <LoadingState variant="panel" label={`Returning to ${name}…`} />
      </DelegatedCard>
    );
  }

  return (
    <DelegatedCard eyebrow="Connect app" title={`Connect ${name}`} description={`${name} wants to act for you in Studio.`}>
      <dl className="delegated-facts">
        <div>
          <dt>App</dt>
          <dd>
            <span>{name}</span>
            {host ? <span className="muted">{host}</span> : null}
            <Badge tone={provenance.tone}>{provenance.label}</Badge>
          </dd>
        </div>
      </dl>
      <DelegatedSignedInAs account={account} disabled={busy} onSignOut={onSignOut} />
      {isImpersonating ? (
        <Callout tone="warning" title="You're impersonating this user">
          You can deny this request, but only the account owner can connect apps.
        </Callout>
      ) : null}

      <form
        className="delegated-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void runAllow();
        }}
      >
        {workspaces.length ? (
          <Field label="Workspace" hint={`${name} can only use this workspace.`} error={workspaceError}>
            <Select
              ref={workspaceRef}
              value={workspaceId}
              disabled={busy}
              onChange={(event) => {
                setWorkspaceId(event.target.value);
                setWorkspaceError("");
              }}
            >
              <option value="">Choose a workspace</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Callout tone="warning">You don&apos;t have a workspace to share. Create one in Studio, then connect again.</Callout>
        )}

        {offered.length ? (
          <fieldset className="delegated-capabilities" aria-describedby={capabilitiesId} disabled={busy}>
            <legend>Access</legend>
            <p id={capabilitiesId} className="ui-field-hint">
              Your workspace role still applies. Actions marked for approval wait for you in Studio.
            </p>
            {offered.map((scope) => (
              <CheckboxField
                key={scope.id}
                label={
                  <>
                    {scope.label || scope.id}
                    {scope.requires_approval ? <Badge tone="warning">Needs approval</Badge> : null}
                  </>
                }
                description={scope.description}
                checked={scope.id === REQUIRED_SCOPE || selected.has(scope.id)}
                disabled={scope.id === REQUIRED_SCOPE}
                onChange={(checked) =>
                  setSelected((previous) => {
                    const next = new Set(previous);

                    if (checked) next.add(scope.id);
                    else next.delete(scope.id);

                    return next;
                  })
                }
              />
            ))}
          </fieldset>
        ) : null}
        {unrecognisedCount > 0 ? (
          <p className="muted">
            {name} also asked for access Studio doesn&apos;t offer. It won&apos;t be granted.
          </p>
        ) : null}

        <div className="actions delegated-actions">
          <Button variant="secondary" pending={isDenying} pendingLabel="Denying…" disabled={busy} onClick={() => void runDeny()}>
            Deny
          </Button>
          <Button
            type="submit"
            pending={isAllowing}
            pendingLabel="Connecting…"
            disabled={busy || isImpersonating || !workspaces.length}
          >
            Allow access
          </Button>
        </div>
      </form>
    </DelegatedCard>
  );
}
