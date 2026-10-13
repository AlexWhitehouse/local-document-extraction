import React, { useEffect, useRef, useState } from "react";
import { describeError } from "../../../lib/describeError";
import { pluralize } from "../../../lib/text";
import { Button } from "../../ui/Button.jsx";
import { Callout } from "../../ui/Callout.jsx";
import { ErrorState, Skeleton } from "../../ui/States.jsx";
import { useAsyncAction } from "../../ui/useAsyncAction";
import { bulkLimit, capNote, searchDocuments, searchTargets } from "../paletteSearch.js";
import { useBusyFlow, useLoad } from "../paletteState.js";
import { FlowStep } from "./flowParts.jsx";

const NAMED = 4;

function hasCriteria(filter) {
  return Boolean(filter && Object.keys(filter).length);
}

async function loadDeletion(context, filter, targets, limit, signal) {
  const ids = targets || (await searchTargets(context.request, filter, { limit, signal }));
  const wanted = new Set(ids.jobIds);

  // Name only documents that are deleted: the newest few of the targets.
  const page = ids.jobIds.length
    ? await searchDocuments(context.request, { filter, limit: Math.min(NAMED, ids.jobIds.length), signal })
    : { jobs: [] };

  return {
    ...ids,
    names: page.jobs.flatMap((job) => (wanted.has(job.job_id) ? [job.source_name || job.job_id] : [])),
  };
}

// Delete: a danger panel inside the palette. Cancel has focus, and Enter never confirms.
export function DeleteFlow({ interpretation, targets, context, onFinish, onBack, registerBack, onBusyChange }) {
  const filter = interpretation?.filter || {};
  const limit = bulkLimit(interpretation);
  const cancelRef = useRef(null);
  const [error, setError] = useState(null);

  const loaded = useLoad(
    (signal) =>
      targets || hasCriteria(filter) ? loadDeletion(context, filter, targets, limit, signal) : Promise.resolve(null),
    "deletion",
  );

  const jobIds = loaded.data?.jobIds || [];
  const names = loaded.data?.names || [];

  useEffect(() => {
    if (loaded.status !== "loading") cancelRef.current?.focus();
  }, [loaded.status]);

  const [pending, run] = useAsyncAction(async () => {
    setError(null);
    let removed = 0;
    let gone = 0;
    let lastFailure = null;

    // One at a time, like the Documents page, so a partial failure can be reported with counts.
    for (const id of jobIds) {
      try {
        await context.request(`/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
        removed += 1;
      } catch (failure) {
        // Deleted elsewhere since the search: reported as already deleted, not as deleted here.
        if (failure?.status === 404) gone += 1;
        else lastFailure = failure;
      }
    }

    if (!removed && !gone) {
      setError(lastFailure);

      return;
    }

    const failed = jobIds.length - removed - gone;

    if (jobIds.length === 1)
      context.notify("document.delete", removed ? "success" : "alreadyRemoved", { targetName: names[0] });
    else if (failed)
      context.notify("document.bulkDelete", "failure", { removed, total: removed + failed });
    else if (removed) context.notify("document.bulkDelete", "success", { removed });
    else context.notify("document.bulkAlreadyDeleted", "success", { count: gone });

    context.documentController?.contextList?.onRetryDocumentList?.();
    onFinish();
  });

  useBusyFlow(pending, { registerBack, onBusyChange });

  if (loaded.status === "loading") return <Skeleton rows={2} label="Finding documents…" />;

  if (loaded.status === "error")
    return <ErrorState error={loaded.error} fallback="Couldn't find the documents to delete." onRetry={loaded.retry} />;

  if (!loaded.data || !jobIds.length) {
    return (
      <FlowStep
        label="Delete documents"
        actions={
          <Button ref={cancelRef} variant="secondary" onClick={onBack}>
            Back
          </Button>
        }
      >
        <p className="palette-flow-hint">
          {loaded.data ? "No documents match." : "Find the documents to delete first, then choose Delete."}
        </p>
      </FlowStep>
    );
  }

  const count = jobIds.length;
  const more = count - names.length;
  const note = capNote(loaded.data, interpretation, "deleted");
  const title = count === 1 && names[0] ? `Delete "${names[0]}"?` : `Delete ${pluralize(count, "document")}?`;

  return (
    <FlowStep
      label="Delete documents"
      actions={
        <>
          <Button ref={cancelRef} variant="secondary" disabled={pending} onClick={onBack}>
            Cancel
          </Button>
          <Button variant="danger" pending={pending} pendingLabel="Deleting…" onClick={run}>
            {count === 1 ? "Delete document" : `Delete ${pluralize(count, "document")}`}
          </Button>
        </>
      }
    >
      <div className="palette-danger" role="group" aria-labelledby="palette-delete-title" aria-describedby="palette-delete-body">
        <h3 id="palette-delete-title">{title}</h3>
        <p id="palette-delete-body">
          {count > 1 && names.length ? `${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}. ` : ""}
          {note ? `${note} ` : ""}
          {count === 1 ? "Its original and results are deleted." : "Their originals and results are deleted."} This
          can&apos;t be undone.
        </p>
      </div>
      {error ? (
        <Callout tone="danger" role="alert">
          {describeError(error, "Couldn't delete these documents. Try again.")}
        </Callout>
      ) : null}
    </FlowStep>
  );
}
