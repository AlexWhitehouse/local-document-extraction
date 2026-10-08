import React from "react";
import { CheckboxField } from "../ui/Field.jsx";
import { Button } from "../ui/Button.jsx";

export function WorkspaceDocumentProcessingSettings({ controller }) {
  const { settings, loading, saving, error, canManage } = controller;
  const splitting = settings?.enable_smart_splitting === true;

  return (
    <section className="studio-api-access" aria-label="Document processing">
      <div className="studio-section-heading">
        <div>
          <h2>Document processing</h2>
          <p>Applies to new uploads.</p>
        </div>
      </div>
      {loading && !settings ? (
        <p role="status" className="studio-users-note">
          Loading document processing settings…
        </p>
      ) : null}
      <div className="studio-setting-toggles">
        <CheckboxField
          label="Enable smart splitting"
          description="Split PDFs into documents and extract each one. Adds processing time and model usage."
          checked={splitting}
          disabled={!settings || !canManage || loading || saving}
          onChange={(checked) => void controller.update("enable_smart_splitting", checked)}
        />
        <CheckboxField
          label="Exclude blank pages"
          description="Skip blank pages when splitting."
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
            Try again
          </Button>
        </p>
      ) : null}
    </section>
  );
}
