import React, { useEffect, useState } from "react";
import { MAX_CANDIDATES, documentRunnable } from "./useEvaluations.js";
import { Chips } from "./EvaluationLibrary.jsx";
import { documentChips, kilobytes, saveUnavailableMessage, unavailableText } from "./evaluationLibrary.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { Badge } from "../ui/Status.jsx";
import { Dropzone } from "../ui/Dropzone.jsx";
import { Callout } from "../ui/Callout.jsx";
import { CloseIcon, PlusIcon } from "../layout/Icons.jsx";
import { createNotifier, defaultToast } from "../../lib/notify";
import { insertAt } from "../../lib/lists";

const defaultShowActionToast = createNotifier(defaultToast);

const MODES = [
  {
    id: "models",
    title: "Models",
    summary: "One template, different models",
    detail: "Find the most accurate or fastest model for this kind of document.",
    diagram: ["T", ["M1", "M2", "M3"]],
  },
  {
    id: "templates",
    title: "Template versions",
    summary: "One model, different templates",
    detail: "Check whether edited field instructions improve the results.",
    diagram: ["M", ["v3", "v2", "v1"]],
  },
];

const megabytes = (bytes) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(bytes / (1024 * 1024));

function StepNumber({ number, complete }) {
  return (
    <span className={complete ? "evaluation-step-complete" : undefined} title={complete ? "Complete" : "Incomplete"}>
      {number}
      <span className="sr-only">{complete ? " complete" : " incomplete"}</span>
    </span>
  );
}

