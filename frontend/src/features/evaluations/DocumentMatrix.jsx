import { pluralize } from "../../lib/text.js";
import { statusLabel } from "../../lib/status.js";
import { isJsonObject } from "../../../../shared/json.ts";
import React, { useState } from "react";
import { getDataTypeLabel } from "../templates/templateFields.js";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { ReferenceModal } from "./ReferenceModal.jsx";
import { TableComparison } from "./TableComparison.jsx";
import { CandidateMenu, ExpectedInline, Mark, Meter, RunCost, StatusLine } from "./EvaluationParts.jsx";
import { LinkSavedAnswer, LinkedNote, ReviewPrompt } from "./EvaluationLibrary.jsx";
import { display, percent, templateLabel } from "./evaluationFormat.js";
import { MAX_CANDIDATES, candidateBusy } from "./useEvaluations.js";
import { linkableFields, refText } from "./evaluationLibrary.js";
import { adaptReferenceDraft } from "./referenceDraft.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { Badge } from "../ui/Status.jsx";
import { Segmented } from "../ui/Tabs.jsx";
import { DataTable } from "../ui/DataTable.jsx";
import { Callout } from "../ui/Callout.jsx";
import { CloseIcon, ExternalIcon, PlayIcon, PlusIcon } from "../layout/Icons.jsx";
import {
  answerSignature,
  bestCandidateId,
  candidateAccuracy,
  fieldIdentity,
  linkAlignments,
  scalarValue,
  scoreCandidate,
  tableAnswerRows,
  tableColumns,
  tableSchemaChanges,
  validateReference,
} from "./evaluationScoring.js";

const COMPARABLE_TYPES = ["array<object>", "object", "array"];

const FILTERS = [
  ["all", "All fields"],
  ["differ", "Candidates differ"],
  ["mismatch", "Has mismatch"],
  ["unverified", "Unverified"],
  ["changes", "Template changes"],
];

const baseName = (identity) => identity.slice(0, identity.lastIndexOf(":"));

export function FieldFilters({ value, onChange, editing = false }) {
  const items = FILTERS.flatMap(([id, label]) =>
    editing && ["differ", "mismatch"].includes(id) ? [] : [{ value: id, label }],
  );

  return (
    <Segmented
      label="Filter fields"
      className="evaluation-filter"
      items={items}
      value={value}
      onChange={onChange}
    />
  );
}

// The candidate column head for one document's comparison.
export function CandidateHead({
  candidate,
  menuCandidate = candidate,
  index,
  mode,
  onModelChange,
  menu,
  children,
  foot,
  run,
}) {
  const label = `Candidate ${index + 1}`;

  return (
    <th className="evaluation-candidate">
      <div className="evaluation-candidate-top">
        <span className="evaluation-index">{String(index + 1).padStart(2, "0")}</span>
        {mode === "models" ? (
          <input
            aria-label={`${label} model`}
            placeholder="e.g. gpt-4o-mini"
            value={candidate.model}
            onChange={(event) => onModelChange(event.target.value)}
          />
        ) : (
          <strong title={templateLabel(candidate.template)}>{templateLabel(candidate.template)}</strong>
        )}
        <CandidateMenu label={label} candidate={menuCandidate} {...menu} />
      </div>
      {children}
      <div className="evaluation-candidate-foot">
        {foot}
        <IconButton
          size="sm"
          label={run.label}
          title={run.title}
          icon={PlayIcon}
          disabled={run.disabled}
          onClick={run.onClick}
        />
      </div>
    </th>
  );
}

