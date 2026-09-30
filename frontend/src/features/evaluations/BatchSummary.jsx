import React from "react";
import { Mark, Meter, StatusLine } from "./EvaluationParts.jsx";
import { CandidateHead } from "./DocumentMatrix.jsx";
import { Chips } from "./EvaluationLibrary.jsx";
import { percent, seconds } from "./evaluationFormat.js";
import { MAX_CANDIDATES, documentRunnable, pairBusy } from "./useEvaluations.js";
import { documentChips } from "./evaluationLibrary.js";
import { documentCompatibility } from "./evaluationScoring.js";

const counts = (summary, total) => [`${summary.done}/${total} done`, summary.pending && `${summary.pending} pending`, summary.failed && `${summary.failed} failed`, summary.outdated && `${summary.outdated} need rerun`,
  summary.detailsUnavailable && `${summary.detailsUnavailable} details unavailable`, summary.unscored && `${summary.unscored} unscored`, summary.review && `${summary.review} review`, summary.unavailable && `${summary.unavailable} can’t run`].filter(Boolean).join(" · ");

// Every document counts equally. Built from compact per-pair metrics only; it never loads result details.
export function BatchSummary({ evaluation, summary, fields, menuFor, onOpenDocument, onAddCandidate }) {
  const { state } = evaluation;
  const runnable = state.documents.filter(documentRunnable).map(d => d.key);
  const total = state.documents.length;
  return <table className="evaluation-matrix evaluation-summary" style={{ minWidth: 420 + state.candidates.length * 230 + 160 }}>
    <thead><tr><th className="evaluation-field-col">Document</th><th className="evaluation-expected-col">Expected answers</th>
      {state.candidates.map((candidate, index) => {
        const s = summary.per[candidate.id], best = summary.best.includes(candidate.id), label = `Candidate ${index + 1}`;
        const busy = runnable.some(key => pairBusy(state.pairs[key]?.[candidate.id]));
        return <CandidateHead key={candidate.id} candidate={candidate} index={index} mode={state.mode} onModelChange={model => evaluation.edit(candidate.id, { model })} menu={menuFor(candidate, index)}
          run={{ label: `Run ${label} on all documents`, title: "Run candidate on all documents", disabled: !runnable.length || busy || state.stale || !candidate.model.trim(), onClick: () => evaluation.run([candidate.id]) }}
          foot={<small className="evaluation-summary-counts">{counts(s, total)}</small>}>
          <div className="evaluation-candidate-score"><strong>{percent(s.scalar)}</strong>{best && <span className="status-chip good">{summary.best.length > 1 ? "Tied best" : "Best"}</span>}<Meter value={s.scalar} best={best} /></div>
          <dl className="evaluation-summary-metrics">
            <div><dt>Field accuracy</dt><dd>{percent(s.scalar)} <small>{s.scalarDocs} of {total} docs</small></dd></div>
            <div><dt>Table cells</dt><dd>{percent(s.cells)} <small>{s.cellsDocs} of {total} docs</small></dd></div>
            <div><dt>Coverage</dt><dd>{percent(s.coverage)} <small>{s.coverageDocs} of {total} docs</small></dd></div>
            <div><dt>Avg time</dt><dd>{s.ms !== null ? seconds(s.ms) : "—"}</dd></div>
          </dl>
        </CandidateHead>;
      })}
      <th className="evaluation-add-col"><button type="button" className="secondary" disabled={state.candidates.length >= MAX_CANDIDATES} onClick={onAddCandidate}>+ Add candidate</button><small>{state.candidates.length}/{MAX_CANDIDATES}</small></th>
    </tr></thead>
    <tbody>{state.documents.map((document, row) => {
      const compatibility = documentCompatibility(document, fields);
      return <tr key={document.key}>
        <th className="evaluation-field-col"><button type="button" className="studio-text-button evaluation-doc-link" onClick={() => onOpenDocument(document.key)}>{document.name} ↗</button><Chips list={documentChips(document, fields).slice(0, 2)} /></th>
        <td className="evaluation-expected-col"><span className="evaluation-progress"><Meter value={compatibility.total ? compatibility.verified / compatibility.total : 0} best /><small>{compatibility.verified}/{compatibility.total} verified</small></span>
          {compatibility.review > 0 && <small className="evaluation-warn-text evaluation-block">{compatibility.review} needs review</small>}
          {!compatibility.verified && <small className="evaluation-muted evaluation-block">Unscored · compare only</small>}</td>
        {state.candidates.map((candidate, index) => {
          const { pair, metrics } = summary.per[candidate.id].rows[row];
          const status = { ...candidate, status: pair?.status || "idle", attempt: pair?.attempt, message: pair?.message, result: pair?.result || pair?.previous || null };
          const table = metrics && (metrics.missingRows || metrics.extraRows) ? ` · ${[metrics.extraRows && `${metrics.extraRows} extra ${metrics.extraRows === 1 ? "row" : "rows"}`, metrics.missingRows && `${metrics.missingRows} missing ${metrics.missingRows === 1 ? "row" : "rows"}`].filter(Boolean).join(", ")}` : "";
          const mark = metrics ? (metrics.review ? "Needs review" : metrics.fields || metrics.cells ? ((metrics.fields?.matched ?? 0) + (metrics.cells?.matched ?? 0) === (metrics.fields?.total ?? 0) + (metrics.cells?.total ?? 0) && !metrics.extraRows ? "Match" : "Mismatch") : undefined) : undefined;
          return <td key={candidate.id} className={`evaluation-cell ${mark === "Mismatch" ? "mismatch" : ""}`}>
            {!documentRunnable(document) && !pair?.result && !pair?.previous ? <span className="evaluation-muted">{document.availability === "deleted" ? "Deleted · can’t run" : "Original unavailable"}</span>
              : <div className="evaluation-pair">
                <StatusLine candidate={status} />
                {metrics ? <span className="evaluation-pair-score"><Mark state={mark} /><span>{metrics.fields ? `Fields ${metrics.fields.matched}/${metrics.fields.total}` : "No verified fields"}{metrics.cells ? ` · Cells ${metrics.cells.matched}/${metrics.cells.total}` : ""}{table}</span></span>
                  : pair?.result && pair.detail === "unavailable" ? <small className="evaluation-muted">Details unavailable · not in summary</small>
                    : pair?.result && pair.metrics?.stale ? <small className="evaluation-muted">Rescoring…</small>
                      : pair?.result ? <small className="evaluation-muted">Edited · needs rerun · not in summary</small>
                        : pair?.previous ? <small className="evaluation-muted">Previous result · not in summary</small>
                          : !pairBusy(pair) && !["failure", "interrupted"].includes(pair?.status) ? <small className="evaluation-muted">Run to compare</small> : null}
                {pair?.message && <small className="evaluation-bad-text">{pair.message}</small>}
                {documentRunnable(document) && <button type="button" className="studio-text-button evaluation-rerun" aria-label={`${pair?.status ? "Rerun" : "Run"} Candidate ${index + 1} on ${document.name}`} disabled={pairBusy(pair) || state.stale || !candidate.model.trim()} onClick={() => evaluation.run([candidate.id], [document.key])}>{pair?.status ? "↻ Rerun" : "▶ Run"}</button>}
              </div>}
          </td>;
        })}
        <td className="evaluation-add-col" />
      </tr>;
    })}
    {!state.documents.length && <tr><td colSpan={3 + state.candidates.length} className="evaluation-empty-row">Add documents to compare.</td></tr>}
    </tbody>
  </table>;
}