// Setup for an empty or cleared Evaluation: everything needed for a first run on one screen.
// One document compares candidates on it; several run a Batch Evaluation with the same candidates.
export function EvaluationSetup({
  state,
  templates,
  enabled,
  maxSourceFileBytes,
  suggestedModels = [],
  error,
  loadTemplate,
  onSelectDocuments,
  onRemoveDocument,
  onPreviewDocument,
  onChooseLibrary,
  onManageLibrary,
  onStart,
  onOpenWorkspace,
  showActionToast = defaultShowActionToast,
}) {
  const workspaceModel = state.setup?.model || "";
  const modelMissing = Boolean(state.setup) && !state.setup.configured;
  const [mode, setMode] = useState(state.mode);
  const [templateId, setTemplateId] = useState("");
  const [version, setVersion] = useState("");
  const [versions, setVersions] = useState([]);
  const [models, setModels] = useState(() => [workspaceModel, ""]);
  const [preview, setPreview] = useState(null);
  const [starting, setStarting] = useState(false);
  const template = templates.find((t) => t.id === templateId);

  const allVersions = template
    ? Array.from({ length: template.current_version || 1 }, (_, i) => (template.current_version || 1) - i)
    : [];

  // The Workspace model can arrive after the first render; use it as the first candidate.
  useEffect(() => {
    if (workspaceModel) setModels((previous) => (previous[0] ? previous : [workspaceModel, ...previous.slice(1)]));
  }, [workspaceModel]);
  useEffect(() => {
    if (!template) return undefined;
    let current = true;
    setPreview(null);
    loadTemplate(template.id, Number(version || template.current_version))
      .then((loaded) => {
        if (current) setPreview(loaded);
      })
      .catch(() => {
        if (current) setPreview(null);
      });

    return () => {
      current = false;
    };
  }, [template, version, loadTemplate]);

  // Removes the document at once; Undo puts it back at its position with its results.
  const removeDocument = async (document) => {
    const undo = await onRemoveDocument(document.key);

    if (undo) showActionToast("evaluation.removeDocument", "success", { targetName: document.name, undo });
  };

  // Removes the row at once; Undo puts the model back at its position.
  const removeModel = (index) => {
    const removed = models[index];

    setModels(models.filter((_, i) => i !== index));
    showActionToast("evaluation.removeCandidate", "success", {
      targetName: removed.trim(),
      undo: () => setModels((current) => insertAt(current, index, removed)),
    });
  };

  const chooseTemplate = (id) => {
    const next = templates.find((t) => t.id === id);
    setTemplateId(id);
    setVersion("");
    setVersions(
      Array.from({ length: Math.min(2, next?.current_version || 1) }, (_, i) => (next?.current_version || 1) - i),
    );
  };

  const names = models.flatMap((model) => {
    const name = model.trim();

    return name ? [name] : [];
  });

  const problems = [
    !template && "Choose a template",
    mode === "models" ? names.length < 2 && "Add at least two models" : !versions.length && "Choose a version",
  ].filter(Boolean);

  const willRun = state.documents.some(documentRunnable);
  const saveUnavailable = saveUnavailableMessage(state.library);

  const suggestions = [
    ...new Set(
      [workspaceModel, ...suggestedModels].flatMap((model) => {
        const name = String(model || "").trim();

        return name ? [name] : [];
      }),
    ),
  ]
    .filter((model) => !names.includes(model))
    .slice(0, 6);

  const fields = preview?.fields || [];
  const tables = fields.filter((field) => field.data_type === "array<object>").length;

  const start = async () => {
    setStarting(true);

    try {
      await onStart({
        mode,
        templateId,
        versions: mode === "models" ? [Number(version || template.current_version)] : versions,
        models: names,
        runNow: willRun,
      });
    } finally {
      setStarting(false);
    }
  };

  const addSuggestion = (model) => {
    const empty = models.findIndex((value) => !value.trim());
    setModels(empty >= 0 ? models.map((value, i) => (i === empty ? model : value)) : [...models, model]);
  };

  return (
    <div className="evaluation-setup">
      <div className="evaluation-setup-main">
        {modelMissing && (
          <Callout
            tone="info"
            title="Evaluations need a Model gateway"
            action={
              <Button variant="secondary" onClick={onOpenWorkspace}>
                Set up Model gateway
              </Button>
            }
          >
            Every evaluation runs on the workspace model. Set one up on the Workspaces page, then come back here.
          </Callout>
        )}
        {error && (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        )}

        <section className="evaluation-setup-step" aria-labelledby="evaluation-step-document">
          <div className="evaluation-setup-label">
            <StepNumber number="01" complete={state.documents.length > 0} />
            <h3 id="evaluation-step-document">Documents</h3>
          </div>
          <div className="evaluation-setup-body">
            {state.documents.length > 0 && (
              <ol className="evaluation-setup-docs">
                {state.documents.map((document) => {
                  const chips = documentChips(document, fields);

                  return (
                    <li
                      key={document.key}
                      className={`evaluation-setup-file ${documentRunnable(document) ? "" : "unrunnable"}`}
                    >
                      <Button
                        className="evaluation-setup-thumb"
                        aria-label={`View ${document.name}`}
                        onClick={() => onPreviewDocument(document)}
                      >
                        <span>
                          {(document.file?.type || document.entry?.mime_type || "").startsWith("image/")
                            ? "IMG"
                            : "PDF"}
                        </span>
                      </Button>
                      <div className="evaluation-setup-file-info">
                        <div className="evaluation-setup-file-row">
                          <strong title={document.name}>{document.name}</strong>
                          <Chips list={chips.slice(0, 1)} />
                          <IconButton
                            size="sm"
                            label={`Remove ${document.name}`}
                            icon={CloseIcon}
                            onClick={() => removeDocument(document)}
                          />
                        </div>
                        <div className="evaluation-setup-file-row">
                          <small title={document.file?.name || document.entry?.source_name}>
                            {document.file?.name || document.entry?.source_name} ·{" "}
                            {kilobytes(document.file?.size ?? document.entry?.byte_size)} ·{" "}
                            {document.kind === "upload" ? "new upload" : "from library"}
                          </small>
                        </div>
                        {chips.length > 1 && <Chips list={chips.slice(1)} />}
                        {!documentRunnable(document) && (
                          <p className="evaluation-bad-text">{unavailableText(document)}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            <Dropzone
              label="Evaluation document"
              className={`evaluation-dropzone ${state.documents.length ? "compact" : ""}`}
              onFiles={onSelectDocuments}
              renderContent={({ browse }) => (
                <>
                  <span className="evaluation-dropzone-icon" aria-hidden="true">
                    ▤
                  </span>
                  <div>
                    <strong>
                      {state.documents.length ? "Add more documents" : "Choose saved documents or drop new ones here"}
                    </strong>
                    <small>
                      PDF, PNG, JPG or WEBP · up to {megabytes(maxSourceFileBytes)} MB each
                    </small>
                  </div>
                  <span className="evaluation-actions">
                    <Button onClick={() => onChooseLibrary(fields)}>Library</Button>
                    <Button variant="secondary" onClick={browse}>
                      Upload new
                    </Button>
                  </span>
                </>
              )}
            />
            {saveUnavailable && (
              <p className="evaluation-setup-hint evaluation-warn-text">
                {saveUnavailable} New uploads can still be evaluated in this tab.
              </p>
            )}
          </div>
        </section>

        <section className="evaluation-setup-step" aria-labelledby="evaluation-step-mode">
          <div className="evaluation-setup-label">
            <StepNumber number="02" complete={MODES.some((option) => option.id === mode)} />
            <h3 id="evaluation-step-mode">What to compare</h3>
          </div>
          <div className="evaluation-setup-body">
            <div className="evaluation-mode-cards" role="radiogroup" aria-labelledby="evaluation-step-mode">
              {MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === item.id}
                  className="evaluation-mode-card"
                  onClick={() => setMode(item.id)}
                >
                  <span className="evaluation-mode-shape" aria-hidden="true">
                    <i>{item.diagram[0]}</i>
                    <b />
                    <span>
                      {item.diagram[1].map((label) => (
                        <i key={label}>{label}</i>
                      ))}
                    </span>
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <em>{item.summary}</em>
                    <small>{item.detail}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="evaluation-setup-step" aria-labelledby="evaluation-step-template">
          <div className="evaluation-setup-label">
            <StepNumber number="03" complete={!!template} />
            <h3 id="evaluation-step-template">Template</h3>
          </div>
          <div className="evaluation-setup-body">
            <div className="evaluation-setup-row">
              <label>
                Template
                <select value={templateId} onChange={(event) => chooseTemplate(event.target.value)}>
                  <option value="" disabled>
                    {templates.length ? "Choose a saved template" : "No saved templates available"}
                  </option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              {mode === "models" && (
                <label>
                  Version
                  <select value={version} disabled={!template} onChange={(event) => setVersion(event.target.value)}>
                    <option value="">
                      {template ? `Current · v${template.current_version}` : "Choose a template first"}
                    </option>
                    {allVersions.slice(1).map((v) => (
                      <option key={v} value={v}>
                        v{v}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {template && (
              <p className="evaluation-setup-hint">
                {preview
                  ? `${fields.length} ${fields.length === 1 ? "field" : "fields"}${tables ? ` · ${tables} ${tables === 1 ? "table" : "tables"}` : ""}`
                  : "Loading fields…"}
                {template.description ? ` · ${template.description}` : ""}
              </p>
            )}
          </div>
        </section>

        <section className="evaluation-setup-step" aria-labelledby="evaluation-step-candidates">
          <div className="evaluation-setup-label">
            <StepNumber
              number="04"
              complete={mode === "models" ? names.length >= 2 : !!template && versions.length > 0}
            />
            <h3 id="evaluation-step-candidates">Candidates</h3>
          </div>
          <div className="evaluation-setup-body">
            {mode === "models" ? (
              <>
                <ol className="evaluation-setup-candidates">
                  {models.map((model, index) => (
                    <li key={index}>
                      <span className="evaluation-index">{String(index + 1).padStart(2, "0")}</span>
                      <input
                        aria-label={`Candidate ${index + 1} model`}
                        placeholder="e.g. gpt-4o-mini"
                        value={model}
                        onChange={(event) =>
                          setModels(models.map((value, i) => (i === index ? event.target.value : value)))
                        }
                      />
                      {model.trim() && model.trim() === workspaceModel && (
                        <Badge>Default</Badge>
                      )}
                      <IconButton
                        size="sm"
                        label={`Remove candidate ${index + 1}`}
                        icon={CloseIcon}
                        disabled={models.length <= 1}
                        onClick={() => removeModel(index)}
                      />
                    </li>
                  ))}
                </ol>
                <div className="evaluation-setup-add">
                  <Button variant="secondary"
                    disabled={models.length >= MAX_CANDIDATES}
                    onClick={() => setModels([...models, ""])}
                  >
                    <PlusIcon size={13} /> Add model
                  </Button>
                  {suggestions.length > 0 && (
                    <span className="evaluation-setup-suggest">
                      <small>Used in this workspace</small>
                      {suggestions.map((model) => (
                        <Button
                          key={model}
                          className="evaluation-chip"
                          disabled={names.length >= MAX_CANDIDATES}
                          onClick={() => addSuggestion(model)}
                        >
                          <PlusIcon size={12} /> {model}
                        </Button>
                      ))}
                    </span>
                  )}
                </div>
              </>
            ) : !template ? (
              <p className="evaluation-setup-hint">Choose a template to pick the versions to compare.</p>
            ) : (
              <>
                <div className="evaluation-version-list" role="group" aria-label="Template versions">
                  {allVersions.map((v) => (
                    <label key={v} className="evaluation-version">
                      <input
                        type="checkbox"
                        checked={versions.includes(v)}
                        disabled={!versions.includes(v) && versions.length >= MAX_CANDIDATES}
                        onChange={(event) =>
                          setVersions(
                            event.target.checked
                              ? [...versions, v].sort((a, b) => b - a)
                              : versions.filter((x) => x !== v),
                          )
                        }
                      />
                      <span>
                        <strong>v{v}</strong>
                        <small>{v === template.current_version ? "Current" : `Version ${v}`}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="evaluation-setup-hint">
                  {versions.length === 1
                    ? `Starts two copies of v${versions[0]} so you can edit one and compare.`
                    : `All versions run on ${workspaceModel || "the workspace model"}.`}
                </p>
              </>
            )}
          </div>
        </section>

        <footer className="evaluation-setup-foot">
          <div className="evaluation-setup-submit">
            {problems.length > 0 && <small className="evaluation-muted">{problems.join(" · ")}</small>}
            <Button disabled={!enabled || !state.setup?.configured || problems.length > 0 || starting} onClick={start}>
              {starting ? "Starting…" : willRun ? "Start and run" : "Start evaluation"}
            </Button>
          </div>
        </footer>
      </div>

      <aside className="evaluation-setup-aside" aria-label="How evaluations work">
        <div className="evaluation-setup-model evaluation-library-box">
          <small>Evaluation library</small>
          <p>Documents with expected answers, shared with everyone in this workspace.</p>
          <Button variant="text" onClick={() => onManageLibrary(fields)}>
            Manage library
          </Button>
        </div>
        {mode === "templates" && state.setup?.configured && (
          <div className="evaluation-setup-model">
            <small>Workspace model</small>
            <span>
              <i aria-hidden="true" />
              {workspaceModel}
            </span>
          </div>
        )}
        <h3>How it works</h3>
        <ol className="evaluation-how">
          <li>
            <span>1</span>
            <div>
              <strong>Choose documents</strong>
              <p>Pick saved or new documents. Up to {MAX_CANDIDATES} candidates run on each.</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Verify expected answers</strong>
              <p>Verify each field's correct value. Only verified fields are scored.</p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Compare</strong>
              <p>Review accuracy, table cells, time and tokens for each document.</p>
            </div>
          </li>
        </ol>
      </aside>
    </div>
  );
}
