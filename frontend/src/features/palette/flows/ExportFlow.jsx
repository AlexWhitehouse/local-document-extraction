import React, { useState } from "react";
import { SEARCH_LIMITS } from "../../../../../shared/documentSearch.ts";
import { describeError } from "../../../lib/describeError";
import { downloadBlob } from "../../../lib/download";
import { pluralize } from "../../../lib/text";
import { Button } from "../../ui/Button.jsx";
import { Callout } from "../../ui/Callout.jsx";
import { ErrorState, Skeleton } from "../../ui/States.jsx";
import { Segmented } from "../../ui/Tabs.jsx";
import { useAsyncAction } from "../../ui/useAsyncAction";
import { describeFilter } from "../commandParser.js";
import { bulkLimit, capNote, searchTargets } from "../paletteSearch.js";
import { useBusyFlow, useLoad } from "../paletteState.js";
import { FlowStep } from "./flowParts.jsx";

const FORMATS = [
  { value: "csv", label: "CSV" },
  { value: "json", label: "JSON" },
  { value: "xlsx", label: "Excel" },
];

function filenameFrom(headers, format) {
  const disposition = headers?.get?.("content-disposition") || "";
  const extended = disposition.match(/filename\*=UTF-8''([^;]+)/i);

  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Fall through to the plain filename.
    }
  }

  const plain = disposition.match(/filename="?([^";]+)"?/i);

  return plain?.[1]?.trim() || `documents.${format}`;
}

function headerCount(headers, name) {
  const value = Number(headers?.get?.(name));

  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

// Export: choose CSV, JSON or Excel for up to 500 matching documents, then download.
export function ExportFlow({ interpretation, targets, context, onFinish, onBack, registerBack, onBusyChange }) {
  const filter = interpretation?.filter || {};
  const [format, setFormat] = useState(interpretation?.args?.format || "csv");
  const [error, setError] = useState(null);
  const limit = bulkLimit(interpretation);

  const loaded = useLoad(
    (signal) => (targets ? Promise.resolve(targets) : searchTargets(context.request, filter, { limit, signal })),
    "targets",
  );

  const summary = interpretation?.filter ? describeFilter(filter, context.catalog, { today: context.today }) : "";
  const jobIds = loaded.data?.jobIds || [];
  const note = capNote(loaded.data, interpretation, "exported");

  const [pending, run] = useAsyncAction(async () => {
    setError(null);

    try {
      const result = await context.request("/jobs/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job_ids: jobIds, format }),
        responseType: "blob",
      });

      downloadBlob(result.blob, filenameFrom(result.headers, format));
      context.notify("document.export", "success", {
        exportedCount: headerCount(result.headers, "x-exported-job-count") || jobIds.length,
        skippedCount: headerCount(result.headers, "x-skipped-job-count"),
      });
      onFinish();
    } catch (failure) {
      setError(failure);
    }
  });

  useBusyFlow(pending, { registerBack, onBusyChange });

  if (loaded.status === "loading") return <Skeleton rows={2} label="Finding documents…" />;

  if (loaded.status === "error") return <ErrorState error={loaded.error} fallback="Couldn't find the documents to export." onRetry={loaded.retry} />;

  return (
    <FlowStep
      title={`Export ${pluralize(jobIds.length, "document")}`}
      subtitle={summary}
      actions={
        <>
          <Button variant="secondary" disabled={pending} onClick={onBack}>
            Cancel
          </Button>
          <Button disabled={!jobIds.length} pending={pending} pendingLabel="Exporting…" onClick={run}>
            Export {pluralize(jobIds.length, "document")}
          </Button>
        </>
      }
    >
      {jobIds.length ? (
        <>
          <Segmented label="Format" items={FORMATS} value={format} onChange={setFormat} />
          <p className="palette-flow-hint">
            {note || `Up to ${SEARCH_LIMITS.idsPageSize} documents per export.`}
          </p>
        </>
      ) : (
        <p className="palette-flow-hint">No documents match. Change your request and try again.</p>
      )}
      {error ? (
        <Callout tone="danger" role="alert">
          {describeError(error, "Couldn't export these documents. Try again.")}
        </Callout>
      ) : null}
    </FlowStep>
  );
}
