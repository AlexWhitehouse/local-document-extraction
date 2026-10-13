import React, { useState } from "react";
import { describeError } from "../../../lib/describeError";
import { pluralize } from "../../../lib/text";
import { Button } from "../../ui/Button.jsx";
import { Callout } from "../../ui/Callout.jsx";
import { CheckboxField } from "../../ui/Field.jsx";
import { ErrorState, Skeleton } from "../../ui/States.jsx";
import { useAsyncAction } from "../../ui/useAsyncAction";
import { describeFilter } from "../commandParser.js";
import { bulkLimit, failedTargetIds, searchDocuments } from "../paletteSearch.js";
import { formatUploadDay, templateName, useBusyFlow, useLoad } from "../paletteState.js";
import { FlowStep } from "./flowParts.jsx";

const LIST_LIMIT = 100;

// The failed documents among the matches. A filter that asks only for other statuses has none.
function failedFilter(filter) {
  if (filter.statuses && !filter.statuses.includes("failed")) return null;

  return { ...filter, statuses: ["failed"] };
}

/**
 * The failed documents to list. From the results, only the failed ones among the documents found
 * (the newest of the failed matches, so one search names them); otherwise the newest failed matches.
 */
async function loadFailed(context, filter, targets, limit, signal) {
  const failedIds = targets ? failedTargetIds(targets) : null;

  if (!filter || failedIds?.length === 0) return { jobs: [], total: 0, hasMore: false };

  const size = failedIds ? Math.min(failedIds.length, LIST_LIMIT) : limit;
  const page = await searchDocuments(context.request, { filter, limit: size, signal });

  if (!failedIds) return page;
  const wanted = new Set(failedIds);

  return {
    jobs: page.jobs.filter((job) => wanted.has(job.job_id)),
    total: failedIds.length,
    hasMore: failedIds.length > LIST_LIMIT,
  };
}

// Try again: confirm which failed documents to queue again on their template's current version.
export function RetryFlow({ interpretation, targets, context, onFinish, onBack, registerBack, onBusyChange }) {
  const filter = failedFilter(interpretation?.filter || {});
  const [unchecked, setUnchecked] = useState(() => new Set());
  const [error, setError] = useState(null);

  const loaded = useLoad((signal) => loadFailed(context, filter, targets, bulkLimit(interpretation, LIST_LIMIT), signal), "failed");

  const jobs = loaded.data?.jobs || [];
  const checked = jobs.flatMap((job) => (unchecked.has(job.job_id) ? [] : [job.job_id]));
  const summary = interpretation?.filter ? describeFilter(interpretation.filter, context.catalog, { today: context.today }) : "";

  const [pending, run] = useAsyncAction(async () => {
    setError(null);
    let result;

    try {
      result = await context.request("/jobs/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job_ids: checked }),
      });
    } catch (failure) {
      setError(failure);

      return;
    }

    const retried = Array.isArray(result?.retried) ? result.retried.length : 0;
    const skipped = Array.isArray(result?.skipped) ? result.skipped.length : 0;

    context.notify("document.retry", retried ? "success" : "failure", { retried, skipped });
    context.documentController?.contextList?.onRetryDocumentList?.();
    onFinish();
  });

  useBusyFlow(pending, { registerBack, onBusyChange });

  if (loaded.status === "loading") return <Skeleton rows={3} label="Finding failed documents…" />;

  if (loaded.status === "error")
    return <ErrorState error={loaded.error} fallback="Couldn't find the failed documents." onRetry={loaded.retry} />;

  const toggle = (id, value) =>
    setUnchecked((current) => {
      const next = new Set(current);

      if (value) next.delete(id);
      else next.add(id);

      return next;
    });

  return (
    <FlowStep
      title="Try failed documents again"
      subtitle={summary}
      note="Uses each template's current version."
      actions={
        <>
          <Button variant="secondary" disabled={pending} onClick={onBack}>
            Cancel
          </Button>
          <Button disabled={!checked.length} pending={pending} pendingLabel="Starting…" onClick={run}>
            Try again on {pluralize(checked.length, "document")}
          </Button>
        </>
      }
    >
      {jobs.length ? (
        <div className="palette-flow-list" role="group" aria-label="Failed documents">
          {jobs.map((job) => (
            <CheckboxField
              key={job.job_id}
              label={job.source_name || job.job_id}
              description={[
                job.template_name || templateName(context.catalog, job.template_id) || "No template",
                formatUploadDay(job.created_at),
              ]
                .filter(Boolean)
                .join(" · ")}
              checked={!unchecked.has(job.job_id)}
              onChange={(value) => toggle(job.job_id, value)}
            />
          ))}
        </div>
      ) : (
        <p className="palette-flow-hint">No failed documents match.</p>
      )}
      {loaded.data?.hasMore && !interpretation?.args?.limit ? (
        <p className="palette-flow-hint">
          Showing the newest {LIST_LIMIT} of {pluralize(loaded.data.total, "failed document")}.
        </p>
      ) : null}
      {error ? (
        <Callout tone="danger" role="alert">
          {describeError(error, "Couldn't try these documents again. Try again.")}
        </Callout>
      ) : null}
    </FlowStep>
  );
}
