// THROWAWAY: refine the selected A1, B2 and C1 layouts; sample data only.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { MainLayout } from "../MainLayout.jsx";
import { ContextSidebar } from "../../context/ContextSidebar.jsx";
import { WorkspaceContextList } from "../../workspaces/WorkspaceContextList.jsx";
import { TemplateContextList } from "../../templates/TemplateContextList.jsx";
import { DocumentContextList } from "../../documents/DocumentContextList.jsx";
import { ProfileMenu } from "../../profile/ProfileMenu.jsx";
import { DOCUMENTS, TEMPLATES, VARIANTS, WORKSPACES, documentFields } from "./sampleData.js";
import { PageHeading } from "./PrototypeShared.jsx";
import { PrototypeControls } from "./PrototypeControls.jsx";
import { WorkspaceVariations } from "./WorkspaceVariations.jsx";
import { TemplateVariations } from "./TemplateVariations.jsx";
import { DocumentVariations } from "./DocumentVariations.jsx";
import "./prototype.css";

const readVariant = () => {
  const id = new URLSearchParams(window.location.search).get("variant") || "";
  return VARIANTS.find(item => item.id === id) ||
    (/^[ABC][123]$/.test(id) ? VARIANTS.find(item => item.id[0] === id[0]) : null) ||
    VARIANTS[0];
};

