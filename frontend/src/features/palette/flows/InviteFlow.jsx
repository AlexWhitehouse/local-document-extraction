import React, { useEffect, useRef, useState } from "react";
import { getWorkspaceMemberPermissions } from "../../../lib/workspaceSelection.js";
import { describeError } from "../../../lib/describeError";
import { Button } from "../../ui/Button.jsx";
import { Callout } from "../../ui/Callout.jsx";
import { Field, TextInput } from "../../ui/Field.jsx";
import { Segmented } from "../../ui/Tabs.jsx";
import { useAsyncAction } from "../../ui/useAsyncAction.js";
import { FlowStep } from "./flowParts.jsx";
import { useFinish, useFlowBack } from "./useFlowBack.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLES = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
];

// The same checks and wording as the invite form on the Workspaces page.
function emailProblem(value) {
  const email = value.trim();

  if (!email) return "Enter an email address.";

  return EMAIL_PATTERN.test(email) ? "" : "Enter an email address like name@example.com.";
}

/** Invite member: email and role, sent as a workspace invitation. Only owners and admins can invite. */
export function InviteFlow({ interpretation, context, onFinish, onBack, registerBack }) {
  const args = interpretation?.args ?? {};
  const [email, setEmail] = useState(args.email ?? "");
  const [role, setRole] = useState(args.role ?? "member");
  const [emailError, setEmailError] = useState("");
  const [error, setError] = useState("");
  const emailRef = useRef(null);
  const canInvite = getWorkspaceMemberPermissions(context.role).canManage;

  const finish = useFinish(onFinish);

  useEffect(() => emailRef.current?.focus(), []);

  const [sending, send] = useAsyncAction(async () => {
    const problem = emailProblem(email);
    setEmailError(problem);
    setError("");

    if (problem) {
      emailRef.current?.focus();

      return;
    }

    const address = email.trim();

    try {
      await context.request(`/workspaces/${encodeURIComponent(context.workspaceId)}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address, role }),
      });
    } catch (failure) {
      setError(describeError(failure, "Couldn't send the invitation. Try again."));

      return;
    }

    context.notify("workspaceInvitation.create", "success", { targetEmail: address });
    void context.workspaceController?.acceptedPage?.onRetryWorkspaceInvitations?.();
    finish();
  });

  // Esc can't leave while the invitation is being sent.
  useFlowBack(registerBack, () => sending);

  if (!canInvite)
    return (
      <FlowStep
        title="Invite member"
        subtitle={context.workspaceName}
        actions={
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
        }
      >
        <Callout tone="info">Only workspace owners and admins can invite members. Ask one of them to invite you.</Callout>
      </FlowStep>
    );

  return (
    <FlowStep
      title="Invite member"
      subtitle={context.workspaceName}
      actions={
        <>
          <Button variant="secondary" disabled={sending} onClick={onBack}>
            Cancel
          </Button>
          <Button type="submit" form="palette-invite-form" pending={sending} pendingLabel="Sending…">
            Send invitation
          </Button>
        </>
      }
    >
      <form
        id="palette-invite-form"
        noValidate
        className="palette-flow-form"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void send();
        }}
      >
        <Field label="Email" error={emailError}>
          <TextInput
            ref={emailRef}
            type="email"
            value={email}
            placeholder="e.g. sam@example.com"
            onChange={(event) => {
              setEmail(event.target.value);
              setEmailError("");
            }}
            onBlur={() => setEmailError(emailProblem(email))}
          />
        </Field>
        <div className="palette-flow-control">
          <span className="ui-field-label" aria-hidden="true">
            Role
          </span>
          <Segmented label="Role" items={ROLES} value={role} onChange={setRole} />
        </div>
      </form>
      {error ? (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      ) : null}
    </FlowStep>
  );
}
