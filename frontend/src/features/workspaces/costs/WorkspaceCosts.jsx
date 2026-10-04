import React, { useEffect, useState } from "react";
import { RangePicker } from "./costShared.jsx";
import { rangeLabel, resolveRange } from "./costRange.js";
import { useCostResource } from "./useCostResource.js";
import { OverviewTab } from "./OverviewTab.jsx";
import { DocumentsTab } from "./DocumentsTab.jsx";
import "./workspaceCosts.css";

export function WorkspaceCosts({ workspaceId, workspaceName, role, tab = "overview", request, onTab, onBack }) {
  return <div className="workspace-costs">
    <header className="studio-page-heading" aria-label="Workspace toolbar">
      <p className="studio-eyebrow">Workspaces / Costs</p><h1>{workspaceName}</h1>
      <div className="studio-heading-actions"><button type="button" className="secondary" onClick={onBack}>← Workspace</button></div>
      <p className="studio-page-description">Reported document-processing costs, attributed to upload date. Deleted documents keep their costs. USD · UTC.</p>
    </header>
    {["owner", "admin"].includes(role) ? <CostViews workspaceId={workspaceId} request={request} tab={tab} onTab={onTab} />
      : <div className="cp-restricted" role="status"><strong>Costs are visible to Workspace owners and admins.</strong><p>Ask an owner or admin if you need spend figures for this Workspace.</p></div>}
  </div>;
}

function CostViews({ workspaceId, request, tab, onTab }) {
  const [range, setRange] = useState({ preset: "30d" });
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const resolved = resolveRange(range, now);
  const query = new URLSearchParams(resolved).toString();
  const base = `/workspaces/${encodeURIComponent(workspaceId)}/costs`;
  return <>
    <div className="cp-tab-row">
      <div className="packet-tabs" role="tablist" aria-label="Cost views">
        {["overview", "documents"].map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => onTab(value)}>{value === "overview" ? "Overview" : "Documents"}</button>)}
      </div>
      <div className="cp-range-row"><span className="cp-muted">{rangeLabel(range)} · UTC</span><RangePicker range={range} onChange={setRange} /></div>
    </div>
    {tab === "documents" ? <DocumentsTab key={query} request={request} base={base} queryString={query} /> : <Overview request={request} path={`${base}/overview?${query}`} />}
  </>;
}

function Overview({ request, path }) {
  const resource = useCostResource(request, path);
  return <><CostResourceStatus resource={resource} />{resource.data ? <OverviewTab data={resource.data} /> : null}</>;
}

export function CostResourceStatus({ resource }) {
  if (resource.error) return <div role="alert" className="cp-load-status">{resource.error} <button type="button" className="secondary" onClick={resource.reload}>Retry</button></div>;
  if (!resource.data && resource.loading) return <p role="status" className="cp-load-status">Loading cost history…</p>;
  if (resource.data?.updating) return <p role="status" className="cp-load-status">{resource.data.historyBuilding ? "Building cost history. Figures are incomplete until this finishes." : "Updating recent costs. Figures may be incomplete."} This page refreshes every 30 seconds.</p>;
  return null;
}
