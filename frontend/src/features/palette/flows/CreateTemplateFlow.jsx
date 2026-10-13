import React, { useEffect, useMemo, useRef, useState } from "react";
import { applyGroups, templateColumns } from "../../../../../shared/templateAssistant.ts";
import { getDataTypeLabel, validateTemplateJsonPayload } from "../../templates/templateFields.js";
import { Button } from "../../ui/Button.jsx";
import { Callout } from "../../ui/Callout.jsx";
import { CheckboxField, Field, TextInput, Textarea } from "../../ui/Field.jsx";
import { Badge } from "../../ui/Status.jsx";
import { useAsyncAction } from "../../ui/useAsyncAction.js";
import { describeError } from "../../../lib/describeError";
import { pluralize } from "../../../lib/text.js";
import { FlowStep, FlowThinking } from "./flowParts.jsx";
import { useFinish, useFlowBack } from "./useFlowBack.js";
import { EMPTY_DRAFT, proposalError, requestProposal } from "./templateDrafts.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

// The proposed Template: every change group applied to an empty draft.
function proposedDraft(output) {
  try {
    return applyGroups(EMPTY_DRAFT, output.groups);
  } catch {
    return null;
  }
}

function fieldDetail(field) {
  const columns = templateColumns(field);
  const description = String(field.description || "").trim();

  return columns.length
    ? `${description} Columns: ${columns.map((column) => column.heading).join(", ")}.`.trim()
    : description;
}

/** Create template: describe the document, review the proposed name and fields, then create it. */
export function CreateTemplateFlow({ interpretation, context, onFinish, onBack, registerBack }) {
  const [step, setStep] = useState("describe");
  const [instruction, setInstruction] = useState(interpretation?.args?.instruction ?? "");
  const [requestError, setRequestError] = useState("");
  const [proposal, setProposal] = useState(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [createError, setCreateError] = useState("");
  const requestRef = useRef(null);
  const nameRef = useRef(null);
  const text = instruction.trim();

  const finish = useFinish(onFinish);

  useEffect(() => () => requestRef.current?.abort(), []);

  useFlowBack(registerBack, () => {
    // A create in progress can't be left half way.
    if (creating) return true;

    if (step === "thinking") requestRef.current?.abort();

    if (step === "describe") return false;
    setStep("describe");

    return true;
  });

  async function propose() {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setRequestError("");
    setCreateError("");
    setStep("thinking");

    try {
      const output = await requestProposal({
        request: context.request,
        draft: EMPTY_DRAFT,
        templateId: "",
        instructions: `Create a new template. ${text}`,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      const draft = proposedDraft(output);

      if (!draft?.fields.length) {
        setRequestError("No fields were proposed. Describe the document and the details to extract.");
        setStep("describe");

        return;
      }

      setProposal({ output, draft });
      setName(String(draft.name || ""));
      setNameError("");
      setSelected(new Set(draft.fields.map((_, index) => index)));
      setStep("proposal");
    } catch (error) {
      if (controller.signal.aborted) return;
      setRequestError(proposalError(error));
      setStep("describe");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  const fields = useMemo(
    () => (proposal ? proposal.draft.fields.filter((_, index) => selected.has(index)) : []),
    [proposal, selected],
  );

  const [creating, create] = useAsyncAction(async () => {
    setCreateError("");

    if (!name.trim()) {
      setNameError("Enter a template name.");
      nameRef.current?.focus();

      return;
    }

    let payload;

    try {
      payload = validateTemplateJsonPayload({
        name,
        description: proposal.draft.description || "",
        tags: [],
        fields,
      });
    } catch {
      setCreateError("These fields can’t be saved as they are. Ask for different fields or edit them after creating.");

      return;
    }

    let data;

    try {
      data = await context.request("/templates", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      });
    } catch (error) {
      setCreateError(describeError(error, "Couldn't create the template. Try again."));

      return;
    }

    const templateId = data?.template_id;
    const toast = { targetName: data?.name || payload.name };

    if (templateId)
      toast.link = {
        label: "Open template",
        onClick: () => context.navigate(context.appPath({ workspaceId: context.workspaceId, page: "templates", templateId })),
      };
    context.notify("template.create", "success", toast);
    void context.templateController?.actions?.listTemplates?.();
    void context.refreshCatalog?.();
    finish();
  });

  if (step === "thinking") return <FlowThinking label="Drafting fields…" />;

  if (step === "proposal" && proposal)
    return (
      <FlowStep
        title="New template"
        subtitle={`“${text}”`}
        note="You can change instructions and types in the template editor afterwards."
        actions={
          <>
            <Button
              variant="secondary"
              className="palette-flow-back"
              disabled={creating}
              onClick={() => setStep("describe")}
            >
              Back
            </Button>
            <Button pending={creating} pendingLabel="Creating…" disabled={!fields.length} onClick={() => void create()}>
              Create template
            </Button>
          </>
        }
      >
        <Field label="Name" error={nameError}>
          <TextInput
            ref={nameRef}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setNameError("");
            }}
            onBlur={() => setNameError(name.trim() ? "" : "Enter a template name.")}
          />
        </Field>
        <fieldset className="palette-flow-fields">
          <legend>Fields · {pluralize(fields.length, "field")} selected</legend>
          {proposal.draft.fields.map((field, index) => (
            <CheckboxField
              key={`${index}-${field.name}`}
              className="palette-flow-field"
              label={
                <>
                  {field.name} <Badge>{getDataTypeLabel(field.data_type)}</Badge>
                </>
              }
              description={fieldDetail(field)}
              checked={selected.has(index)}
              disabled={creating}
              onChange={(checked) => {
                const next = new Set(selected);

                if (checked) next.add(index);
                else next.delete(index);
                setSelected(next);
              }}
            />
          ))}
        </fieldset>
        {createError ? (
          <Callout tone="danger" role="alert">
            {createError}
          </Callout>
        ) : null}
      </FlowStep>
    );

  return (
    <FlowStep
      title="Create template"
      actions={
        <>
          <Button variant="secondary" onClick={onBack}>
            Cancel
          </Button>
          <Button disabled={!text || !context.modelReady} onClick={() => void propose()}>
            Propose fields
          </Button>
        </>
      }
    >
      {context.modelReady ? null : (
        <Callout tone="info">Proposals need a Model gateway. Set one up on the Workspaces page.</Callout>
      )}
      {requestError ? (
        <Callout tone="danger" role="alert" title={requestError}>
          No template was created.
        </Callout>
      ) : null}
      <Field label="Describe the document and what to extract">
        <Textarea
          rows={3}
          value={instruction}
          placeholder="e.g. Delivery notes with delivery date, driver name, items and signed"
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();

            if (text && context.modelReady) void propose();
          }}
        />
      </Field>
    </FlowStep>
  );
}
