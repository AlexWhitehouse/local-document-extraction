import React, { useEffect, useMemo, useState } from "react";
import { isString } from "../../../../shared/json.ts";
import { createNotifier } from "../../lib/notify";
import { copyWithFeedback } from "../../lib/copyWithFeedback";
import { CopyIcon } from "../layout/Icons.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import { Callout } from "../ui/Callout.jsx";
import { Field, TextInput } from "../ui/Field.jsx";
import { Badge } from "../ui/Status.jsx";
import { LoadingState } from "../ui/States.jsx";
import { useAsyncAction } from "../ui/useAsyncAction";
import { DelegatedCard, DelegatedLoadFailure, ImpersonationNotice } from "./DelegatedCard.jsx";
import { approvalGatewayUrl, clientName, formatDateTime, parameterRows } from "./delegationFormat.js";
import { useDelegatedResource } from "./useDelegatedResource.js";

const STATUS = {
  pending: { tone: "warning", label: "Waiting for you" },
  executing: { tone: "info", label: "Running" },
  completed: { tone: "success", label: "Completed" },
  denied: { tone: "neutral", label: "Denied" },
  expired: { tone: "neutral", label: "Expired" },
  failed: { tone: "danger", label: "Failed" },
};

const POLL_DELAYS_MS = [1000, 2000, 3000, 5000, 8000];

const UNAVAILABLE_CODES = new Set(["mcp_approval_not_found", "mcp_connection_revoked", "mcp_workspace_unavailable"]);

// Approval for one sensitive action an MCP client asked to perform. It shows exactly what will run.
export function ApprovalPage({ requests, approvalId, isImpersonating, toast }) {
  const approval = useDelegatedResource((signal) => requests.getApproval(approvalId, signal));
  const [polls, setPolls] = useState(0);
  const status = approval.data?.status;
  const reloadApproval = approval.reload;

  // A running action finishes on the server; check back with growing gaps.
  useEffect(() => {
    if (status !== "executing" || polls >= POLL_DELAYS_MS.length * 3) return undefined;

    const timer = setTimeout(
      () => {
        setPolls((value) => value + 1);
        reloadApproval();
      },
      POLL_DELAYS_MS[Math.min(polls, POLL_DELAYS_MS.length - 1)],
    );

    return () => clearTimeout(timer);
  }, [status, polls, reloadApproval]);

  if (approval.status === "loading") {
    return (
      <DelegatedCard eyebrow="Approval request" title="Approval request">
        <LoadingState variant="panel" label="Loading request…" />
      </DelegatedCard>
    );
  }

  if (approval.status === "error") {
    if (approval.error?.code === "mcp_impersonation_not_allowed") {
      return (
        <DelegatedCard eyebrow="Approval request" title="Approval request">
          <ImpersonationNotice>Stop impersonating to see this request. Only the account owner can decide it.</ImpersonationNotice>
        </DelegatedCard>
      );
    }

    const unavailable = UNAVAILABLE_CODES.has(approval.error?.code) || [403, 404].includes(approval.error?.status);

    return (
      <DelegatedCard eyebrow="Approval request" title={unavailable ? "Request unavailable" : "Approval request"}>
        {unavailable ? (
          <Callout tone="warning" role="alert">
            This request doesn&apos;t exist, belongs to another account, or its app was disconnected.
          </Callout>
        ) : (
          <DelegatedLoadFailure error={approval.error} fallback="Couldn't load this request." onRetry={approval.reload} />
        )}
      </DelegatedCard>
    );
  }

  return (
    <ApprovalDetails
      approval={approval.data}
      requests={requests}
      isImpersonating={isImpersonating}
      toast={toast}
      isCurrent={approval.isCurrent}
      onChange={approval.replace}
      onReload={approval.reload}
    />
  );
}

