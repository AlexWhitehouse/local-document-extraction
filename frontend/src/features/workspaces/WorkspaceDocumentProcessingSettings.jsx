import React from "react";

export function WorkspaceDocumentProcessingSettings({ controller }) {
  const { settings, loading, saving, error, canManage } = controller;
  const splitting = settings?.enable_smart_splitting === true;
  return (
    <section className="studio-api-access" aria-label="Document processing">
      <div className="studio-section-heading">
        <div>
          <h2>Document processing</h2>
          <p>Applies to every new upload and API request in this Workspace.</p>
        </div>
      </div>
      {loading && !settings ? <p role="status">Loading document processing settings…</p> : null}
      <label className="studio-source-retention-toggle">
        <input
          type="checkbox"
          checked={splitting}
          disabled={!settings || !canManage || saving || loading}
          onChange={(event) => void controller.update("enable_smart_splitting", event.target.checked)}
        />
        <span>Enable smart splitting</span>
      </label>
      <p className="studio-users-note">Find logical documents within PDFs and extract each separately. Analysis can add processing time and model usage.</p>
      <label className="studio-source-retention-toggle">
        <input
          type="checkbox"
          checked={settings?.exclude_blank_pages === true}
          disabled={!settings || !canManage || saving || loading || !splitting}
          aria-describedby="blank-page-policy"
          onChange={(event) => void controller.update("exclude_blank_pages", event.target.checked)}
        />
        <span>Exclude blank pages</span>
      </label>
      <p id="blank-page-policy" className="studio-users-note">Only applies when smart splitting is enabled. Verified blank pages are excluded with a record of their original page numbers. Nonblank cover pages are kept.</p>
      {!canManage ? <p className="studio-users-note">An owner or admin manages these settings.</p> : null}
      {saving ? <p role="status">Saving document processing settings…</p> : null}
      {error ? <p role="alert" className="form-error">{error}{" "}<button type="button" className="studio-text-button" onClick={controller.reload}>Reload settings</button></p> : null}
    </section>
  );
}