export function LayoutPrototype() {
  const [variant, setVariant] = useState(readVariant);
  const [workspaces, setWorkspaces] = useState(WORKSPACES);
  const [workspaceId, setWorkspaceId] = useState(WORKSPACES[0].id);
  const [templates, setTemplates] = useState(TEMPLATES);
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [documents, setDocuments] = useState(DOCUMENTS);
  const [documentId, setDocumentId] = useState(DOCUMENTS[0].job_id);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", model: "" });
  const [modal, setModal] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("Alex Morgan");
  const [draftName, setDraftName] = useState(profileName);
  const workspace = workspaces.find(item => item.id === workspaceId);
  const template = templates.find(item => item.id === templateId);
  const selectedDocument = documents.find(item => item.job_id === documentId);
  const checkedDocuments = documents.filter(item => selectedIds.includes(item.job_id));
  const targetDocuments = checkedDocuments.length ? checkedDocuments : selectedDocument ? [selectedDocument] : [];
  const navigate = useCallback(id => {
    const next = VARIANTS.find(item => item.id === id) || VARIANTS[0];
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next.id);
    window.history.pushState(null, "", url);
    setVariant(next); setSearch("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  useEffect(() => {
    const onPop = () => { setVariant(readVariant()); setSearch(""); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    window.document.title = `${variant.id} · ${variant.name} — Studio layout study`;
    const url = new URL(window.location.href);
    if (url.searchParams.get("variant") !== variant.id) {
      url.searchParams.set("variant", variant.id);
      window.history.replaceState(null, "", url);
    }
  }, [variant]);
  const notify = text => toast(text);
  const matches = item => Object.values(item).filter(value => typeof value === "string").join(" ").toLowerCase().includes(search.toLowerCase());
  const filteredDocuments = documents.filter(matches).filter(item => (!filters.dateFrom || item.created_at.slice(0, 10) >= filters.dateFrom) && (!filters.dateTo || item.created_at.slice(0, 10) <= filters.dateTo) && (!filters.model || item.model === filters.model));
  const upload = () => setModal({ type: "upload", title: "Upload a sample document" });
  const createWorkspace = () => setModal({ type: "workspace", title: "Create a preview workspace" });
  const createTemplate = () => setModal({ type: "template", title: "Create a preview template" });
  const showJson = value => setModal({ type: "json", title: "JSON preview", value });
  function deleteWorkspace() {
    const remaining = workspaces.filter(item => item.id !== workspaceId);
    setWorkspaces(remaining);
    setWorkspaceId(remaining[0]?.id || "");
    notify("Workspace removed from this preview. Reload to restore the samples.");
  }
  function deleteTemplate() {
    const remaining = templates.filter(item => item.id !== templateId);
    setTemplates(remaining);
    setTemplateId(remaining[0]?.id || "");
    notify("Template removed from this preview. Reload to restore the samples.");
  }
  function deleteDocuments() {
    const ids = new Set(targetDocuments.map(item => item.job_id));
    if (!ids.size) return;
    const remaining = documents.filter(item => !ids.has(item.job_id));
    setDocuments(remaining);
    setSelectedIds(prev => prev.filter(id => !ids.has(id)));
    if (ids.has(documentId)) setDocumentId(remaining[0]?.job_id || "");
    notify(`${ids.size} document${ids.size === 1 ? "" : "s"} removed from this preview. Reload to restore the samples.`);
  }
  function exportDocuments() {
    const output = targetDocuments.map(item => ({
      document: item.source_name,
      fields: Object.fromEntries(documentFields(item).map(field => [field.id, field.value])),
    }));
    setModal({ type: "json", title: `Export ${output.length} document${output.length === 1 ? "" : "s"}`, value: checkedDocuments.length ? output : output[0] });
  }
  function createSample(name) {
    if (modal.type === "workspace") {
      const id = `ws_preview_${crypto.randomUUID().slice(0, 8)}`;
      setWorkspaces([...workspaces, { id, name, connected: true }]); setWorkspaceId(id);
    } else if (modal.type === "template") {
      const id = `tpl_preview_${crypto.randomUUID().slice(0, 8)}`;
      setTemplates([...templates, { id, name, description: "", fields: [] }]); setTemplateId(id); navigate("B2");
    } else {
      const job = { ...DOCUMENTS[0], source_name: name.endsWith(".pdf") ? name : `${name}.pdf`, job_id: `job_preview_${crypto.randomUUID().slice(0, 8)}` };
      setDocuments([job, ...documents]); setDocumentId(job.job_id); navigate("C1");
    }
    setModal(null); notify("Added to this preview. Changes reset when the page reloads.");
  }
  const context = variant.page === "workspace" ? <WorkspaceContextList search={search} workspaces={workspaces.filter(matches)} selectedWorkspaceId={workspaceId} onSearchChange={setSearch} onSelectAcceptedWorkspace={item => setWorkspaceId(item.id)} /> : variant.page === "templates" ? <TemplateContextList search={search} templates={templates.filter(matches)} selectedTemplateId={templateId} isEditingTemplate onSearchChange={setSearch} onSelectTemplate={setTemplateId} /> : <DocumentContextList documentLabels search={search} documents={filteredDocuments} selectedDocumentId={documentId} selectedDocumentIds={selectedIds} debouncedSearch={search} onSearchChange={setSearch} onSelectDocument={setDocumentId} filters={filters} onFiltersChange={setFilters} availableModels={["studio-extract"]} hasActiveFilters={Object.values(filters).some(Boolean)} onToggleDocumentSelection={(id, checked) => setSelectedIds(prev => checked ? [...new Set([...prev, id])] : prev.filter(item => item !== id))} onToggleAllDocumentSelections={(ids, checked) => setSelectedIds(prev => checked ? [...new Set([...prev, ...ids])] : prev.filter(id => !ids.includes(id)))} />;
  return <div className="layout-prototype" data-prototype-page={variant.page}>
    <Toaster richColors position="top-right" />
    <MainLayout activePage={variant.page} counts={{ workspace: workspaces.length, templates: templates.length, documents: documents.length }} onNavigate={page => navigate(VARIANTS.find(item => item.page === page).id)} onUploadDocument={upload} profileSlot={<ProfileMenu displayName={profileName} displayEmail="alex@example.com" draftName={draftName} isOpen={profileOpen} isDirty={profileName !== draftName} onToggle={() => setProfileOpen(!profileOpen)} onDraftNameChange={setDraftName} onSaveProfile={() => { setProfileName(draftName); notify("Preview profile updated."); }} onSignOut={() => { setProfileOpen(false); notify("This is a sample profile. There is no signed-in session in the preview."); }} />} contextSidebar={<ContextSidebar title={variant.page === "workspace" ? "Workspaces" : variant.page === "templates" ? "Templates" : "Documents"} footer={<><span className="status-chip">{variant.page === "workspace" ? `Workspaces ${workspaces.length}` : variant.page === "templates" ? `Templates ${templates.length}` : `Completed ${documents.length}`}</span><span className="status-chip good">{variant.page === "templates" ? "Editing" : variant.page === "workspace" ? "API Ready" : `Selected ${selectedIds.length}`}</span></>}>{context}</ContextSidebar>} modalSlot={modal && <PreviewModal modal={modal} onClose={() => setModal(null)} onCreate={createSample} />}>
      <div className="lp-study-note"><span><strong>{variant.id}</strong> {variant.name}</span><p>{variant.idea}</p></div>
      {variant.page === "workspace" ? (
        workspace ? <WorkspaceVariations key={workspaceId} workspace={workspace} onRename={name => setWorkspaces(prev => prev.map(item => item.id === workspaceId ? { ...item, name } : item))} onCreate={createWorkspace} onDelete={deleteWorkspace} notify={notify} />
          : <EmptyLayoutPage title="Workspaces" item="Workspace" onCreate={createWorkspace} />
      ) : variant.page === "templates" ? (
        template ? <TemplateVariations key={templateId} template={template} workspaceName={workspace?.name || "Studio"} onUpdate={next => setTemplates(prev => prev.map(item => item.id === templateId ? next : item))} onCreate={createTemplate} onDelete={deleteTemplate} notify={notify} showJson={showJson} />
          : <EmptyLayoutPage title="Templates" item="Template" onCreate={createTemplate} />
      ) : (
        <DocumentVariations key={documentId} document={selectedDocument} workspaceName={workspace?.name} onUpload={upload} onDelete={deleteDocuments} onExport={exportDocuments} selectedCount={checkedDocuments.length} />
      )}
    </MainLayout>
    <PrototypeControls variant={variant} onChange={navigate} />
  </div>;
}

function EmptyLayoutPage({ title, item, onCreate }) {
  return <div className="lp-empty-page">
    <PageHeading eyebrow={title} title={title} description={`Create a ${item.toLowerCase()} to continue exploring this preview.`}>
      <button className="secondary" onClick={onCreate}>Create {item}</button>
      <button className="danger" disabled>Delete {item}</button>
    </PageHeading>
    <p className="lp-muted">No {title.toLowerCase()} in this preview.</p>
  </div>;
}

function PreviewModal({ modal, onClose, onCreate }) {
  const ref = useRef(null);
  const [name, setName] = useState(modal.type === "upload" ? "Sample_invoice.pdf" : "");
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="lp-modal" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="lp-modal-title"><div className="lp-modal-heading"><h2 id="lp-modal-title">{modal.title}</h2><button className="secondary" onClick={onClose} aria-label="Close preview dialog">×</button></div>{modal.type === "json" ? <><p>Sample output from the current preview.</p><pre>{JSON.stringify(modal.value, null, 2)}</pre><button onClick={onClose}>Done</button></> : <form onSubmit={event => { event.preventDefault(); if (name.trim()) onCreate(name.trim()); }}><p>{modal.type === "upload" ? "Add a fictional invoice to explore the document layouts. No file is uploaded." : "This item exists only in this prototype and resets on reload."}</p><label>{modal.type === "upload" ? "Sample filename" : "Name"}<input autoFocus required value={name} onChange={event => setName(event.target.value)} /></label><button disabled={!name.trim()}>{modal.type === "upload" ? "Add sample invoice" : "Create in preview"}</button></form>}</dialog>;
}
