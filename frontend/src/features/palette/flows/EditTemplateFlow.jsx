import React, { useEffect, useMemo, useRef, useState } from "react";
import { diagnoseTemplateDraft, evaluateSelection } from "../../../../../shared/templateAssistant.ts";
import { ChangeGroup, SelectionCheck } from "../../templates/TemplateAssistant.jsx";
import "../../templates/TemplateAssistant.css";
import { suggestTemplateRequests } from "../../templates/templateAssistantSuggestions.js";
import { TemplateIcon } from "../../layout/Icons.jsx";
import { Button } from "../../ui/Button.jsx";
import { Callout } from "../../ui/Callout.jsx";
import { Field, TextInput, Textarea } from "../../ui/Field.jsx";
import { Skeleton } from "../../ui/States.jsx";
import { Badge } from "../../ui/Status.jsx";
import { useAsyncAction } from "../../ui/useAsyncAction.js";
import { describeError } from "../../../lib/describeError";
import { pluralize } from "../../../lib/text.js";
import { FlowStep, FlowThinking, PickList } from "./flowParts.jsx";
import { useFinish, useFlowBack } from "./useFlowBack.js";
import {
  editorDraft,
  proposalError,
  requestProposal,
  requestSuggestions,
  templateSavePayload,
  toggleGroup,
} from "./templateDrafts.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Edit template: choose it, describe the change, review the proposal, then save it or open it in the editor. */
export function EditTemplateFlow({ interpretation, context, onFinish, onBack, registerBack }) {
  const args = interpretation?.args ?? {};
  const templates = context.catalog?.templates ?? [];
  const [templateId, setTemplateId] = useState(args.template_id ?? "");
  const [step, setStep] = useState(args.template_id ? "describe" : "pick");
  const [instruction, setInstruction] = useState(args.instruction ?? "");
  const [requestError, setRequestError] = useState("");
  const [proposal, setProposal] = useState(null);
  const [refinement, setRefinement] = useState("");
  const [saveError, setSaveError] = useState("");
  const loaded = useSavedTemplate(context.request, templateId);
  const suggestions = useSuggestions(context, loaded, step === "describe");
  const requestRef = useRef(null);
  const catalogTemplate = templates.find((template) => template.id === templateId);
  const template = loaded.template;
  const name = template?.name || catalogTemplate?.name || "template";
  const version = template?.current_version ?? catalogTemplate?.current_version ?? null;

  const finish = useFinish(onFinish);

  useEffect(() => () => requestRef.current?.abort(), []);

  // A request that names the template and the change goes straight to a proposal, once.
  const autoProposed = useRef(false);

  useEffect(() => {
    if (autoProposed.current || !args.template_id || !args.instruction?.trim() || !loaded.draft) return;
    autoProposed.current = true;
    propose(args.instruction.trim());
    // propose reads the latest draft; it only runs for the first loaded draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded.draft]);

  useFlowBack(registerBack, () => {
    // A save in progress can't be left half way.
    if (saving) return true;

    if (step === "thinking") {
      requestRef.current?.abort();
      setStep(proposal ? "proposal" : "describe");

      return true;
    }

    if (step === "proposal") {
      setStep("describe");

      return true;
    }

    if (step === "describe" && !args.template_id) {
      setStep("pick");

      return true;
    }

    return false;
  });

  const selection = useMemo(
    () => (proposal ? evaluateSelection(proposal.base, proposal.output.groups, proposal.selectedIds) : null),
    [proposal],
  );

  const saveBody = useMemo(() => {
    if (!selection?.canApply || !template) return null;

    try {
      return templateSavePayload(template, selection.result);
    } catch {
      return null;
    }
  }, [selection, template]);

  async function propose(text) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setInstruction(text);
    setRequestError("");
    setSaveError("");
    setStep("thinking");

    try {
      const output = await requestProposal({
        request: context.request,
        draft: loaded.draft,
        templateId,
        instructions: text,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      setProposal({ output, base: loaded.draft, selectedIds: new Set(output.groups.map((group) => group.id)) });
      setRefinement("");
      setStep("proposal");
    } catch (error) {
      if (controller.signal.aborted) return;
      setRequestError(proposalError(error));
      setStep("describe");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  const [saving, save] = useAsyncAction(async () => {
    setSaveError("");

    if (!saveBody || !Object.keys(saveBody).length) {
      setSaveError("These changes match the saved template.");

      return;
    }

    try {
      await context.request(`/templates/${encodeURIComponent(templateId)}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify(saveBody),
      });
    } catch (error) {
      setSaveError(describeError(error, "Couldn't save the template. Try again."));

      return;
    }

    context.notify("template.save", "success", { targetName: saveBody.name ?? name });
    refreshAfterSave(context, templateId);
    finish();
  });

  // Edits open elsewhere in the editor are only discarded on request. The draft is prepared once
  // the editor is on its way, so "Keep editing" leaves nothing behind and returns to the proposal.
  function openInEditor() {
    const intent = { templateId, draft: selection.result };
    const path = context.appPath({ workspaceId: context.workspaceId, page: "templates", templateId });

    void context.confirmNavigation(path).then((allowed) => {
      if (!allowed || !context.navigate(path, { force: true })) return;
      context.templateController.actions.prepareDraft(intent);
      finish();
    });
  }

  if (step === "pick")
    return (
      <PickList
        label="Which template?"
        placeholder="Filter templates"
        emptyMessage="No templates match."
        items={templates.map((item) => ({
          id: item.id,
          label: item.name,
          detail: `v${item.current_version} · ${pluralize(item.fields.length, "field")}`,
          icon: TemplateIcon,
        }))}
        onPick={(item) => {
          setTemplateId(item.id);
          setProposal(null);
          setRequestError("");
          setStep("describe");
        }}
      />
    );

  if (step === "thinking") return <FlowThinking label={`Working out changes to ${name}${version ? ` v${version}` : ""}…`} />;

  if (step === "proposal" && proposal) {
    const { output } = proposal;
    const count = selection.selected.reduce((sum, group) => sum + group.operations.length, 0);
    const bumpsVersion = Boolean(saveBody?.fields) && version;
    const refine = refinement.trim();

    return (
      <FlowStep
        title="Proposed changes"
        badge={<Badge>{version ? `${name} v${version}` : name}</Badge>}
        subtitle={`“${instruction}”`}
        actions={
          <>
            <Button
              variant="secondary"
              className="palette-flow-back"
              disabled={saving}
              onClick={() => setStep("describe")}
            >
              Back
            </Button>
            {output.groups.length ? (
              <>
                <Button variant="secondary" disabled={!selection.canApply || saving} onClick={openInEditor}>
                  Open in editor
                </Button>
                <Button pending={saving} pendingLabel="Saving…" disabled={!saveBody} onClick={() => void save()}>
                  {bumpsVersion ? `Save ${pluralize(count, "change")} as v${version + 1}` : `Save ${pluralize(count, "change")}`}
                </Button>
              </>
            ) : null}
          </>
        }
      >
        <p className="palette-flow-explain">{output.explanation}</p>
        {output.groups.length ? (
          <div className="template-assistant-groups">
            {output.groups.map((group) => (
              <ChangeGroup
                key={group.id}
                base={proposal.base}
                group={group}
                groups={output.groups}
                disabled={saving}
                selected={proposal.selectedIds.has(group.id)}
                isConflicting={selection.conflicting.some((entry) => entry.id === group.id)}
                onToggle={() =>
                  setProposal({ ...proposal, selectedIds: toggleGroup(output.groups, proposal.selectedIds, group.id) })
                }
              />
            ))}
            <SelectionCheck selection={selection} baseHadIssues={diagnoseTemplateDraft(proposal.base).length > 0} />
          </div>
        ) : (
          <p className="palette-flow-muted">No changes proposed. Ask for something different.</p>
        )}
        <form
          className="palette-flow-inline-form"
          onSubmit={(event) => {
            event.preventDefault();

            if (refine) void propose(`${instruction}\n${refine}`);
          }}
        >
          <Field label="Ask for something different">
            <TextInput
              value={refinement}
              placeholder="e.g. Keep the full address as well"
              onChange={(event) => setRefinement(event.target.value)}
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={!refine || saving}>
            Ask again
          </Button>
        </form>
        {saveError ? (
          <Callout tone="danger" role="alert">
            {saveError}
          </Callout>
        ) : null}
      </FlowStep>
    );
  }

  const ready = loaded.status === "ready";
  const text = instruction.trim();

  return (
    <FlowStep
      title={`Edit ${name}`}
      badge={version ? <Badge>v{version}</Badge> : null}
      subtitle={ready ? pluralize(loaded.draft.fields.length, "field") : null}
      note="You’ll review each change before it’s saved."
      actions={
        <>
          <Button variant="secondary" onClick={onBack}>
            Cancel
          </Button>
          <Button disabled={!ready || !text || !context.modelReady} onClick={() => void propose(text)}>
            Propose changes
          </Button>
        </>
      }
    >
      {context.modelReady ? null : (
        <Callout tone="info">Proposals need a Model gateway. Set one up on the Workspaces page.</Callout>
      )}
      {loaded.status === "error" ? (
        <Callout
          tone="danger"
          role="alert"
          action={
            <Button variant="secondary" onClick={loaded.reload}>
              Try again
            </Button>
          }
        >
          {loaded.error}
        </Callout>
      ) : null}
      {requestError ? (
        <Callout tone="danger" role="alert" title={requestError}>
          The template wasn’t changed.
        </Callout>
      ) : null}
      <Field label="What should change?">
        <Textarea
          rows={3}
          value={instruction}
          placeholder="e.g. Split the billing address into street, town and postcode"
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();

            if (ready && text && context.modelReady) void propose(text);
          }}
        />
      </Field>
      {loaded.status === "loading" ? <Skeleton rows={1} height={24} label="Loading the template…" /> : null}
      {suggestions.length ? (
        <div className="palette-flow-chips" aria-label="Suggestions" role="group">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.request}
              type="button"
              className="palette-flow-chip"
              title={suggestion.reason}
              aria-pressed={instruction === suggestion.request}
              onClick={() => setInstruction(suggestion.request)}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      ) : null}
    </FlowStep>
  );
}

// The saved Template and the editor-shaped draft built from it.
function useSavedTemplate(request, templateId) {
  const [state, setState] = useState({ id: "", status: "idle", template: null, draft: null, error: "" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!templateId) return undefined;
    const controller = new AbortController();
    setState({ id: templateId, status: "loading", template: null, draft: null, error: "" });
    request(`/templates/${encodeURIComponent(templateId)}`, { method: "GET", signal: controller.signal })
      .then((template) => {
        if (!controller.signal.aborted)
          setState({ id: templateId, status: "ready", template, draft: editorDraft(template), error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            id: templateId,
            status: "error",
            template: null,
            draft: null,
            error: describeError(error, "Couldn't load the template."),
          });
      });

    return () => controller.abort();
  }, [request, templateId, attempt]);

  const current = state.id === templateId ? state : { status: templateId ? "loading" : "idle", template: null, draft: null };

  return { ...current, reload: () => setAttempt((value) => value + 1) };
}

// Two or three requests to offer as chips: the model's when available, otherwise the app's checks.
function useSuggestions(context, loaded, active) {
  const [suggestions, setSuggestions] = useState([]);
  const { request, modelReady } = context;
  const draft = active && loaded.status === "ready" ? loaded.draft : null;

  useEffect(() => {
    if (!draft) return undefined;
    const controller = new AbortController();

    const fallback = () =>
      setSuggestions(suggestTemplateRequests({ draft, issues: diagnoseTemplateDraft(draft) }).slice(0, 3));

    if (!modelReady) {
      fallback();

      return undefined;
    }

    requestSuggestions({ request, draft, signal: controller.signal })
      .then((items) => {
        if (controller.signal.aborted) return;

        if (items.length) setSuggestions(items);
        else fallback();
      })
      .catch(() => {
        if (!controller.signal.aborted) fallback();
      });

    return () => controller.abort();
  }, [draft, request, modelReady]);

  return draft ? suggestions : [];
}

// Lists and the catalogue refresh in the background; an open, unedited editor reloads the new version.
function refreshAfterSave(context, templateId) {
  const controller = context.templateController;
  void controller?.actions?.listTemplates?.();
  void context.refreshCatalog?.();

  if (controller?.toolbar?.selectedTemplateId === templateId && !controller.navigation?.hasUnsavedChanges)
    void controller.navigation.retry();
}
