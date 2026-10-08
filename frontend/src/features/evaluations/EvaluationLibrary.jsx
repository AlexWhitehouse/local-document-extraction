import React, { useEffect, useMemo, useRef, useState } from "react";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { getDataTypeLabel } from "../templates/templateFields.js";
import { Meter } from "./EvaluationParts.jsx";
import { DataTable } from "../ui/DataTable.jsx";
import { LoadMore } from "../ui/Pager.jsx";
import { Field, TextInput } from "../ui/Field.jsx";
import { Callout } from "../ui/Callout.jsx";
import { documentCompatibility, fieldIdentity } from "./evaluationScoring.js";
import {
  documentDirty,
  kilobytes,
  updatedLabel,
  newerAvailable,
  refText,
  saveUnavailableMessage,
  sameReferenceSet,
  summaryCompatibility,
  unavailableText,
} from "./evaluationLibrary.js";
import { documentRunnable } from "./useEvaluations.js";
import { confirmDialog } from "../ui/confirm.jsx";
import { EmptyState, ErrorState } from "../ui/States.jsx";
import { describeError } from "../../lib/describeError";
import { Button, IconButton } from "../ui/Button.jsx";
import { Badge, StatusDot } from "../ui/Status.jsx";
import { CloseIcon } from "../layout/Icons.jsx";

// Document status chips: [tone, label, busy?] with tone neutral | info | success | warning | danger.
export function Chips({ list }) {
  return (
    <span className="evaluation-chips">
      {list.map(([tone, label, busy = false]) => (
        <Badge key={label} tone={tone} busy={busy} title={label}>
          {label}
        </Badge>
      ))}
    </span>
  );
}

function useLibraryList(evaluation) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState({ entries: [], next: null, loading: true, error: "" });
  const request = useRef(0);

  const load = async (cursor, search) => {
    const current = ++request.current;
    setList((previous) => ({ ...previous, loading: true, error: "" }));

    try {
      const page = await evaluation.library.list({ cursor, query: search });

      if (current === request.current)
        setList((previous) => ({
          entries: cursor ? [...previous.entries, ...page.documents] : page.documents,
          next: page.next_cursor,
          loading: false,
          error: "",
        }));
    } catch (error) {
      if (current === request.current)
        setList((previous) => ({
          ...previous,
          loading: false,
          error: describeError(error, "The library couldn’t be loaded. Try again."),
        }));
    }
  };

  const loadRef = useRef(load);
  loadRef.current = load;
  // Search is debounced; library changes from this tab or live updates refresh the first page.
  useEffect(() => {
    const timer = setTimeout(() => loadRef.current(null, query), query ? 250 : 0);

    return () => clearTimeout(timer);
  }, [query, evaluation.state.libraryVersion]);

  return {
    ...list,
    query,
    setQuery,
    loadMore: () => load(list.next, query),
    reload: () => load(null, query),
    replace: (entry) =>
      setList((previous) => ({ ...previous, entries: previous.entries.map((e) => (e.id === entry.id ? entry : e)) })),
    drop: (id) => setList((previous) => ({ ...previous, entries: previous.entries.filter((e) => e.id !== id) })),
  };
}

