import React, { useState } from "react";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { alignTableRows, tableCellMatches, tableCellsEqual } from "./evaluationScoring.js";
import { Mark } from "./EvaluationParts.jsx";
import { display } from "./evaluationFormat.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { CloseIcon } from "../layout/Icons.jsx";
import { Segmented } from "../ui/Tabs.jsx";

const blank = (value) => value === undefined || value === null || value === "";

// Every candidate's rows for one table field, aligned so the same row reads together.
export function TableComparison({
  row,
  candidates,
  reference,
  scores,
  columnMappings,
  labelFor,
  onEditExpected,
  onClose,
}) {
  const [layout, setLayout] = useState("rows");
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const verified = reference?.verified && !reference.absent && Array.isArray(reference.value);
  const answered = candidates.filter((c) => c.result && row.candidates[c.id]);
  const rawFor = (candidate) => candidate.result.raw.find((r) => r.field_id === row.candidates[candidate.id].id);

  const sources = [
    ...(verified ? [{ id: "expected", label: "Expected answer", expected: true, rows: reference.value }] : []),
    ...answered.map((c) => ({
      id: c.id,
      label: labelFor(c),
      field: row.candidates[c.id],
      rows: rawFor(c)?.answer,
      mappings: columnMappings[c.id]?.[row.candidates[c.id].id],
    })),
  ];

  const { columns, lines, unaligned } = alignTableRows(row.field, verified ? reference : null, sources);
  const firstCandidate = verified ? 1 : 0;

  // Verified rows are the baseline; until then, cells compare with the most common candidate value.
  const baseline = (line, column) => {
    if (verified) return line.rows[0]?.[column.key];
    const values = line.rows.flatMap((row) => (row ? [row[column.key]] : []));
    const count = (value) => values.filter((other) => tableCellsEqual(column, other, value)).length;

    return values.reduce((best, value) => (count(value) > count(best) ? value : best), values[0]);
  };

  const cellState = (line, column) => verified && reference.cellStates?.[line.expectedIndex]?.[column.key];

  const differs = (line, index, column) =>
    index >= firstCandidate &&
    !!line.rows[index] &&
    !(verified && line.rows[0]
      ? tableCellMatches(
          column,
          line.rows[index][column.key],
          baseline(line, column),
          cellState(line, column),
          reference.exact,
        )
      : tableCellsEqual(column, line.rows[index][column.key], baseline(line, column), reference?.exact));

  const rowState = (line, index) => {
    if (sources[index].expected) return line.rows[index] ? "expected" : "none";

    if (!line.rows[index]) return verified && line.rows[0] ? "missing" : "none";

    if (line.extra) return "extra";

    return columns.some((column) => differs(line, index, column)) ? "differs" : "same";
  };

  const hasDifference = (line) =>
    sources.some((_, i) => ["missing", "extra", "differs"].includes(rowState(line, i))) ||
    (!verified && line.rows.some((r) => !r));

  const visible = onlyDifferences ? lines.filter(hasDifference) : lines;

  const cell = (line, index, column, extraClass = "") => {
    const wrong = differs(line, index, column);
    const value = line.rows[index][column.key];
    const state = cellState(line, column);
    const expectedLabel = state === "absent" ? "Not in document" : display(baseline(line, column));

    return (
      <td
        key={`${sources[index].id}-${column.key}`}
        className={[extraClass, wrong && "evaluation-compare-differs"].filter(Boolean).join(" ") || undefined}
        title={
          state === "ignored"
            ? "Excluded from accuracy scores"
            : wrong
              ? `${verified ? "Expected" : "Most common"}: ${expectedLabel}`
              : undefined
        }
      >
        {sources[index].expected && state ? (
          <span className="evaluation-input-hint">{state === "ignored" ? "Ignored" : "Not in document"}</span>
        ) : blank(value) ? (
          "—"
        ) : (
          display(value)
        )}
      </td>
    );
  };

  const scoreFor = (candidate) => scores[candidate.id].byField[row.candidates[candidate.id].id];

  const summary = (candidate, i) => {
    const score = scoreFor(candidate);
    const rows = sources[i + firstCandidate].rows;
    const count = Array.isArray(rows) ? rows.length : Array.isArray(rows?.rows) ? rows.rows.length : 0;

    return score?.kind === "table"
      ? `${score.matched}/${score.total} cells${score.missing.length ? ` · ${score.missing.length} missing` : ""}${score.extra.length ? ` · ${score.extra.length} extra` : ""}`
      : `${count} ${count === 1 ? "row" : "rows"} · ${score?.state === "Needs review" ? "needs review" : "unscored"}`;
  };

  const matching = verified
    ? !reference.rows || reference.rows.mode !== "key"
      ? "Rows matched by position."
      : `Rows matched by ${columns.find((c) => c.key === reference.rows.key)?.heading || "key"}.`
    : "";

  return (
    <ModalDialog className="evaluation-compare" label={`${row.field.name} across candidates`} onClose={onClose}>
      <div className="evaluation-dialog-head">
        <div>
          <h2>{row.field.name} · all candidates</h2>
          <p>
            {verified
              ? `${matching} Highlighted cells differ from the expected rows.`
              : "No expected rows yet. Highlighted cells differ from the most common candidate value."}
          </p>
        </div>
        <IconButton size="sm" label="Close table comparison" icon={CloseIcon} className="modal-close" onClick={onClose} />
      </div>
      <div className="evaluation-compare-summary">
        {answered.map((candidate, i) => (
          <div key={candidate.id} className="evaluation-compare-chip">
            <Mark state={scoreFor(candidate)?.state} />
            <span>
              <strong>{labelFor(candidate)}</strong>
              <small>{summary(candidate, i)}</small>
              {unaligned[i + firstCandidate].length > 0 && (
                <small className="evaluation-warn-text">
                  Unmatched columns: {unaligned[i + firstCandidate].join(", ")}
                </small>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="evaluation-compare-toolbar">
        <Segmented
          label="Table layout"
          value={layout}
          onChange={setLayout}
          items={[
            { value: "rows", label: "By row" },
            { value: "stacked", label: "Stacked" },
            { value: "side", label: "Side by side" },
          ]}
        />
        <label className="evaluation-check">
          <input
            type="checkbox"
            checked={onlyDifferences}
            onChange={(event) => setOnlyDifferences(event.target.checked)}
          />
          Only rows with differences
        </label>
        <span className="evaluation-legend" aria-hidden="true">
          <i className="differs" />
          Differs
          <i className="missing" />
          Missing row
          <i className="extra" />
          Extra row
        </span>
        <Button variant="secondary" onClick={onEditExpected}>
          {verified ? "Edit expected rows" : "Add expected rows"}
        </Button>
      </div>
      <ScrollArea className="evaluation-compare-scroll" role="region" aria-label="Aligned table rows" tabIndex={0}>
        {!visible.length ? (
          <p className="evaluation-empty-row">
            {onlyDifferences ? "Every candidate matches on every row." : "No rows returned."}
          </p>
        ) : layout === "rows" ? (
          <table className="evaluation-compare-rows" aria-label="Rows by candidate">
            <thead>
              <tr>
                <th className="evaluation-compare-number">Row</th>
                <th className="evaluation-compare-source">Source</th>
                {columns.map((c) => (
                  <th key={c.key}>{c.heading}</th>
                ))}
              </tr>
            </thead>
            {visible.map((line) => (
              <tbody key={line.key} className="evaluation-compare-group">
                {sources.map((source, index) => {
                  const state = rowState(line, index);

                  return (
                    <tr key={source.id} className={`evaluation-compare-${state}`}>
                      {index === 0 && (
                        <th className="evaluation-compare-number" rowSpan={sources.length}>
                          {String(line.number).padStart(2, "0")}
                        </th>
                      )}
                      <th className="evaluation-compare-source">
                        {source.label}
                        {state === "extra" && <em>Extra row</em>}
                      </th>
                      {line.rows[index] ? (
                        columns.map((column) => cell(line, index, column))
                      ) : (
                        <td colSpan={columns.length} className="evaluation-compare-missing">
                          {state === "missing" ? "Row missing" : "No row"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        ) : layout === "stacked" ? (
          <div className="evaluation-compare-stack">
            {sources.map((source, index) => {
              const own = visible.filter((line) => rowState(line, index) !== "none");
              const candidate = !source.expected && answered[index - firstCandidate];

              return (
                <section
                  key={source.id}
                  className={`evaluation-compare-stack-item ${source.expected ? "expected" : ""}`}
                  aria-label={`${source.label} rows`}
                >
                  <h3>
                    {candidate && <Mark state={scoreFor(candidate)?.state} />}
                    <strong>{source.label}</strong>
                    <small>
                      {candidate
                        ? summary(candidate, index - firstCandidate)
                        : `${own.length} ${own.length === 1 ? "row" : "rows"}`}
                    </small>
                  </h3>
                  <table
                    className="evaluation-compare-rows"
                    aria-label={`${source.label} table`}
                    style={{ "--compare-columns": columns.length }}
                  >
                    <thead>
                      <tr>
                        <th className="evaluation-compare-number">Row</th>
                        {columns.map((c) => (
                          <th key={c.key}>{c.heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {own.length ? (
                        own.map((line) => {
                          const state = rowState(line, index);

                          return (
                            <tr key={line.key} className={`evaluation-compare-${state}`}>
                              <th className="evaluation-compare-number">
                                {String(line.number).padStart(2, "0")}
                                {state === "extra" && <em>Extra</em>}
                              </th>
                              {line.rows[index] ? (
                                columns.map((column) =>
                                  cell(line, index, column, source.expected ? "evaluation-compare-expected-cell" : ""),
                                )
                              ) : (
                                <td colSpan={columns.length} className="evaluation-compare-missing">
                                  Row missing
                                </td>
                              )}
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={columns.length + 1} className="evaluation-compare-missing none">
                            No rows
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </section>
              );
            })}
          </div>
        ) : (
          <table className="evaluation-compare-side" aria-label="Candidates side by side">
            <thead>
              <tr>
                <th className="evaluation-compare-number" rowSpan={2}>
                  Row
                </th>
                {sources.map((s) => (
                  <th
                    key={s.id}
                    colSpan={columns.length}
                    className={`evaluation-compare-block ${s.expected ? "expected" : ""}`}
                  >
                    {s.label}
                  </th>
                ))}
              </tr>
              <tr>
                {sources.map((s) =>
                  columns.map((c, ci) => (
                    <th key={`${s.id}-${c.key}`} className={ci === 0 ? "evaluation-compare-block-start" : undefined}>
                      {c.heading}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((line) => (
                <tr key={line.key} className={line.extra ? "evaluation-compare-extra" : undefined}>
                  <th className="evaluation-compare-number">{String(line.number).padStart(2, "0")}</th>
                  {sources.map((source, index) =>
                    line.rows[index] ? (
                      columns.map((column, ci) =>
                        cell(
                          line,
                          index,
                          column,
                          [
                            ci === 0 && "evaluation-compare-block-start",
                            source.expected && "evaluation-compare-expected-cell",
                          ]
                            .filter(Boolean)
                            .join(" "),
                        ),
                      )
                    ) : (
                      <td
                        key={source.id}
                        colSpan={columns.length}
                        className={`evaluation-compare-block-start evaluation-compare-missing ${rowState(line, index) === "missing" ? "" : "none"}`}
                      >
                        {rowState(line, index) === "missing" ? "Row missing" : "—"}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>
    </ModalDialog>
  );
}
