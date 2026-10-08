import React, { useEffect, useState } from "react";
import { PageHeader } from "../../ui/PageHeader.jsx";
import { RangePicker } from "./costShared.jsx";
import { rangeLabel, resolveRange } from "./costRange.js";
import { useCostResource } from "./useCostResource.js";
import { OverviewTab } from "./OverviewTab.jsx";
import { ErrorState, LoadingState } from "../../ui/States.jsx";
import { Tabs } from "../../ui/Tabs.jsx";
import { DocumentsTab } from "./DocumentsTab.jsx";
import "./workspaceCosts.css";

export function WorkspaceCosts({ workspaceId, workspaceCrumb = null, role, tab = "overview", request, onTab }) {
  return (
    <div className="workspace-costs">
      <PageHeader
        label="Workspace costs"
        breadcrumbs={[workspaceCrumb, { label: "Costs" }].filter(Boolean)}
        title="Costs"
        description="Reported document-processing costs, attributed to upload date. Deleted documents keep their costs. USD · UTC."
      />
      {["owner", "admin"].includes(role) ? (
        <CostViews workspaceId={workspaceId} request={request} tab={tab} onTab={onTab} />
      ) : (
        <div className="cp-restricted">
          <strong>Costs are visible to Workspace owners and admins.</strong>
          <p>Ask an owner or admin if you need spend figures for this Workspace.</p>
        </div>
      )}
    </div>
  );
}

function CostViews({ workspaceId, request, tab, onTab }) {
  const [range, setRange] = useState({ preset: "30d" });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);

    return () => clearInterval(timer);
  }, []);
  const resolved = resolveRange(range, now);
  const query = new URLSearchParams(resolved).toString();
  const base = `/workspaces/${encodeURIComponent(workspaceId)}/costs`;

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
          <span className="cp-muted">{rangeLabel(range)} · UTC</span>
          <RangePicker range={range} onChange={setRange} />
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
      <p role="status" className="cp-load-status">
        {resource.data.historyBuilding
          ? "Building cost history. Figures are incomplete until this finishes."
          : "Updating recent costs. Figures may be incomplete."}{" "}
        This page refreshes every 30 seconds.
      </p>
    );

  return null;
}