// One document's comparison: the existing matrix, inspector and table comparison, scored against
// that document's working copy of its Expected answers.
export function DocumentMatrix({
  evaluation,
  document,
  candidates,
  template,
  batch,
  labelFor,
  menuFor,
  runFor,
  onAddCandidate,
  filter = "all",
  onFilterChange,
}) {
  const { state } = evaluation;
  const [referenceEditor, setReferenceEditor] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [inspect, setInspect] = useState(null);
  const { references, definitions: saved } = document.reference;
  const schemaCandidates = template ? [{ id: "library-template", template }] : candidates;
  const definitions = { ...saved };
  const rows = new Map();

  for (const candidate of schemaCandidates) {
    for (const field of candidate.result?.fields || candidate.template.fields) {
      const own = fieldIdentity(field),
        link = document.links?.[own];

      definitions[own] ||= field;
      const identity = state.alignments[candidate.id]?.[field.id] || link || own;
      definitions[identity] ||= field;

      if (!rows.has(identity))
        rows.set(identity, {
          identity,
          field: definitions[identity],
          candidates: {},
          linked: link === identity ? { field, own } : null,
        });
      rows.get(identity).candidates[candidate.id] = field;
    }
  }

  // Retain unrequested saved answers for coverage and explicit removal or review.
  for (const [identity, field] of Object.entries(saved))
    if (!rows.has(identity)) rows.set(identity, { identity, field, candidates: {}, omitted: true });
  const requested = new Set([...rows.values()].flatMap((row) => (row.omitted ? [] : [row.identity])));

  const changedTableCandidate = (row, needsReview = false) =>
    row.field.data_type === "array<object>" &&
    schemaCandidates.find(
      (candidate) =>
        row.candidates[candidate.id] &&
        tableSchemaChanges(row.field, row.candidates[candidate.id])[needsReview ? "needsReview" : "hasChanges"],
    );

  const reviewFrom = (row) =>
    !row.omitted &&
    references[row.identity]?.verified &&
    !references[row.identity].absent &&
    changedTableCandidate(row, true)
      ? row.identity
      : !row.omitted && !references[row.identity]?.verified
        ? Object.keys(references).find(
            (id) => references[id]?.verified && !requested.has(id) && baseName(id) === baseName(row.identity),
          )
        : undefined;

  const reviewedBy = (identity) => [...rows.values()].find((row) => reviewFrom(row) === identity);

  // Explicit per-document links for renamed fields; a candidate's own alignment still takes precedence.
  const alignFor = (c) => ({
    ...linkAlignments(document.links, c.result?.fields || c.template.fields),
    ...state.alignments[c.id],
  });

  const templateFields = schemaCandidates.flatMap((c) => c.result?.fields || c.template.fields);

  const scores = Object.fromEntries(
    candidates.map((c) => [c.id, scoreCandidate(c, references, definitions, alignFor(c), state.columns[c.id])]),
  );

  const bestId = bestCandidateId(candidates, scores);
  const rawFor = (row, candidate) => candidate.result?.raw.find((r) => r.field_id === row.candidates[candidate.id]?.id);
  const allRows = [...rows.values()];
  const hasSavedFields = Object.keys(saved).length > 0;
  const changes = new Map();

  for (const row of allRows) {
    if (!hasSavedFields || (row.omitted && reviewedBy(row.identity))) continue;
    const from = reviewFrom(row);

    if (from && from !== row.identity)
      changes.set(
        row.identity,
        `${getDataTypeLabel(saved[from].data_type)} → ${getDataTypeLabel(row.field.data_type)}`,
      );
    else if (row.omitted) changes.set(row.identity, "Not requested · saved answer kept");
    else if (!saved[row.identity]) changes.set(row.identity, "No saved answer · verify this field");
    else if (changedTableCandidate(row)) changes.set(row.identity, "Table columns updated");
    else if (Object.values(row.candidates).some((field) => field.name !== row.field.name))
      changes.set(row.identity, "Field name updated");
  }

  const visible = allRows.filter((row) => {
    // A replaced type's old value is already shown beside its current field.
    if (row.omitted && reviewedBy(row.identity)) return false;

    return filter === "all"
      ? true
      : filter === "changes"
        ? changes.has(row.identity)
        : filter === "differ"
          ? new Set(
              candidates.flatMap((c) =>
                c.result && row.candidates[c.id] ? [answerSignature(row.candidates[c.id], rawFor(row, c))] : [],
              ),
            ).size > 1
          : filter === "mismatch"
            ? candidates.some(
                (c) => row.candidates[c.id] && scores[c.id].byField[row.candidates[c.id].id]?.state === "Mismatch",
              )
            : !references[row.identity]?.verified || !!reviewFrom(row);
  });

  const saveReference = (row, value) => evaluation.setReference(document.key, row.identity, value, row.field);

  const reference = (row, candidate) => {
    const raw = candidate && rawFor(row, candidate);
    const from = reviewFrom(row);
    const existing = references[from || row.identity];
    const previousField = saved[from || row.identity] || row.field;
    const preferred = candidate || changedTableCandidate(row, true) || changedTableCandidate(row);
    const ordered = preferred ? [preferred, ...schemaCandidates.filter((c) => c !== preferred)] : schemaCandidates;
    const schemas = [];
    const seen = new Set();

    for (const current of ordered) {
      const field = row.candidates[current.id];

      if (!field) continue;

      // Extraction instructions do not change the expected answer's schema.
      const signature = JSON.stringify([
        field.data_type,
        tableColumns(field).map(({ key, heading, data_type }) => [key, heading, data_type]),
      ]);

      if (seen.has(signature)) continue;
      seen.add(signature);
      schemas.push({
        field: { ...field, name: row.field.name },
        label: template ? "Template draft" : `Candidate ${candidates.indexOf(current) + 1} · ${templateLabel(current.template)}`,
      });
    }

    if (!schemas.length) schemas.push({ field: row.field, label: "saved answer fields" });
    setReferenceEditor({
      row,
      from,
      previousField,
      sourceField: candidate ? row.candidates[candidate.id] : previousField,
      schemas,
      initial: candidate
        ? {
            value: raw?.answer,
            absent: raw?.status === "not_found",
            exact: existing?.exact || false,
            rows: existing && adaptReferenceDraft(existing, previousField, row.candidates[candidate.id]).rows,
            verified: existing?.verified,
          }
        : existing || { value: "", absent: false, exact: false },
    });
  };

  // One click uses a scalar answer as verified; anything that needs checking opens the editor.
  const acceptAnswer = (row, candidate) => {
    const raw = rawFor(row, candidate);
    const existing = references[row.identity];

    const next =
      raw?.status === "not_found"
        ? { verified: true, absent: true, exact: false, value: "" }
        : { verified: true, absent: false, exact: existing?.exact || false, value: raw?.answer };

    if (row.field.data_type === "array<object>" || validateReference(row.field, next)) {
      reference(row, candidate);

      return;
    }

    const from = reviewFrom(row);

    if (from) evaluation.reviewReference(document.key, from, row.identity, next, row.field);
    else saveReference(row, next);
  };

  const compact = (field, raw) => {
    if (!raw || raw.status === "not_found") return <span className="evaluation-muted">Not found</span>;

    if (field.data_type === "array<object>") {
      const records = tableAnswerRows(raw.answer);

      return records ? `${records.length} ${records.length === 1 ? "row" : "rows"}` : "Unreadable table";
    }

    if ((Array.isArray(raw.answer) || isJsonObject(raw.answer)) && raw.answer !== null)
      return <code>{JSON.stringify(raw.answer)}</code>;
    const normalized = field.data_type === "boolean" ? scalarValue(raw.answer, "boolean") : null;

    return display(normalized?.valid ? normalized.value : raw.answer);
  };

  const setColumn = (candidate, field, expected, value) =>
    evaluation.setColumns(candidate.id, {
      ...state.columns[candidate.id],
      [field.id]: { ...state.columns[candidate.id]?.[field.id], [expected]: value },
    });

  const renderValue = (row, candidate, full = false) => {
    const field = row.candidates[candidate.id];

    if (!field) return <span className="evaluation-muted">Not requested</span>;

    if (!candidate.result)
      return (
        <span className="evaluation-muted">
          {candidate.detailState === "loading" ? "Loading result…" : "Run to compare"}
        </span>
      );
    const raw = rawFor(row, candidate);
    const score = scores[candidate.id].byField[field.id];
    const columns = tableColumns(field);
    const tableRows = tableAnswerRows(raw?.answer);

    return (
      <div className="evaluation-value">
        <Mark state={score?.state} />
        {!["ok", "found"].includes(raw?.status) && (
          <small>{raw?.status === "not_found" || !raw ? "Not found in document" : statusLabel(raw.status)}</small>
        )}
        {field.data_type === "array<object>" && tableRows !== null && columns.length ? (
          <>
            <div className="evaluation-table-scroll">
              <DataTable compact>
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c.key}>{c.heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.slice(0, full ? undefined : 3).map((r, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td key={c.key}>{display(r?.[c.key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
            <small>
              {pluralize(tableRows.length, "row")}{!full && tableRows.length > 3 ? " · showing first 3" : ""}
            </small>
          </>
        ) : (
          <pre>{display(raw?.answer)}</pre>
        )}
        {score?.reason && <p>{score.reason}</p>}
        {score?.kind === "table" && (
          <p>
            Cells: {score.matched}/{score.total} · Missing rows: {score.missing.join(", ") || "none"} · Extra rows:{" "}
            {score.extra.join(", ") || "none"}
          </p>
        )}
        {full && score?.cells?.some((cell) => !cell.match) && (
          <details>
            <summary>Cell mismatches</summary>
            {score.cells.reduce((paragraphs, cell) => {
              if (!cell.match)
                paragraphs.push(
                  <p key={paragraphs.length}>
                    Row {cell.row} · {cell.column}: {display(cell.actual)} → Expected {display(cell.expected)}
                  </p>,
                );

              return paragraphs;
            }, [])}
          </details>
        )}
        {full && columns.length > 0 && (
          <details>
            <summary>Align table columns</summary>
            {tableColumns(row.field).map((expected) => (
              <label key={expected.key}>
                {expected.heading}
                <select
                  aria-label={`Align ${expected.heading} in ${candidate.model}`}
                  value={state.columns[candidate.id]?.[field.id]?.[expected.key] || ""}
                  onChange={(event) => setColumn(candidate, field, expected.key, event.target.value)}
                >
                  <option value="">Match by name and type</option>
                  {columns.flatMap((c) =>
                    c.data_type === expected.data_type
                      ? [
                          <option key={c.key} value={c.key}>
                            {c.heading}
                          </option>,
                        ]
                      : [],
                  )}
                </select>
              </label>
            ))}
          </details>
        )}
      </div>
    );
  };

  const openComparison = (row) =>
    row.field.data_type === "array<object>"
      ? setExpanded({ identity: row.identity, table: true })
      : setExpanded({ identity: row.identity });

  const inspected =
    inspect && rows.has(inspect.identity) && candidates.find((c) => c.id === inspect.candidateId)?.result
      ? { row: rows.get(inspect.identity), candidate: candidates.find((c) => c.id === inspect.candidateId) }
      : null;

  const waiting = (candidate) =>
    candidate.detailState === "loading"
      ? "Loading result…"
      : candidate.detailState === "unavailable"
        ? "Details unavailable · rerun"
        : candidateBusy(candidate)
          ? "Running…"
          : "Run to compare";

  return (
    <>
      {changes.size > 0 && (
        <Callout
          tone="warning"
          action={
            onFilterChange && (
              <Button variant="text" onClick={() => onFilterChange(filter === "changes" ? "all" : "changes")}>
                {filter === "changes" ? "Show all fields" : "Review template changes"}
              </Button>
            )
          }
        >
          {changes.size} {changes.size === 1 ? "field differs" : "fields differ"} from the saved answers. Review changed
          fields, enter new answers, or link renamed fields.
        </Callout>
      )}
      <div className={`evaluation-body ${inspected ? "inspecting" : ""}`}>
        <ScrollArea className="evaluation-comparison-scroll" tabIndex={0} role="region" aria-label="Comparison matrix">
          <DataTable matrix className="evaluation-matrix" style={{ minWidth: template ? 550 : 390 + candidates.length * 220 + 160 }}>
            <thead>
              <tr>
                <th className="evaluation-field-col">Field</th>
                <th className="evaluation-expected-col">Expected</th>
                {candidates.map((candidate, index) => {
                  const score = scores[candidate.id];
                  const accuracy = candidateAccuracy(score);
                  const best = candidate.id === bestId;

                  const previous =
                    candidate.result &&
                    (candidate.previousShown ||
                      candidateBusy(candidate) ||
                      ["failure", "interrupted"].includes(candidate.status));

                  return (
                    <CandidateHead
                      key={candidate.id}
                      candidate={candidate}
                      index={index}
                      mode={state.mode}
                      onModelChange={(model) => evaluation.edit(candidate.id, { model })}
                      menu={menuFor(candidate, index)}
                      run={runFor(candidate, index)}
                      foot={
                        <>
                          <StatusLine candidate={candidate} />
                          <small>
                            {previous
                              ? "Previous result"
                              : candidate.detailState === "unavailable"
                                ? "Details unavailable"
                                : !candidate.result
                                  ? ""
                                  : accuracy
                                    ? `${accuracy.matched}/${accuracy.total} fields${score.tables ? ` · ${score.tables.matched}/${score.tables.total} cells` : ""}`
                                    : score.tablesNeedingReview
                                      ? "Table needs review"
                                      : "Not scored yet"}
                          </small>
                        </>
                      }
                    >
                      <div className="evaluation-candidate-score">
                        <strong>{accuracy ? percent(accuracy.ratio) : "—"}</strong>
                        {best && <Badge tone="success">Best</Badge>}
                        <RunCost result={candidate.result} />
                        <Meter value={accuracy?.ratio} best={best} />
                      </div>
                      {candidate.message && (
                        <p role="alert" className="evaluation-candidate-alert" title={candidate.message}>
                          {candidate.message}
                        </p>
                      )}
                    </CandidateHead>
                  );
                })}
                {!template && (
                  <th className="evaluation-add-col">
                    <Button variant="secondary"
                      disabled={candidates.length >= MAX_CANDIDATES}
                      onClick={onAddCandidate}
                    >
                      <PlusIcon size={13} /> Add candidate
                    </Button>
                    <small>
                      {candidates.length}/{MAX_CANDIDATES}
                    </small>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const answered = candidates.filter((c) => c.result && row.candidates[c.id]).length;

                const from = reviewFrom(row);

                return (
                  <tr key={row.identity} className={row.omitted ? "evaluation-omitted-row" : undefined}>
                    <th scope="row" className="evaluation-field-col">
                      <strong>{row.linked ? row.linked.field.name : row.field.name}</strong>
                      <small className="evaluation-type">{getDataTypeLabel(row.field.data_type)}</small>
                      {changes.has(row.identity) && !row.omitted && (
                        <small className="evaluation-warn-text evaluation-block">{changes.get(row.identity)}</small>
                      )}
                      {row.linked && (
                        <LinkedNote
                          savedName={row.field.name}
                          fieldName={row.linked.field.name}
                          onUnlink={() => evaluation.linkField(document.key, row.linked.own, null)}
                        />
                      )}
                      {row.omitted && references[row.identity]?.verified && (
                        <small className="evaluation-muted evaluation-block">
                          {template
                            ? "Removed from the Template draft · saved answer kept"
                            : "Saved answer not requested by any candidate · shown in coverage"}
                        </small>
                      )}
                      {row.omitted && references[row.identity]?.verified && (
                        <LinkSavedAnswer
                          name={row.field.name}
                          options={linkableFields(document, templateFields, row.identity)}
                          onLink={(own) => evaluation.linkField(document.key, own, row.identity)}
                        />
                      )}
                      {row.omitted && (
                        <Button variant="danger-text" className="evaluation-compare-link"
                          aria-label={`Remove expected answer for ${row.field.name}`}
                          onClick={() => evaluation.removeReference(document.key, row.identity)}>
                          Remove expected answer
                        </Button>
                      )}
                      {!row.omitted && !from && saved[row.identity] && changes.has(row.identity) && (
                        <Button variant="text" className="evaluation-compare-link" onClick={() => reference(row)}>
                          Review field changes
                        </Button>
                      )}
                      {COMPARABLE_TYPES.includes(row.field.data_type) && answered > 0 && (
                        <Button variant="text"
                          className="evaluation-compare-link"
                          onClick={() => openComparison(row)}
                        >
                          Compare all {answered}{" "}
                          {row.field.data_type === "array<object>" ? (answered === 1 ? "table" : "tables") : "answers"}{" "}
                          <ExternalIcon size={12} />
                        </Button>
                      )}
                    </th>
                    <td className="evaluation-expected-col">
                      {row.omitted ? (
                        <span className="evaluation-muted">{refText(references[row.identity], row.field)}</span>
                      ) : from ? (
                        <ReviewPrompt
                          field={row.candidates[changedTableCandidate(row, true)?.id] || row.field}
                          definition={saved[from]}
                          reference={references[from]}
                          onReview={() => reference(row)}
                        />
                      ) : (
                        <ExpectedInline
                          key={`${row.identity}:${references[row.identity]?.verified}`}
                          field={row.field}
                          reference={references[row.identity]}
                          onSave={(value) => saveReference(row, value)}
                          onOpenEditor={() => reference(row)}
                        />
                      )}
                    </td>
                    {candidates.map((candidate, index) => {
                      const field = row.candidates[candidate.id];
                      const score = field && scores[candidate.id].byField[field.id];
                      const active = inspect?.identity === row.identity && inspect?.candidateId === candidate.id;

                      return (
                        <td
                          key={candidate.id}
                          className={`evaluation-cell ${score?.state === "Mismatch" ? "mismatch" : ""} ${active ? "active" : ""}`}
                        >
                          {!field ? (
                            <span className="evaluation-muted">Not requested</span>
                          ) : !candidate.result ? (
                            <span className="evaluation-muted">{waiting(candidate)}</span>
                          ) : (
                            <button
                              type="button"
                              className="evaluation-cell-button"
                              aria-label={`Inspect ${row.field.name} for Candidate ${index + 1}`}
                              aria-pressed={active}
                              onClick={() =>
                                setInspect(active ? null : { identity: row.identity, candidateId: candidate.id })
                              }
                            >
                              <Mark state={score?.state} />
                              <span className="evaluation-cell-value">
                                {compact(field, rawFor(row, candidate))}
                                {score?.reason && <small>{score.reason}</small>}
                              </span>
                            </button>
                          )}
                        </td>
                      );
                    })}
                    {!template && <td className="evaluation-add-col" />}
                  </tr>
                );
              })}
              {!visible.length && (
                <tr>
                  <td colSpan={template ? 2 : 3 + candidates.length} className="evaluation-empty-row">
                    {template && !allRows.length
                      ? "No saved fields. Use Edit Template to add fields."
                      : "No fields match this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </DataTable>
        </ScrollArea>
        {inspected && (
          <aside className="evaluation-inspector" aria-label="Answer inspector">
            <div className="evaluation-inspector-head">
              <div>
                <small>
                  {labelFor(inspected.candidate)}
                  {batch ? ` · ${document.name}` : ""}
                </small>
                <h2>{inspected.row.field.name}</h2>
              </div>
              <IconButton size="sm" label="Close inspector" icon={CloseIcon} onClick={() => setInspect(null)} />
            </div>
            <ScrollArea className="evaluation-inspector-body">
              <section>
                <h3>Answer</h3>
                {renderValue(inspected.row, inspected.candidate, true)}
                <div className="evaluation-actions start">
                  {!COMPARABLE_TYPES.includes(inspected.row.field.data_type) &&
                    scores[inspected.candidate.id].byField[inspected.row.candidates[inspected.candidate.id].id]
                      ?.state !== "Match" && (
                      <Button onClick={() => acceptAnswer(inspected.row, inspected.candidate)}>
                        {references[inspected.row.identity]?.verified
                          ? "Replace expected with this answer"
                          : "Use as expected answer"}
                      </Button>
                    )}
                  <Button variant="secondary"
                    onClick={() => reference(inspected.row, inspected.candidate)}
                  >
                    Review as expected answer
                  </Button>
                </div>
              </section>
              <section>
                <h3>Expected</h3>
                <p className="evaluation-inspector-value">
                  {references[inspected.row.identity]?.verified ? (
                    references[inspected.row.identity].absent ? (
                      "Not in document"
                    ) : Array.isArray(references[inspected.row.identity].value) ? (
                      `${references[inspected.row.identity].value.length} expected rows`
                    ) : (
                      display(references[inspected.row.identity].value)
                    )
                  ) : (
                    <span className="evaluation-muted">Not verified yet</span>
                  )}
                </p>
              </section>
              <section>
                <h3>Other candidates</h3>
                <ul className="evaluation-inspector-others">
                  {candidates.flatMap((c) =>
                    c.id !== inspected.candidate.id && c.result && inspected.row.candidates[c.id]
                      ? [
                          <li key={c.id}>
                            <Mark state={scores[c.id].byField[inspected.row.candidates[c.id].id]?.state} />
                            <span>{labelFor(c)}</span>
                            <span>{compact(inspected.row.candidates[c.id], rawFor(inspected.row, c))}</span>
                          </li>,
                        ]
                      : [],
                  )}
                </ul>
                {COMPARABLE_TYPES.includes(inspected.row.field.data_type) && (
                  <Button variant="text" onClick={() => openComparison(inspected.row)}>
                    Compare all candidates <ExternalIcon size={12} />
                  </Button>
                )}
              </section>
            </ScrollArea>
          </aside>
        )}
      </div>
      {referenceEditor && (
        <ReferenceModal
          {...referenceEditor}
          onClose={() => setReferenceEditor(null)}
          onRemoveVerification={() => {
            const identity = referenceEditor.from || referenceEditor.row.identity;
            evaluation.setReference(
              document.key,
              identity,
              { ...references[identity], verified: false },
              referenceEditor.previousField,
            );
            setReferenceEditor(null);
          }}
          onSaveField={(value, field) => {
            if (referenceEditor.from)
              evaluation.reviewReference(
                document.key,
                referenceEditor.from,
                referenceEditor.row.identity,
                value,
                field,
              );
            else saveReference({ ...referenceEditor.row, field }, value);
            setReferenceEditor(null);
          }}
        />
      )}
      {expanded?.table && !referenceEditor && rows.has(expanded.identity) && (
        <TableComparison
          row={rows.get(expanded.identity)}
          candidates={candidates}
          reference={references[expanded.identity]}
          scores={scores}
          columnMappings={state.columns}
          labelFor={labelFor}
          onEditExpected={() => reference(rows.get(expanded.identity))}
          onClose={() => setExpanded(null)}
        />
      )}
      {expanded && !expanded.table && rows.has(expanded.identity) && (
        <ModalDialog className="evaluation-expanded" label="Expanded comparison" onClose={() => setExpanded(null)}>
          <div className="evaluation-heading">
            <h2>{rows.get(expanded.identity).field.name}</h2>
            <IconButton size="sm" label="Close" icon={CloseIcon} className="modal-close" onClick={() => setExpanded(null)} />
          </div>
          <div className="evaluation-expanded-grid">
            {candidates.map((c, i) => (
              <section key={c.id}>
                <h3>
                  Candidate {i + 1} · {c.result?.model || c.model}
                </h3>
                {renderValue(rows.get(expanded.identity), c, true)}
              </section>
            ))}
          </div>
        </ModalDialog>
      )}
    </>
  );
}
