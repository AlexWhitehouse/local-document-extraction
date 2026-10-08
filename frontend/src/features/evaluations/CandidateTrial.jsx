import React, { useEffect, useState } from "react";
import { pluralize } from "../../lib/text.js";
import { Button } from "../ui/Button.jsx";
import { Badge } from "../ui/Status.jsx";
import { DataTable } from "../ui/DataTable.jsx";
import { Callout } from "../ui/Callout.jsx";
import { ErrorState, LoadingState } from "../ui/States.jsx";
import { percent } from "./evaluationFormat.js";
import { pairBusy } from "./useEvaluations.js";
import { compareCandidates, shownRecord } from "./candidateImprovement.js";

const VERDICTS = {
  improved: ["success", "Improved"],
  regressed: ["danger", "Regressed"],
  unchanged: ["neutral", "Unchanged"],
  unscored: ["neutral", "Not scored"],
};

const counts = (value) => (value?.total ? `${percent(value.matched / value.total)} (${value.matched}/${value.total})` : "—");

function Verdict({ verdict }) {
  const [tone, label] = VERDICTS[verdict];

  return <Badge tone={tone}>{label}</Badge>;
}

/**
 * Before/after accuracy for a candidate and the edited copy made by "Test changes", over the
 * documents the copy ran on. The original candidate is never changed; the user keeps or removes the copy.
 */
export function CandidateTrial({ evaluation, trial, labelFor, onKeep, onRemove, onRun }) {
  const { state } = evaluation;
  const original = state.candidates.find((c) => c.id === trial.originalId);
  const copy = state.candidates.find((c) => c.id === trial.copyId);
  const pairs = trial.documentKeys.map((key) => state.pairs[key]?.[trial.copyId]);
  // A run that couldn't start (settings changed, no Model gateway) leaves the copy without results.
  const started = pairs.some(Boolean);
  const running = Boolean(trial.pending) || pairs.some((pair) => pair && pairBusy(pair));
  const done = pairs.filter((pair) => pair && !pairBusy(pair)).length;
  const failed = pairs.filter((pair) => pair && ["failure", "interrupted"].includes(pair.status)).length;
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const signature =
    running || !started
      ? null
    : JSON.stringify(
        trial.documentKeys.map((key) => [
          shownRecord(state.pairs[key]?.[trial.originalId])?.recordId,
          shownRecord(state.pairs[key]?.[trial.copyId], { previous: false })?.recordId,
        ]),
      );

  // Rescores when results, expected answers or alignments change; late comparisons are discarded.
  useEffect(() => {
    if (!signature) return undefined;
    let current = true;
    setError(null);
    compareCandidates(evaluation, trial.originalId, trial.copyId, trial.documentKeys)
      .then((next) => {
        if (current) setComparison(next);
      })
      .catch((failure) => {
        if (current) setError(failure);
      });

    return () => {
      current = false;
    };
    // The evaluation object changes every render; its documents, alignments and columns are the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, state.documents, state.alignments, state.columns, attempt, trial]);

  if (!original || !copy) return null;

  return (
    <section className="evaluation-trial" aria-label="Test changes">
      <div className="evaluation-trial-head">
        <div>
          <h2>Test changes</h2>
          <p className="evaluation-muted">
            {labelFor(original)} compared with its edited copy, {labelFor(copy)}.
          </p>
        </div>
        <div className="evaluation-actions">
          <Button variant="secondary" onClick={onKeep}>
            Keep copy
          </Button>
          <Button variant="danger-text" disabled={running} onClick={onRemove}>
            Remove copy
          </Button>
        </div>
      </div>
      {running ? (
        <LoadingState label={`Running the copy… ${done} of ${pluralize(pairs.length, "document")}`} />
      ) : !started ? (
        <Callout
          tone="info"
          action={
            <Button variant="secondary" onClick={onRun}>
              Run copy
            </Button>
          }
        >
          The copy hasn’t run yet.
        </Callout>
      ) : error ? (
        <ErrorState
          error={error}
          fallback="Couldn’t compare the results. Try again."
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : !comparison ? (
        <LoadingState label="Comparing results…" />
      ) : (
        <>
          <p className="evaluation-trial-summary">
            <Verdict verdict={comparison.overall.verdict} />
            <span>
              Accuracy {counts(comparison.overall.before)} → {counts(comparison.overall.after)} on{" "}
              {pluralize(comparison.documents, "document")}
            </span>
          </p>
          {failed ? (
            <Callout tone="warning">
              {pluralize(failed, "run")} didn’t finish, so {failed === 1 ? "that document isn’t" : "those documents aren’t"}{" "}
              compared. Run the copy again to include {failed === 1 ? "it" : "them"}.
            </Callout>
          ) : null}
          {comparison.fields.length ? (
            <DataTable compact label="Accuracy by field" className="evaluation-trial-table">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {comparison.fields.map((field) => (
                  <tr key={field.name}>
                    <th scope="row">{field.name}</th>
                    <td>{counts(field.before)}</td>
                    <td>{counts(field.after)}</td>
                    <td>
                      <Verdict verdict={field.verdict} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <p className="evaluation-muted">No verified fields to compare. Verify expected answers to score them.</p>
          )}
        </>
      )}
    </section>
  );
}
