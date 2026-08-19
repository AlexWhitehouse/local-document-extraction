import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export const ProfileMenu = React.forwardRef(function ProfileMenu(
  {
    displayName,
    displayEmail,
    draftName,
    isOpen,
    isDirty,
    isSavingProfile,
    busy,
    modelSettings,
    onToggle,
    onDraftNameChange,
    onSaveProfile,
    onSignOut,
  },
  ref,
) {
  const [activeSection, setActiveSection] = useState("account");
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      return;
    }
    setActiveSection("account");
    setIsApiKeyVisible(false);
  }, [isOpen]);

  function selectSection(section) {
    setActiveSection(section);
    if (section === "model") {
      void modelSettings.onLoad();
    }
  }

  return (
    <div className="sidebar-profile" ref={ref}>
      <button
        type="button"
        className="sidebar-profile-trigger"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <span className="sidebar-profile-avatar" aria-hidden="true">
          {profileInitials(displayName, displayEmail)}
        </span>
        <span className="sidebar-profile-meta">
          <strong>{displayName}</strong>
          <span>{displayEmail}</span>
        </span>
        <span className="sidebar-profile-chevron" aria-hidden="true">
          ⌃
        </span>
      </button>

      {isOpen
        ? createPortal(
            <div className="settings-modal-backdrop" onClick={onToggle}>
              <div
                className="settings-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-modal-title"
                onClick={(event) => event.stopPropagation()}
              >
                <aside className="settings-modal-sidebar">
                  <div className="settings-modal-brand">
                    <span className="eyebrow">Local Studio</span>
                    <h2 id="settings-modal-title">Settings</h2>
                  </div>
                  <nav aria-label="Settings sections">
                    <button
                      type="button"
                      className={activeSection === "account" ? "active" : ""}
                      aria-current={
                        activeSection === "account" ? "page" : undefined
                      }
                      onClick={() => selectSection("account")}
                    >
                      <span aria-hidden="true">AC</span>
                      Account
                    </button>
                    <button
                      type="button"
                      className={activeSection === "model" ? "active" : ""}
                      aria-current={
                        activeSection === "model" ? "page" : undefined
                      }
                      onClick={() => selectSection("model")}
                    >
                      <span aria-hidden="true">AI</span>
                      Model
                    </button>
                  </nav>
                  <p>Configuration is stored only on this machine.</p>
                </aside>

                <section className="settings-modal-content">
                  <header className="settings-modal-header">
                    <div>
                      <span className="eyebrow">
                        {activeSection === "account"
                          ? "Identity"
                          : "Extraction engine"}
                      </span>
                      <h3>
                        {activeSection === "account" ? "Account" : "Model"}
                      </h3>
                    </div>
                    <button
                      type="button"
                      className="settings-modal-close"
                      aria-label="Close settings"
                      onClick={onToggle}
                    >
                      ×
                    </button>
                  </header>

                  {activeSection === "account" ? (
                    <AccountSettings
                      busy={busy}
                      displayEmail={displayEmail}
                      draftName={draftName}
                      isDirty={isDirty}
                      isSavingProfile={isSavingProfile}
                      onDraftNameChange={onDraftNameChange}
                      onSaveProfile={onSaveProfile}
                      onSignOut={onSignOut}
                    />
                  ) : (
                    <ModelSettings
                      {...modelSettings}
                      isApiKeyVisible={isApiKeyVisible}
                      onApiKeyVisibilityToggle={() =>
                        setIsApiKeyVisible((current) => !current)
                      }
                    />
                  )}
                </section>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});

function AccountSettings({
  busy,
  displayEmail,
  draftName,
  isDirty,
  isSavingProfile,
  onDraftNameChange,
  onSaveProfile,
  onSignOut,
}) {
  return (
    <div className="settings-section-body">
      <div className="settings-section-intro">
        <h4>Your local profile</h4>
        <p>Update the name shown throughout Document Extraction.</p>
      </div>
      <div className="settings-form-card">
        <label>
          Name
          <input
            value={draftName}
            onChange={(event) => onDraftNameChange(event.target.value)}
            placeholder="Jane Doe"
            autoComplete="name"
          />
        </label>
        <label>
          Email
          <input value={displayEmail} readOnly aria-readonly="true" />
        </label>
        <div className="settings-form-actions">
          <button
            type="button"
            disabled={isSavingProfile || !isDirty}
            onClick={onSaveProfile}
          >
            {isSavingProfile ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </div>
      <div className="settings-danger-row">
        <div>
          <strong>End this session</strong>
          <span>You’ll need to sign in again to access local workspaces.</span>
        </div>
        <button
          type="button"
          className="danger"
          disabled={busy || isSavingProfile}
          onClick={onSignOut}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

function ModelSettings({
  apiKey,
  error,
  gatewayUrl,
  hasApiKey,
  isApiKeyVisible,
  isDirty,
  isLoaded,
  isLoading,
  isSaving,
  modelName,
  sequentialCalls,
  supportsPdfInput,
  supportsStructuredOutput,
  onApiKeyChange,
  onApiKeyVisibilityToggle,
  onGatewayUrlChange,
  onLoad,
  onModelNameChange,
  onSequentialCallsChange,
  onSupportsPdfInputChange,
  onSupportsStructuredOutputChange,
  onRemoveApiKey,
  onSave,
}) {
  if (isLoading && !isLoaded) {
    return (
      <div className="settings-section-state" role="status">
        <span className="settings-loading-mark" aria-hidden="true" />
        <strong>Loading model settings</strong>
        <p>Reading the configuration stored by the local runtime.</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="settings-section-state" role="alert">
        <strong>Model settings are unavailable</strong>
        <p>{error || "The local runtime did not return model settings."}</p>
        <button type="button" className="secondary" onClick={onLoad}>
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="settings-section-body settings-model-section">
      <div className="settings-section-intro">
        <h4>OpenAI-compatible gateway</h4>
        <p>
          New extraction jobs use this endpoint and model. Changes take effect
          without restarting the app.
        </p>
      </div>
      <div className="settings-form-card settings-model-form">
        <div className="settings-model-primary-grid">
          <label>
            Gateway URL
            <input
              type="url"
              aria-label="Gateway URL"
              value={gatewayUrl}
              onChange={(event) => onGatewayUrlChange(event.target.value)}
              placeholder="http://127.0.0.1:11434/v1"
              spellCheck="false"
            />
            <span className="field-note">
              Calls <code>chat/completions</code> on this base URL.
            </span>
          </label>
          <label>
            Model name
            <input
              aria-label="Model name"
              value={modelName}
              onChange={(event) => onModelNameChange(event.target.value)}
              placeholder="openai/gpt-5-mini"
              spellCheck="false"
            />
            <span className="field-note">Gateway model identifier.</span>
          </label>
        </div>
        <label>
          <span className="settings-label-line">
            API key / bearer token
            <span className="optional-label">Optional</span>
          </span>
          <span className="settings-secret-input">
            <input
              type={isApiKeyVisible ? "text" : "password"}
              aria-label="API key / bearer token"
              value={apiKey}
              onChange={(event) => onApiKeyChange(event.target.value)}
              placeholder={
                hasApiKey
                  ? "Saved — enter a new token to replace"
                  : "Enter a token if required"
              }
              autoComplete="new-password"
              spellCheck="false"
            />
            <button
              type="button"
              className="ghost"
              aria-label={isApiKeyVisible ? "Hide API key" : "Show API key"}
              onClick={onApiKeyVisibilityToggle}
            >
              {isApiKeyVisible ? "Hide" : "Show"}
            </button>
          </span>
          <span
            className={
              hasApiKey ? "credential-status saved" : "credential-status"
            }
          >
            <i aria-hidden="true" />
            {hasApiKey ? "A token is stored locally" : "No token stored"}
          </span>
        </label>
      </div>
      <div className="settings-behavior-group">
        <div className="settings-behavior-heading">
          <strong>Model capabilities</strong>
          <span>Request handling and document input</span>
        </div>
        <div className="settings-behavior-options">
          <label className="settings-checkbox-row">
            <input
              type="checkbox"
              checked={sequentialCalls}
              onChange={(event) =>
                onSequentialCallsChange(event.target.checked)
              }
            />
            <span>
              <strong>Sequential calls</strong>
              <small>
                One active request at a time for memory-limited models.
              </small>
            </span>
          </label>
          <label className="settings-checkbox-row">
            <input
              type="checkbox"
              checked={supportsPdfInput}
              onChange={(event) =>
                onSupportsPdfInputChange(event.target.checked)
              }
            />
            <span>
              <strong>Direct PDF input</strong>
              <small>
                Send the PDF as a file; otherwise render pages to PNGs.
              </small>
            </span>
          </label>
          <label className="settings-checkbox-row">
            <input
              type="checkbox"
              checked={supportsStructuredOutput}
              onChange={(event) =>
                onSupportsStructuredOutputChange(event.target.checked)
              }
            />
            <span>
              <strong>Structured output</strong>
              <small>
                Send a response format; disable for incompatible models.
              </small>
            </span>
          </label>
        </div>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="settings-form-actions settings-model-actions">
        <button
          type="button"
          disabled={isSaving || !isDirty}
          onClick={onSave}
        >
          {isSaving ? "Saving..." : "Save Model Settings"}
        </button>
        {hasApiKey ? (
          <button
            type="button"
            className="ghost"
            disabled={isSaving}
            onClick={onRemoveApiKey}
          >
            Remove saved token
          </button>
        ) : null}
      </div>
    </div>
  );
}

function profileInitials(name, email) {
  const source = String(name || "").trim() || String(email || "").trim();
  if (!source) {
    return "U";
  }

  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}
