import React from "react";
import { SettingToggle } from "./SettingToggle.jsx";
import { Button } from "../ui/Button.jsx";

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
      {loading && !settings ? (
        <p role="status" className="studio-users-note">
          Loading document processing settings…
        </p>
      ) : null}
      <div className="studio-setting-toggles">
        <SettingToggle
          label="Enable smart splitting"
          description="Find logical documents within PDFs and extract each separately. Analysis can add processing time and model usage."
          checked={splitting}
          disabled={!settings || !canManage || loading || saving}
          onChange={(checked) => void controller.update("enable_smart_splitting", checked)}
        />
        <SettingToggle
          label="Exclude blank pages"
          description="Only applies when smart splitting is enabled. Verified blank pages are excluded with a record of their original page numbers. Nonblank cover pages are kept."
          checked={settings?.exclude_blank_pages === true}
          disabled={!settings || !canManage || loading || saving || !splitting}
          onChange={(checked) => void controller.update("exclude_blank_pages", checked)}
        />
      </div>
      {!canManage ? <p className="studio-users-note">An owner or admin manages these settings.</p> : null}
      {error ? (
        <p role="alert" className="form-error">
          {error}{" "}
          <Button variant="text" onClick={controller.reload}>
            Reload settings
          </Button>
        </p>
      ) : null}
    </section>
  );
}