function LibraryTable({ list, fields, selected, onToggle, inEvaluation, actions }) {
  return (
    <div className="evaluation-library">
      <input
        type="search"
        aria-label="Search library"
        placeholder="e.g. invoice.pdf"
        value={list.query}
        onChange={(event) => list.setQuery(event.target.value)}
      />
      <ScrollArea className="evaluation-library-scroll" role="region" aria-label="Saved documents" tabIndex={0}>
        <DataTable label="Library documents" className="evaluation-library-table">
          <colgroup>
            {onToggle && <col className="evaluation-library-select-col" />}
            <col />
            <col className="evaluation-library-answers-col" />
            <col className="evaluation-library-fields-col" />
            <col className="evaluation-library-updated-col" />
            {actions && <col className="evaluation-library-actions-col" />}
          </colgroup>
          <thead>
            <tr>
              {onToggle && (
                <th>
                  <span className="sr-only">Select</span>
                </th>
              )}
              <th>Document</th>
              <th>Expected answers</th>
              <th>{fields.length ? "With this Template" : "Fields"}</th>
              <th>Updated</th>
              {actions && (
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {list.entries.map((entry) => {
              const compatibility = summaryCompatibility(entry, fields),
                inBatch = inEvaluation(entry.id);

              const sourceLabel = `${entry.source_name} · ${kilobytes(entry.byte_size)}${entry.page_count ? ` · ${entry.page_count} ${entry.page_count === 1 ? "page" : "pages"}` : ""}${inBatch ? " · in this Evaluation" : ""}`;
              const updated = updatedLabel(entry);

              return (
                <tr
                  key={entry.id}
                  className={
                    onToggle && (selected.includes(entry.id) || inBatch) ? "evaluation-library-selected" : undefined
                  }
                >
                  {onToggle && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${entry.name}`}
                        checked={selected.includes(entry.id) || inBatch}
                        disabled={inBatch}
                        onChange={() => onToggle(entry)}
                      />
                    </td>
                  )}
                  <td className="evaluation-library-document">
                    {actions ? actions.name(entry) : <strong title={entry.name}>{entry.name}</strong>}
                    <small title={sourceLabel}>{sourceLabel}</small>
                  </td>
                  <td>
                    <span className="evaluation-progress">
                      <Meter value={compatibility.total ? compatibility.verified / compatibility.total : 0} best />
                      <small>
                        {compatibility.verified}/{compatibility.total}
                      </small>
                    </span>
                    {!compatibility.verified && <small className="evaluation-muted">Compare only · no score</small>}
                  </td>
                  <td>
                    {!fields.length ? (
                      <span>
                        {entry.fields?.length || 0} saved {entry.fields?.length === 1 ? "field" : "fields"}
                      </span>
                    ) : compatibility.review ? (
                      <span className="evaluation-warn-text">
                        {compatibility.review} {compatibility.review === 1 ? "field needs" : "fields need"} review
                      </span>
                    ) : (
                      <span>Compatible</span>
                    )}
                    {compatibility.omitted?.length > 0 && (
                      <small className="evaluation-muted">
                        {compatibility.omitted.length} saved {compatibility.omitted.length === 1 ? "answer" : "answers"}{" "}
                        not in this Template
                      </small>
                    )}
                  </td>
                  <td>
                    <small title={updated}>{updated}</small>
                  </td>
                  {actions && <td className="evaluation-row-actions">{actions.buttons(entry)}</td>}
                </tr>
              );
            })}
            {!list.entries.length &&
              !list.loading &&
              (list.error ? (
                <ErrorState
                  variant="tableRow"
                  colSpan={4 + Number(!!onToggle) + Number(!!actions)}
                  message={list.error}
                  onRetry={list.reload}
                />
              ) : (
                <EmptyState
                  variant="tableRow"
                  colSpan={4 + Number(!!onToggle) + Number(!!actions)}
                  message={
                    list.query
                      ? "No saved documents match."
                      : "No saved documents yet. Save an uploaded document from an Evaluation to reuse it."
                  }
                />
              ))}
          </tbody>
        </DataTable>
      </ScrollArea>
      {(list.next || list.loading || (list.error && list.entries.length > 0)) && (
        <LoadMore
          onLoadMore={list.loadMore}
          pending={list.loading}
          error={list.entries.length > 0 ? list.error : ""}
        />
      )}
    </div>
  );
}

function LibraryModal({ label, description, onClose, children, footer }) {
  return (
    <ModalDialog
      label={label}
      className="evaluation-library-modal wide evaluation-library-browser"
      initialFocus="input[type=search]"
      onClose={onClose}
    >
      <header className="evaluation-library-head">
        <div>
          <h2>Evaluation library</h2>
          <p>{description}</p>
        </div>
        <IconButton size="sm" label="Close library" icon={CloseIcon} className="modal-close" onClick={onClose} />
      </header>
      <div className="evaluation-library-body">{children}</div>
      <footer className="evaluation-library-foot">{footer}</footer>
    </ModalDialog>
  );
}

export function LibraryPicker({ evaluation, fields, onClose }) {
  const list = useLibraryList(evaluation);
  const [selected, setSelected] = useState([]);
  const [progress, setProgress] = useState(null);
  const [failed, setFailed] = useState([]);
  const inEvaluation = (id) => evaluation.state.documents.some((d) => d.entry?.id === id);

  const add = async () => {
    setProgress([0, selected.length]);
    setFailed([]);
    const { failed: problems } = await evaluation.addSaved(selected, (done, total) => setProgress([done, total]));
    setProgress(null);

    if (problems.length) {
      setFailed(problems);
      setSelected(problems.map((p) => p.entry));
    } else onClose();
  };

  return (
    <LibraryModal
      label="Evaluation library"
      description="Select saved documents to compare. Their saved expected answers will be included."
      onClose={onClose}
      footer={
        <>
          {failed.length > 0 && (
            <p role="alert" className="evaluation-bad-text">
              Couldn’t add {failed.map((f) => f.entry.name).join(", ")}. {failed[0].message}
            </p>
          )}
          <div className="evaluation-library-selection">
            <span>
              {selected.length
                ? `${selected.length} ${selected.length === 1 ? "document" : "documents"} selected`
                : "Select documents to add"}
            </span>
            <div className="actions">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!selected.length || !!progress} onClick={add}>
                {progress
                  ? `Adding ${progress[0]} of ${progress[1]}…`
                  : selected.length
                    ? `Add ${selected.length} ${selected.length === 1 ? "document" : "documents"}`
                    : "Add documents"}
              </Button>
            </div>
          </div>
        </>
      }
    >
      <LibraryTable
        list={list}
        fields={fields}
        selected={selected.map((e) => e.id)}
        inEvaluation={inEvaluation}
        onToggle={(entry) =>
          setSelected((s) => (s.some((e) => e.id === entry.id) ? s.filter((e) => e.id !== entry.id) : [...s, entry]))
        }
      />
    </LibraryModal>
  );
}

// Answers open in a working copy; updates to the shared library stay explicit.
export function ManageLibrary({ evaluation, fields, onClose, notify }) {
  const list = useLibraryList(evaluation);
  const [renaming, setRenaming] = useState(null);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(null);
  const editRequest = useRef(null);
  useEffect(() => () => editRequest.current?.abort(), []);

  const edit = async (entry) => {
    editRequest.current?.abort();
    const controller = new AbortController();
    editRequest.current = controller;
    setEditing(entry.id);
    setMessage("");

    try {
      if (await evaluation.editSaved(entry, controller.signal)) onClose();
    } catch (error) {
      if (!controller.signal.aborted) setMessage(describeError(error, "This document couldn’t be opened. Try again."));
    } finally {
      if (!controller.signal.aborted) setEditing(null);
    }
  };

  const rename = async (entry, name, expectedRevision = entry.revision) => {
    if (!name.trim() || name.trim() === entry.name) {
      setRenaming(null);

      return;
    }

    try {
      const { document } = await evaluation.library.update(entry.id, { expectedRevision, name: name.trim() });
      list.replace(document);
      evaluation.entryChanged(document, expectedRevision);
      setRenaming(null);
      notify("library.rename", "success", { targetName: document.name });
    } catch (error) {
      if (error.code === "revision_conflict" && error.body?.current)
        setRenaming({ id: entry.id, name, conflict: error.body.current.document });
      else {
        if (error.code === "document_not_found") {
          list.drop(entry.id);
          evaluation.entryDeleted(entry.id);
          setRenaming(null);
        }

        notify("library.rename", "failure", { targetName: entry.name, error });
      }
    }
  };

  const remove = (entry) =>
    confirmDialog({
      title: `Delete "${entry.name}"?`,
      body: "Its original and expected answers are removed for everyone in this Workspace. This can't be undone.",
      confirmLabel: "Delete document",
      pendingLabel: "Deleting…",
      action: async () => {
        try {
          await evaluation.library.remove(entry.id);
        } catch (error) {
          // Other failures stay inline in the confirmation; already gone on the
          // server means drop it locally and report nothing.
          if (error.code !== "document_not_found") throw error;

          list.drop(entry.id);
          evaluation.entryDeleted(entry.id);

          return;
        }

        list.drop(entry.id);
        evaluation.entryDeleted(entry.id);
        notify("library.delete", "success", { targetName: entry.name });
      },
    });

  const actions = {
    name: (entry) =>
      renaming?.id !== entry.id ? (
        <strong title={entry.name}>{entry.name}</strong>
      ) : (
        <form
          className="evaluation-rename"
          onSubmit={(event) => {
            event.preventDefault();
            rename(entry, renaming.name);
          }}
        >
          <input
            aria-label={`New name for ${entry.name}`}
            value={renaming.name}
            maxLength={200}
            autoFocus
            onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
          />
          {renaming.conflict ? (
            <span className="evaluation-conflict" role="alert">
              Renamed to “{renaming.conflict.name}” by {renaming.conflict.updated_by_name || "someone else"} since you
              loaded it.
              <Button variant="text"
                onClick={() => {
                  list.replace(renaming.conflict);
                  evaluation.entryChanged(renaming.conflict);
                  setRenaming(null);
                }}
              >
                Use saved name
              </Button>
              <Button variant="text"
                onClick={() => rename(renaming.conflict, renaming.name, renaming.conflict.revision)}
              >
                Replace with mine
              </Button>
            </span>
          ) : (
            <span className="evaluation-actions start">
              <Button variant="text" type="submit">
                Save name
              </Button>
              <Button variant="text" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
            </span>
          )}
        </form>
      ),
    buttons: (entry) => (
      <>
        <Button variant="text"
          aria-label={`Edit ${entry.name}`}
          disabled={!!editing}
          onClick={() => edit(entry)}
        >
          {editing === entry.id ? "Opening…" : "Edit"}
        </Button>
        <Button variant="text"
          aria-label={`Rename ${entry.name}`}
          disabled={!!editing}
          onClick={() => setRenaming({ id: entry.id, name: entry.name })}
        >
          Rename
        </Button>
        <Button variant="danger-text"
          aria-label={`Delete ${entry.name}`}
          disabled={!!editing}
          onClick={() => remove(entry)}
        >
          Delete
        </Button>
      </>
    ),
  };

  return (
    <LibraryModal
      label="Manage library"
      description="Edit saved fields and Expected answers without running a model, or rename and delete documents shared with this Workspace."
      onClose={onClose}
      footer={
        <>
          {message && (
            <p role="status" className="evaluation-notice">
              {message}
            </p>
          )}
          <div className="actions">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      }
    >
      <LibraryTable
        list={list}
        fields={fields}
        inEvaluation={(id) => evaluation.state.documents.some((d) => d.entry?.id === id)}
        actions={actions}
      />
    </LibraryModal>
  );
}

export function SaveDialog({ evaluation, document, fields, onClose, onSaved }) {
  const [name, setName] = useState(document.name.replace(/\.[a-z0-9]+$/i, ""));
  const compatibility = documentCompatibility(document, fields);
  const unavailable = saveUnavailableMessage(evaluation.state.library);

  const save = async (fresh) => {
    if (await evaluation.saveDocument(document.key, name.trim(), { fresh })) {
      onSaved?.(name.trim());
      onClose();
    }
  };

  return (
    <ModalDialog label="Save to Evaluation library" className="evaluation-library-modal" onClose={onClose}>
      <div className="evaluation-heading">
        <div>
          <h2>Save to Evaluation library</h2>
          <p>
            Saves the original file and its Expected answers for everyone in this Workspace. Candidate settings and
            results are not saved.
          </p>
        </div>
        <IconButton size="sm" label="Close" icon={CloseIcon} className="modal-close" onClick={onClose} />
      </div>
      <Field label="Name in library">
        <TextInput value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
      </Field>
      <p className="evaluation-setup-hint">
        {document.file?.name} ·{" "}
        {compatibility.verified
          ? `${compatibility.verified} of ${compatibility.total} answers verified`
          : "No verified answers yet"}
        .{compatibility.verified < compatibility.total ? " You can finish verifying later." : ""} Saving never verifies
        an answer.
      </p>
      {unavailable && <p className="evaluation-warn-text">{unavailable}</p>}
      {document.save === "failed" && (
        <p role="alert" className="evaluation-bad-text">
          {document.saveError}
        </p>
      )}
      <div className="actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {document.saveConflict && (
          <Button variant="secondary" disabled={document.save === "saving"} onClick={() => save(true)}>
            Save as a new entry
          </Button>
        )}
        <Button
          disabled={!name.trim() || document.save === "saving" || !!unavailable}
          onClick={() => save(false)}
        >
          {document.save === "saving"
            ? "Saving…"
            : document.save === "failed" && !document.saveConflict
              ? "Try again"
              : "Save"}
        </Button>
      </div>
    </ModalDialog>
  );
}

function changedIdentities(sets) {
  const ids = [...new Set(sets.flatMap((set) => Object.keys(set?.references || {})))];
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  return ids.filter((id) => sets.some((set) => !same(set?.references[id], sets[0]?.references[id])));
}

// Updating shared answers always shows a review first; a stale revision becomes a three-way conflict review.
export function UpdateReview({ evaluation, document, onClose, onDone }) {
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saved = conflict ? conflict.reference : null;

  const mine = document.reference,
    loaded = document.base;

  const current = useMemo(
    () => saved && { definitions: saved.definitions || {}, references: saved.references || {} },
    [saved],
  );

  const columns = conflict
    ? [
        ["When you loaded", loaded],
        [`Saved now${conflict.document.updated_by_name ? ` (${conflict.document.updated_by_name})` : ""}`, current],
        ["Yours", mine],
      ]
    : [
        ["Saved", loaded],
        ["Yours", mine],
      ];

  const ids = changedIdentities(columns.map(([, set]) => set));
  const definition = (id) => mine.definitions[id] || current?.definitions[id] || loaded?.definitions[id];

  const show = (set, id) =>
    set?.references[id]
      ? `${refText(set.references[id], definition(id))}${set.references[id].verified ? " ✓" : " (unverified)"}`
      : "—";

  const submit = async () => {
    setBusy(true);
    setError("");
    const outcome = await evaluation.updateSaved(document.key, conflict?.document.revision);
    setBusy(false);

    if (outcome.ok) {
      onDone?.("library.updateSaved");
      onClose();
    } else if (outcome.conflict) setConflict(outcome.conflict);
    else if (outcome.error) setError(outcome.error);
  };

  return (
    <ModalDialog label="Review saved answer update" className="evaluation-library-modal wide" onClose={onClose}>
      <div className="evaluation-heading">
        <div>
          <h2>{conflict ? "The saved answers changed since you loaded them" : "Update saved answers?"}</h2>
          <p>
            {conflict
              ? `${conflict.document.updated_by_name || "Someone"} updated “${conflict.document.name}”. Your changes were not saved. Review both before choosing.`
              : `Replaces the Workspace copy of “${document.entry.name}” for everyone. Candidate settings and results are not saved.`}
          </p>
        </div>
        <IconButton size="sm" label="Close" icon={CloseIcon} className="modal-close" onClick={onClose} />
      </div>
      <ScrollArea className="evaluation-library-scroll" role="region" aria-label="Answer changes" tabIndex={0}>
        <DataTable className="evaluation-diff">
          <thead>
            <tr>
              <th>Field</th>
              {columns.map(([label]) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => (
              <tr key={id}>
                <th>
                  {definition(id)?.name || id}
                  <small className="evaluation-type">{getDataTypeLabel(definition(id)?.data_type)}</small>
                </th>
                {columns.map(([label, set], index) => (
                  <td
                    key={label}
                    className={
                      index === columns.length - 1
                        ? "evaluation-diff-mine"
                        : conflict && index === 1
                          ? "evaluation-diff-theirs"
                          : undefined
                    }
                  >
                    {show(set, id)}
                  </td>
                ))}
              </tr>
            ))}
            {!ids.length && (
              <tr>
                <td colSpan={columns.length + 1} className="evaluation-empty-row">
                  {conflict && current && sameReferenceSet(current, mine)
                    ? "The saved answers already match yours."
                    : "No answer changes."}
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
      </ScrollArea>
      {error && (
        <p role="alert" className="evaluation-bad-text">
          {error}
        </p>
      )}
      <div className="actions">
        <Button variant="secondary" onClick={onClose}>
          Keep editing
        </Button>
        {conflict && (
          <Button variant="secondary"
            onClick={() => {
              evaluation.useSavedVersion(document.key, conflict);
              onDone?.("library.useSaved");
              onClose();
            }}
          >
            Use saved version
          </Button>
        )}
        <Button disabled={busy} onClick={submit}>
          {busy ? "Updating…" : conflict ? "Replace with mine" : "Update saved answers"}
        </Button>
      </div>
    </ModalDialog>
  );
}

export function ClearDialog({ evaluation, onClose }) {
  const documents = evaluation.state.documents;

  const uploads = documents.filter((d) => d.kind === "upload"),
    dirty = documents.filter(documentDirty);

  return (
    <ModalDialog label="Clear Evaluation" className="evaluation-library-modal" onClose={onClose}>
      <div className="evaluation-heading">
        <div>
          <h2>Clear this Evaluation?</h2>
          <p>Candidate drafts and results always clear. These inputs are also only in this tab:</p>
        </div>
        <IconButton size="sm" label="Close" icon={CloseIcon} className="modal-close" onClick={onClose} />
      </div>
      <ul className="evaluation-leave">
        {uploads.map((d) => (
          <li key={d.key}>
            <strong>{d.name}</strong> · new upload, not saved to the library
          </li>
        ))}
        {dirty.map((d) => (
          <li key={d.key}>
            <strong>{d.name}</strong> · answer changes not saved to the library
          </li>
        ))}
        {!uploads.length && !dirty.length && <li>Nothing unsaved. Saved library documents stay in the library.</li>}
      </ul>
      <div className="actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger"
          onClick={() => {
            evaluation.clear();
            onClose();
          }}
        >
          Clear evaluation
        </Button>
      </div>
    </ModalDialog>
  );
}

export function LinkSavedAnswer({ name, options, onLink }) {
  if (!options.length) return null;

  return (
    <label className="evaluation-link-field">
      <span>Renamed? Link it to</span>
      <select
        aria-label={`Link saved ${name} to a field`}
        value=""
        onChange={(event) => {
          if (event.target.value) onLink(event.target.value);
        }}
      >
        <option value="">Choose a field…</option>
        {options.map((field) => (
          <option key={fieldIdentity(field)} value={fieldIdentity(field)}>
            {field.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LinkedNote({ savedName, fieldName, onUnlink }) {
  return (
    <small className="evaluation-block evaluation-muted">
      Linked to saved “{savedName}” · this Evaluation only
      <Button variant="text"
        aria-label={`Unlink ${fieldName} from saved ${savedName}`}
        onClick={onUnlink}
      >
        Unlink
      </Button>
    </small>
  );
}

export function ReviewPrompt({ field, definition, reference, onReview }) {
  return (
    <div className="evaluation-review">
      <span>
        {field.data_type === "array<object>" && definition?.data_type === "array<object>" ? (
          <StatusDot tone="warning" label="Needs review · Template columns changed" />
        ) : (
          <>
            <StatusDot tone="warning" label="Needs review" />
            <span className="evaluation-muted evaluation-block">
              Previously saved as {getDataTypeLabel(definition?.data_type)}: “{refText(reference, definition)}”
            </span>
          </>
        )}
      </span>
      <Button variant="text" onClick={onReview}>
        {field.data_type === "array<object>"
          ? "Review updated table"
          : `Review as ${getDataTypeLabel(field.data_type)}`}
      </Button>
    </div>
  );
}

export function DocumentBanner({ evaluation, document, notify }) {
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);

    try {
      await evaluation.retrySource(document.key);
      notify("library.restoreOriginal", "success");
    } catch (error) {
      notify("library.restoreOriginal", "failure", { error });
    } finally {
      setRetrying(false);
    }
  };

  if (document.availability === "deleted")
    return (
      <Callout tone="danger">
        Deleted from the Evaluation library. Results already shown stay visible in this tab, but it can’t run again.
      </Callout>
    );

  if (!documentRunnable(document))
    return (
      <Callout
        tone="danger"
        action={
          <Button variant="text" disabled={retrying} onClick={retry}>
            {retrying ? "Checking…" : "Retry original"}
          </Button>
        }
      >
        {unavailableText(document)}
      </Callout>
    );

  if (newerAvailable(document))
    return (
      <Callout
        tone="info"
        action={
          <Button
            variant="text"
            onClick={() =>
              evaluation.loadLatest(document.key).catch((error) => notify("library.loadLatest", "failure", { error }))
            }
          >
            Load latest
          </Button>
        }
      >
        The saved answers were updated since you loaded them. This Evaluation keeps the copy you loaded.
      </Callout>
    );

  return null;
}

// Previews are created on demand and revoked when closed; saved originals stream from the library.
export function DocumentPreview({ evaluation, document, onClose }) {
  const [source, setSource] = useState(() =>
    document.file ? { url: URL.createObjectURL(document.file), type: document.file.type } : null,
  );

  const [error, setError] = useState("");
  useEffect(() => {
    if (source || !document.entry) return undefined;
    let current = true;
    evaluation.library
      .source(document.entry.id)
      .then((blob) => {
        if (current) setSource({ url: URL.createObjectURL(blob), type: blob.type || document.entry.mime_type });
      })
      .catch((failure) => {
        if (current) setError(describeError(failure, "The original document couldn’t be loaded. Try again."));
      });

    return () => {
      current = false;
    };
  }, [source, document, evaluation.library]);
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source.url);
    },
    [source],
  );

  return (
    <ModalDialog className="evaluation-expanded" label="Document preview" onClose={onClose}>
      <div className="evaluation-heading">
        <h2>{document.name || "Document"}</h2>
        <IconButton size="sm" label="Close document" icon={CloseIcon} className="modal-close" onClick={onClose} />
      </div>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : !source ? (
        <p className="evaluation-muted">Loading document…</p>
      ) : source.type === "application/pdf" ? (
        <iframe title="Evaluation document" src={source.url} />
      ) : (
        <img alt="Evaluation document" src={source.url} />
      )}
    </ModalDialog>
  );
}
