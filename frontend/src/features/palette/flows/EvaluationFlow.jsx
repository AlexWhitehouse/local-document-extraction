import React, { useEffect, useMemo, useRef, useState } from "react";
import { MAX_CANDIDATES } from "../../evaluations/useEvaluations.js";
import { Button } from "../../ui/Button.jsx";
import { Callout } from "../../ui/Callout.jsx";
import { CheckboxField, Field, Select } from "../../ui/Field.jsx";
import { describeError } from "../../../lib/describeError";
import { pluralize } from "../../../lib/text.js";
import { FlowStep, FlowThinking } from "./flowParts.jsx";
import { useFinish, useFlowBack } from "./useFlowBack.js";

function modelNames(setupModel, catalogModels) {
  return [...new Set([setupModel, ...catalogModels].flatMap((model) => (model?.trim() ? [model.trim()] : [])))];
}

/**
 * Run evaluation: choose a template and models, then open the Evaluations page with one candidate per
 * model. Documents are added there, because evaluation documents live only in this browser session.
 */
export function EvaluationFlow({ interpretation, context, onFinish, onBack, registerBack }) {
  const evaluation = context.evaluation;
  const evaluationRef = useRef(evaluation);
  evaluationRef.current = evaluation;
  const templates = context.catalog?.templates ?? [];
  const models = modelNames(evaluation?.state?.setup?.model, context.catalog?.models ?? []);
  // Until you choose, the defaults follow the catalogue and setup, which may still be loading.
  const [chosenTemplateId, setTemplateId] = useState(null);
  const [chosenModels, setChosen] = useState(null);
  const templateId = chosenTemplateId ?? (interpretation?.args?.template_id || templates[0]?.id || "");
  const defaultModel = models[0];
  const chosen = useMemo(() => chosenModels ?? new Set(defaultModel ? [defaultModel] : []), [chosenModels, defaultModel]);
  const [phase, setPhase] = useState("form");
  const [error, setError] = useState("");
  const startedRef = useRef(false);
  // Bumped when a setup is cancelled, so a template that loads afterwards starts nothing.
  const runRef = useRef(0);
  const finish = useFinish(onFinish);
  const { setup, error: loadError } = evaluation?.state ?? {};
  const template = templates.find((item) => item.id === templateId);

  useFlowBack(registerBack, () => {
    if (phase !== "waiting") return false;
    startedRef.current = true;
    runRef.current += 1;
    setPhase("form");

    return true;
  });

  useEffect(() => () => {
    runRef.current += 1;
  }, []);

  const openEvaluations = () =>
    context.navigate(context.appPath({ workspaceId: context.workspaceId, page: "evaluations" }));

  // The Evaluations page loads its setup once it is open; candidates are created after that.
  useEffect(() => {
    if (phase !== "waiting" || startedRef.current) return;

    if (!setup) {
      if (loadError) {
        setError(loadError);
        setPhase("form");
      }

      return;
    }

    startedRef.current = true;

    if (!setup.configured) {
      setError("Evaluations need a Model gateway. Set one up on the Workspaces page.");
      setPhase("form");

      return;
    }

    const run = runRef.current;

    void (async () => {
      try {
        const response = await evaluationRef.current.api(`/evaluations/templates/${encodeURIComponent(templateId)}`);
        const loaded = await response.json();

        if (run !== runRef.current) return;
        const tested = { ...loaded, source: { id: templateId, version: Number(loaded.current_version) } };

        evaluationRef.current.start(
          "models",
          [...chosen].map((model) => ({ template: tested, model })),
        );
        context.notify("evaluation.setUp", "success", { targetName: loaded.name });
        finish();
      } catch (failure) {
        if (run !== runRef.current) return;
        setError(describeError(failure, "Couldn't set up the evaluation. Try again."));
        setPhase("form");
      }
    })();
  }, [phase, setup, loadError, templateId, chosen, context, finish]);

  if (phase === "waiting") return <FlowThinking label="Setting up the evaluation…" />;

  if (evaluation?.state?.candidates?.length)
    return (
      <FlowStep
        title="Run evaluation"
        actions={
          <>
            <Button variant="secondary" onClick={onBack}>
              Back
            </Button>
            <Button
              onClick={() => {
                openEvaluations();
                finish();
              }}
            >
              Open evaluations
            </Button>
          </>
        }
      >
        <Callout tone="info">An evaluation is already open. Continue it on the Evaluations page.</Callout>
      </FlowStep>
    );

  const begin = () => {
    // Fix the defaults now: the workspace model arriving with the setup mustn't change the choice.
    setTemplateId(templateId);
    setChosen(chosen);
    setError("");
    startedRef.current = false;
    setPhase("waiting");
    openEvaluations();
  };

  return (
    <FlowStep
      title="Run evaluation"
      note="Add documents with expected answers on the Evaluations page, then run it."
      actions={
        <>
          <Button variant="secondary" onClick={onBack}>
            Cancel
          </Button>
          {models.length ? (
            <Button disabled={!template || !chosen.size} onClick={begin}>
              Set up evaluation
            </Button>
          ) : (
            <Button
              onClick={() => {
                openEvaluations();
                finish();
              }}
            >
              Open evaluations
            </Button>
          )}
        </>
      }
    >
      {error ? (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      ) : null}
      <Field label="Template">
        <Select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
          {templates.length ? null : <option value="">No templates yet</option>}
          {templates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} v{item.current_version}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="palette-flow-fields">
        <legend>Models · {pluralize(chosen.size, "candidate")}</legend>
        {models.length ? (
          models.map((model) => (
            <CheckboxField
              key={model}
              label={model}
              checked={chosen.has(model)}
              disabled={!chosen.has(model) && chosen.size >= MAX_CANDIDATES}
              onChange={(checked) => {
                const next = new Set(chosen);

                if (checked) next.add(model);
                else next.delete(model);
                setChosen(next);
              }}
            />
          ))
        ) : (
          <p className="palette-flow-muted">No models used yet. Choose models on the Evaluations page.</p>
        )}
      </fieldset>
    </FlowStep>
  );
}
