import React, { useEffect, useState } from "react";
import { PageHeader } from "../../ui/PageHeader.jsx";
import { RangePicker } from "./costShared.jsx";
import { rangeLabel, resolveRange } from "./costRange.js";
import { useCostResource } from "./useCostResource.js";
import { OverviewTab } from "./OverviewTab.jsx";
import { ErrorState, LoadingState } from "../../ui/States.jsx";
import { Tabs } from "../../ui/Tabs.jsx";
import { Callout } from "../../ui/Callout.jsx";
import { DocumentsTab } from "./DocumentsTab.jsx";
import { Button } from "../../ui/Button.jsx";
import { useAsyncAction } from "../../ui/useAsyncAction.js";
import { DownloadIcon } from "../../layout/Icons.jsx";
import { downloadBlob } from "../../../lib/download.js";
import { createNotifier, defaultToast } from "../../../lib/notify.js";
import { xlsxBlob } from "../../../lib/xlsx.js";
import { costExportFileName, costWorkbookSheets } from "./costExport.js";
import "./workspaceCosts.css";

const defaultNotify = createNotifier(defaultToast);

export function WorkspaceCosts({
  workspaceId,
  workspaceCrumb = null,
  role,
  tab = "overview",
  request,
  onTab,
  notify = defaultNotify,
}) {
  return (
    <div className="workspace-costs">
      <PageHeader
        label="Workspace costs"
        breadcrumbs={[workspaceCrumb, { label: "Costs" }].filter(Boolean)}
        title="Costs"
        description="Model costs by upload date (USD, UTC). Deleted documents keep their costs."
      />
      {["owner", "admin"].includes(role) ? (
        <CostViews workspaceId={workspaceId} request={request} tab={tab} onTab={onTab} notify={notify} />
      ) : (
        <div className="cp-restricted">
          <strong>Only workspace owners and admins can view costs.</strong>
        </div>
      )}
    </div>
  );
}

function CostViews({ workspaceId, request, tab, onTab, notify }) {
  const [range, setRange] = useState({ preset: "30d" });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);

    return () => clearInterval(timer);
  }, []);
  const resolved = resolveRange(range, now);
  const query = new URLSearchParams(resolved).toString();
  const base = `/workspaces/${encodeURIComponent(workspaceId)}/costs`;

  // The export reads the whole range fresh, whichever tab is open.
  const [exporting, exportCosts] = useAsyncAction(async () => {
    const label = rangeLabel(range);

    try {
      const read = (path) => request(`${base}/${path}?${query}`, { method: "GET", cache: "no-store" });
      const [overview, exported] = await Promise.all([read("overview"), read("export")]);
      downloadBlob(xlsxBlob(costWorkbookSheets({ overview, exported, label })), costExportFileName(resolved));
      notify("costs.export", "success", { label });
    } catch (error) {
      notify("costs.export", "failure", { error });
    }
  });

  return (
    <>
      <div className="cp-tab-row">
        <Tabs
          label="Cost views"
          idPrefix="cost-views"
          items={[
            { value: "overview", label: "Overview" },
            { value: "documents", label: "Documents" },
          ]}
          value={tab}
          onChange={onTab}
        />
        <div className="cp-range-row">
          <span className="cp-muted">{rangeLabel(range)}</span>
          <RangePicker range={range} onChange={setRange} />
          <Button
            variant="secondary"
            className="cp-export"
            pending={exporting}
            pendingLabel="Exporting…"
            onClick={() => void exportCosts()}
          >
            <DownloadIcon size={13} />
            Export
          </Button>
        </div>
      </div>
      <div role="tabpanel" id={`cost-views-panel-${tab}`} aria-labelledby={`cost-views-tab-${tab}`} tabIndex={0}>
        {tab === "documents" ? (
          <DocumentsTab key={query} request={request} base={base} queryString={query} />
        ) : (
          <Overview request={request} path={`${base}/overview?${query}`} />
        )}
      </div>
    </>
  );
}

function Overview({ request, path }) {
  const resource = useCostResource(request, path);

  return (
    <>
      <CostResourceStatus resource={resource} />
      {resource.data ? <OverviewTab data={resource.data} /> : null}
    </>
  );
}

export function CostResourceStatus({ resource }) {
  if (resource.error)
    return <ErrorState message={resource.error} onRetry={resource.reload} />;

  if (!resource.data && resource.loading) return <LoadingState label="Loading cost history…" />;

  if (resource.data?.updating)
    return (
      <Callout tone="info" role="status">
        {resource.data.historyBuilding
          ? "Cost history is still building. Figures may be incomplete."
          : "Recent costs are updating. Figures may be incomplete."}
      </Callout>
    );

  return null;
}
