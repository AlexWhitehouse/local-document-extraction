// THROWAWAY: the Workspace costs page and its entry point; sample data only.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MainLayout, WorkspaceToolbar } from "../../layout/MainLayout.jsx";
import { ContextSidebar } from "../../context/ContextSidebar.jsx";
import { WorkspaceContextList } from "../WorkspaceContextList.jsx";
import { AcceptedWorkspacePage } from "../WorkspacePages.jsx";
import { MEMBERS, WORKSPACES, buildSample } from "./sampleCosts.js";
import { resolveRange, rangeLabel } from "./costRange.js";
import { RangePicker, Segmented } from "./costShared.jsx";
import { OverviewTab } from "./OverviewTab.jsx";
import { DocumentsTab } from "./DocumentsTab.jsx";
import "../../layout/StudioLayouts.css";
import "../../documents/DocumentProcessing.css";
import "./costPrototype.css";

const TABS = [{ id: "overview", label: "Overview", Component: OverviewTab }, { id: "documents", label: "Documents", Component: DocumentsTab }];
const ROLES = [{ value: "owner", label: "Owner" }, { value: "admin", label: "Admin" }, { value: "member", label: "Member" }];
const canViewCosts = role => role === "owner" || role === "admin";

function readLocation() {
  const params = new URLSearchParams(window.location.search);
  return { page: params.get("page") === "costs" ? "costs" : "workspace", tab: TABS.some(tab => tab.id === params.get("tab")) ? params.get("tab") : "overview" };
}