function ApprovalDetails({ approval, requests, isImpersonating, toast, isCurrent, onChange, onReload }) {
  const notify = useMemo(() => createNotifier(toast), [toast]);
  const name = clientName(approval.client);
  const title = approval.title || "Approval request";
  const status = STATUS[approval.status] || STATUS.failed;
  const targets = Array.isArray(approval.targets) ? approval.targets : [];
  const parameters = parameterRows(approval.parameters);
  const gatewayUrl = approvalGatewayUrl(approval.parameters);
  const secret = approval.requires_secret;
  const [secretValue, setSecretValue] = useState("");
  const [secretError, setSecretError] = useState("");
  const [isApproving, runApprove] = useAsyncAction(() => decide("approve"));
  const [isDenying, runDeny] = useAsyncAction(() => decide("deny"));
  const busy = isApproving || isDenying;

  async function decide(decision) {
    if (decision === "approve" && secret && !secretValue.trim()) {
      setSecretError(`Enter the ${secret.label || "secret"}.`);
      document.getElementById("approval-secret")?.focus();

      return;
    }

    const action = decision === "approve" ? "mcpApproval.approve" : "mcpApproval.deny";

    try {
      const body = decision === "approve" && secret ? { decision, secret: secretValue } : { decision };
      const next = await requests.decideApproval(approval.id, body);

      if (!isCurrent()) return;

      setSecretValue("");
      onChange(next);
      notify(action, "success", { targetName: title });
    } catch (error) {
      if (!isCurrent()) return;

      notify(action, "failure", { error });

      // An expired or changed request can't run any more; show its current state.
      if (["mcp_approval_stale", "mcp_approval_expired"].includes(error.code) || error.status === 409) onReload();
    }
  }

  return (
    <DelegatedCard
      eyebrow="Approval request"
      title={title}
      description={`${name} asks to do this in ${approval.workspace?.name || "a workspace"}.`}
      status={<Badge tone={status.tone}>{status.label}</Badge>}
    >
      {approval.description ? <p className="delegated-consequence">{approval.description}</p> : null}
      <dl className="delegated-facts">
        <div>
          <dt>App</dt>
          <dd>{name}</dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>{approval.workspace?.name || "—"}</dd>
        </div>
        {targets.length ? (
          <div>
            <dt>{targets.length === 1 ? "Target" : "Targets"}</dt>
            <dd>
              <ul className="delegated-targets">
                {targets.map((target) => (
                  <li key={target.id}>{target.label || target.id}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {gatewayUrl ? (
          <div>
            <dt>Gateway address</dt>
            <dd>
              <code>{gatewayUrl}</code>
            </dd>
          </div>
        ) : null}
        {parameters.map((row) => (
          <div key={row.name}>
            <dt>{row.name}</dt>
            <dd>
              <code>{row.value}</code>
            </dd>
          </div>
        ))}
        <div>
          <dt>Expires</dt>
          <dd>{formatDateTime(approval.expires_at)}</dd>
        </div>
      </dl>

      {approval.status === "pending" ? (
        <form
          className="delegated-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void runApprove();
          }}
        >
          {isImpersonating ? (
            <ImpersonationNotice>Only the account owner can approve or deny this request.</ImpersonationNotice>
          ) : null}
          {secret ? (
            <Field label={secret.label || "Secret"} hint="Studio keeps it. The app never sees it." error={secretError}>
              <TextInput
                id="approval-secret"
                type="password"
                autoComplete="off"
                value={secretValue}
                disabled={busy || isImpersonating}
                onChange={(event) => {
                  setSecretValue(event.target.value);
                  setSecretError("");
                }}
              />
            </Field>
          ) : null}
          <div className="actions delegated-actions">
            <Button
              variant="secondary"
              pending={isDenying}
              pendingLabel="Denying…"
              disabled={busy || isImpersonating}
              onClick={() => void runDeny()}
            >
              Deny
            </Button>
            <Button type="submit" pending={isApproving} pendingLabel="Approving…" disabled={busy || isImpersonating}>
              Approve
            </Button>
          </div>
        </form>
      ) : (
        <ApprovalOutcome approval={approval} name={name} toast={toast} />
      )}
    </DelegatedCard>
  );
}

function ApprovalOutcome({ approval, name, toast }) {
  if (approval.status === "executing") return <LoadingState variant="panel" label="Running…" />;

  if (approval.status === "completed") {
    const apiKey = isString(approval.result?.api_key) ? approval.result.api_key : "";

    return (
      <>
        <Callout tone="success">Done. {name} can continue.</Callout>
        {apiKey ? <OneTimeApiKey apiKey={apiKey} toast={toast} /> : null}
      </>
    );
  }

  if (approval.status === "denied") return <Callout tone="info">You denied this action. Nothing changed.</Callout>;

  if (approval.status === "expired")
    return <Callout tone="warning">This request expired before it was approved. Ask {name} to try again.</Callout>;

  return <Callout tone="danger">The action didn&apos;t complete. Check the workspace before asking {name} to try again.</Callout>;
}

// A rotated Workspace API key is shown here once. The app only learns that it changed.
function OneTimeApiKey({ apiKey, toast }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="ui-field delegated-key">
      <label htmlFor="approval-api-key" className="ui-field-label">
        New workspace API key
      </label>
      <div className="workspace-key-input">
        <TextInput id="approval-api-key" value={apiKey} readOnly />
        <IconButton
          size="sm"
          label="Copy API key"
          icon={CopyIcon}
          className="workspace-key-copy-button"
          onClick={async () => {
            if (await copyWithFeedback(toast, apiKey, "API key")) setCopied(true);
          }}
        />
      </div>
      {copied ? null : (
        <Callout tone="warning" role="status">
          This key won&apos;t be shown again. Copy it now.
        </Callout>
      )}
    </div>
  );
}