export function CostPrototype() {
  const [location, setLocation] = useState(readLocation);
  const [role, setRole] = useState("owner");
  const [workspaceId, setWorkspaceId] = useState(WORKSPACES[0].id);
  const [search, setSearch] = useState("");
  const [range, setRange] = useState({ preset: "30d" });
  const workspace = WORKSPACES.find(item => item.id === workspaceId);
  const sample = useMemo(() => buildSample(20261004 + WORKSPACES.indexOf(workspace) * 97), [workspace]);
  const resolved = useMemo(() => resolveRange(range), [range]);

  const go = useCallback(next => {
    const url = new URL(window.location.href);
    url.searchParams.set("page", next.page);
    if (next.page === "costs") url.searchParams.set("tab", next.tab); else url.searchParams.delete("tab");
    window.history.pushState(null, "", url);
    setLocation(next);
  }, []);
  useEffect(() => {
    const onPop = () => setLocation(readLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => { window.document.title = `${location.page === "costs" ? "Costs" : "Workspace"} — ${workspace.name} · Costs study`; }, [location, workspace]);

  const documentCount = sample.direct.length + sample.packets.reduce((sum, packet) => sum + packet.children.length, 0);
  return <div className="cost-prototype">
    <MainLayout
      activePage="workspace"
      contentClassName="studio-main studio-main-workspace"
      contentSelection={`${workspaceId}:${location.page}:${location.tab}`}
      counts={{ workspace: WORKSPACES.length, templates: 5, documents: documentCount }}
      onNavigate={() => go({ page: "workspace", tab: "overview" })}
      onUploadDocument={() => {}}
      isUploadDisabled
      profileSlot={<span className="cp-muted cp-profile-note">Sample profile</span>}
      contextSidebar={<ContextSidebar title="Workspaces" footer={<><span className="status-chip">Workspaces {WORKSPACES.length}</span><span className="status-chip good">Sample data</span></>}>
        <WorkspaceContextList search={search} onSearchChange={setSearch} selectedWorkspaceId={workspaceId}
          workspaces={WORKSPACES.filter(item => `${item.name} ${item.id}`.toLowerCase().includes(search.toLowerCase()))}
          onSelectAcceptedWorkspace={item => setWorkspaceId(item.id)} />
      </ContextSidebar>}
    >
      {location.page === "costs"
        ? <CostsPage workspace={workspace} role={role} tab={location.tab} sample={sample} range={range} resolved={resolved} onRangeChange={setRange}
            onTab={tab => go({ page: "costs", tab })} onBack={() => go({ page: "workspace", tab: "overview" })} />
        : <WorkspacePage workspace={workspace} role={role} onCosts={() => go({ page: "costs", tab: "overview" })} />}
    </MainLayout>
    <StudyControls role={role} onRole={setRole} />
  </div>;
}

/** The existing Workspace page; owners and admins get a Costs action in the header. */
function WorkspacePage({ workspace, role, onCosts }) {
  const [name, setName] = useState(workspace.name);
  return <>
    <WorkspaceToolbar activePage="workspace" pageTitle={workspace.name} pageDescription="Your extraction environment, connections and people."
      actions={<>
        {canViewCosts(role) ? <button type="button" className="secondary cp-costs-action" onClick={onCosts}><CostIcon /> Costs</button> : null}
        <button type="button" className="secondary">Create Workspace</button>
        <button type="button" className="danger">{role === "owner" ? "Delete Workspace" : "Leave Workspace"}</button>
      </>} />
    <AcceptedWorkspacePage
      workspaceId={workspace.id} workspaceRole={role} workspaceName={name} onWorkspaceNameChange={setName}
      isWorkspaceNameDirty={name !== workspace.name} onSaveWorkspaceChanges={() => {}}
      apiKey="" workspaceApiKeyPlaceholder="Rotate to reveal a new key" workspaceApiKeyActionLabel="Rotate key ↗"
      canRotateWorkspaceApiKey={false} hasApiAccess onRefreshApiKey={() => {}}
      inviteEmail="" inviteRole="member" onInviteEmailChange={() => {}} onInviteRoleChange={() => {}} onInviteUser={() => {}}
      workspaceUsers={MEMBERS} canShowWorkspaceUserAction={() => false} sessionUserId={`u_${role}`}
      onSelectWorkspaceUserActionTarget={() => {}} canManageWorkspaceInvitations={canViewCosts(role)} workspaceInvitations={[]}
      onCancelWorkspaceInvitation={() => {}} />
  </>;
}

function CostsPage({ workspace, role, tab, sample, range, resolved, onRangeChange, onTab, onBack }) {
  const { Component } = TABS.find(item => item.id === tab);
  return <>
    <header className="studio-page-heading" aria-label="Workspace toolbar">
      <p className="studio-eyebrow">Workspaces / Costs</p>
      <h1 title={workspace.name}>{workspace.name}</h1>
      <div className="studio-heading-actions"><button type="button" className="secondary" onClick={onBack}>← Workspace</button></div>
      <p className="studio-page-description">Reported model costs for this Workspace. Deleted documents keep their costs because those costs were incurred.</p>
    </header>
    {canViewCosts(role) ? <>
      <div className="cp-tab-row">
        <div className="packet-tabs" role="tablist" aria-label="Cost views">
          {TABS.map(item => <button key={item.id} type="button" role="tab" aria-selected={item.id === tab} onClick={() => onTab(item.id)}>{item.label}</button>)}
        </div>
        <div className="cp-range-row">
          <span className="cp-muted">{rangeLabel(range)} · USD</span>
          <RangePicker range={range} onChange={onRangeChange} />
        </div>
      </div>
      <Component key={`${workspace.id}:${JSON.stringify(range)}`} sample={sample} range={resolved} />
    </> : <div className="cp-restricted" role="status">
      <strong>Costs are visible to Workspace owners and admins.</strong>
      <p>Ask an owner or admin if you need spend figures for this Workspace.</p>
      <button type="button" className="secondary" onClick={onBack}>Back to Workspace</button>
    </div>}
  </>;
}

function CostIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 13.5V9M6.2 13.5V5.5M9.8 13.5V7.5M13.5 13.5V2.5" /></svg>;
}

function StudyControls({ role, onRole }) {
  return <div className="cp-switcher" role="group" aria-label="Prototype controls">
    <div className="cp-switcher-caption"><span>COSTS STUDY · SAMPLE DATA</span><strong>View as</strong></div>
    <Segmented label="View as role" value={role} onChange={onRole} options={ROLES} />
  </div>;
}
