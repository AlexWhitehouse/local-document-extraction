import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { normalizeTemplateTagName, normalizeTemplateTags } from "../../../../shared/templateTags.ts";
import { confirmDialog } from "../ui/confirm.jsx";
import "./TemplateTags.css";

export function TemplateTags({
  value = [],
  onChange,
  tags = [],
  isLoading = false,
  error = "",
  isManaging = false,
  onReload,
  onRename,
  onDelete,
  disabled = false,
}) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const popupId = useId();
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useState("");
  const busy = disabled || isManaging;

  const close = () => {
    setOpen(false);
    setEditing(null);
    setActionError("");
  };

  useEffect(() => {
    if (!open) return;

    if (!managing) searchRef.current?.focus();

    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener("pointerdown", outside);

    return () => document.removeEventListener("pointerdown", outside);
  }, [open, managing]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const choices = useMemo(
    () => [...new Set([...tags.map((tag) => tag.name), ...value])].sort((a, b) => a.localeCompare(b)),
    [tags, value],
  );

  let candidate = "";
  let searchError = "";

  if (search.trim()) {
    try {
      candidate = normalizeTemplateTagName(search);
    } catch (failure) {
      searchError = failure.message;
    }
  }

  const filtered = choices.filter((tag) => tag.includes(search.trim().toLowerCase().replace(/\s+/g, " ")));
  const canCreate = candidate && !choices.includes(candidate);

  function toggle(tag) {
    try {
      onChange(normalizeTemplateTags(value.includes(tag) ? value.filter((item) => item !== tag) : [...value, tag]));
      setActionError("");
    } catch (failure) {
      setActionError(failure.message);
    }
  }

  async function rename(event) {
    event.preventDefault();
    setActionError("");
    setStatus("");

    try {
      if (await onRename(editing, name)) {
        setStatus(`Renamed “${editing.name}” to “${normalizeTemplateTagName(name)}” across this Workspace.`);
        setEditing(null);
      }
    } catch (failure) {
      setActionError(failure.message);
    }
  }

  async function remove(tag) {
    const count = tag.template_count;

    const confirmed = await confirmDialog({
      title: `Delete tag "${tag.name}"?`,
      body: `Removes it from ${count} template${count === 1 ? "" : "s"}. The templates are kept. This can't be undone.`,
      confirmLabel: "Delete tag",
      pendingLabel: "Deleting…",
    });

    if (!confirmed) return;
    setActionError("");
    setStatus("");

    try {
      if (await onDelete(tag)) {
        setStatus(`Deleted “${tag.name}” across this Workspace.`);
        setEditing(null);
      }
    } catch (failure) {
      setActionError(failure.message);
    }
  }

  const usage = (name) => tags.find((tag) => tag.name === name)?.template_count;

  const back = () => {
    setManaging(false);
    setEditing(null);
    setActionError("");
  };

  return (
    <div
      className="template-tags"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
          triggerRef.current?.focus();
        }
      }}
    >
      <span className="template-tags-label">Tags</span>
      <button
        type="button"
        className="template-tags-trigger"
        ref={triggerRef}
        aria-label="Template tags"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        disabled={busy}
        title={value.join(", ") || undefined}
        onClick={() => {
          setOpen(!open);
          setManaging(false);
          setSearch("");
          setActionError("");
          setStatus("");
        }}
      >
        {value.length ? (
          <span className="template-tags-chips">
            {value.map((tag) => (
              <span key={tag} className="template-tag-chip">
                {tag}
              </span>
            ))}
          </span>
        ) : (
          <span className="template-tags-placeholder">Add tags</span>
        )}
        {value.length > 1 ? <span className="template-tags-count">{value.length}</span> : null}
        <ChevronIcon />
      </button>
      {open ? (
        <div id={popupId} role="dialog" aria-label="Template tags" className="template-tags-popup">
          <div className="template-tags-popup-head">
            <div>
              <span className="eyebrow">{managing ? "Shared across this Workspace" : "This template"}</span>
              <strong>{managing ? "Manage template tags" : "Template tags"}</strong>
            </div>
            <button
              type="button"
              className="icon-action-button"
              aria-label="Close template tags"
              onClick={() => {
                close();
                triggerRef.current?.focus();
              }}
            >
              ×
            </button>
          </div>
          {error ? (
            <div className="template-tags-error" role="alert">
              <span>{error}</span>
              <button type="button" className="studio-text-button" disabled={busy} onClick={onReload}>
                Retry tags
              </button>
            </div>
          ) : null}
          {isLoading ? (
            <p className="template-tags-note" role="status">
              Loading tags…
            </p>
          ) : null}
          {managing ? (
            <>
              <p className="template-tags-note">Renaming or deleting a tag updates all templates immediately.</p>
              <div className="template-tags-list">
                {!tags.length && !isLoading ? (
                  <p className="template-tags-empty">No shared tags yet. Create a tag and save its template first.</p>
                ) : null}
                {tags.map((tag) =>
                  editing?.id === tag.id ? (
                    <form key={tag.id} className="template-tags-rename" onSubmit={rename}>
                      <label>
                        New tag name
                        <input
                          autoFocus
                          value={name}
                          disabled={busy}
                          onChange={(event) => setName(event.target.value)}
                        />
                      </label>
                      <div>
                        <button
                          type="button"
                          className="studio-text-button"
                          disabled={busy}
                          onClick={() => {
                            setEditing(null);
                            setActionError("");
                          }}
                        >
                          Cancel rename
                        </button>
                        <button
                          type="submit"
                          className="studio-text-button studio-save-action"
                          disabled={busy || !name.trim()}
                        >
                          Save tag name
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div key={tag.id} className="template-tags-row">
                      <span className="template-tags-name">{tag.name}</span>
                      <span
                        className="template-tags-usage"
                        title={`Used by ${tag.template_count} template${tag.template_count === 1 ? "" : "s"}`}
                      >
                        {tag.template_count}
                      </span>
                      <span className="template-tags-row-actions">
                        <button
                          type="button"
                          className="studio-text-button"
                          aria-label={`Rename ${tag.name}`}
                          disabled={busy}
                          onClick={() => {
                            setEditing(tag);
                            setName(tag.name);
                            setActionError("");
                            setStatus("");
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="studio-text-button studio-destructive"
                          aria-label={`Delete ${tag.name}`}
                          disabled={busy}
                          onClick={() => remove(tag)}
                        >
                          Delete
                        </button>
                      </span>
                    </div>
                  ),
                )}
              </div>
              <div className="template-tags-footer">
                <button
                  type="button"
                  className="studio-text-button"
                  disabled={busy}
                  aria-label="Back to tag selection"
                  onClick={back}
                >
                  ← Back
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="template-tags-search">
                <input
                  ref={searchRef}
                  aria-label="Search or create tags"
                  value={search}
                  disabled={busy}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setActionError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && canCreate) {
                      event.preventDefault();
                      toggle(candidate);
                      setSearch("");
                    }
                  }}
                  placeholder="Search or create a tag…"
                />
              </div>
              <div className="template-tags-list" role="group" aria-label="Available tags">
                {filtered.map((tag) => (
                  <label
                    className={`template-tags-row template-tags-option${value.includes(tag) ? " selected" : ""}`}
                    key={tag}
                  >
                    <input
                      type="checkbox"
                      aria-label={tag}
                      checked={value.includes(tag)}
                      disabled={busy}
                      onChange={() => toggle(tag)}
                    />
                    <span className="template-tags-name">{tag}</span>
                    <span
                      className="template-tags-usage"
                      title={
                        usage(tag) === undefined
                          ? "Created when this template is saved"
                          : `Used by ${usage(tag)} template${usage(tag) === 1 ? "" : "s"}`
                      }
                    >
                      {usage(tag) ?? "New"}
                    </span>
                  </label>
                ))}
                {canCreate ? (
                  <button
                    type="button"
                    className="template-tags-create"
                    disabled={busy}
                    onClick={() => {
                      toggle(candidate);
                      setSearch("");
                      searchRef.current?.focus();
                    }}
                  >
                    <span aria-hidden="true">+ </span>Create “{candidate}”
                  </button>
                ) : null}
                {!filtered.length && !canCreate && !isLoading ? (
                  <p className="template-tags-empty">
                    {choices.length ? "No matching tags." : "No tags yet. Type a name to create one."}
                  </p>
                ) : null}
              </div>
              <div className="template-tags-footer">
                <span>Saved with this template.</span>
                <button
                  type="button"
                  className="studio-text-button"
                  disabled={busy}
                  onClick={() => {
                    setManaging(true);
                    setActionError("");
                    setStatus("");
                  }}
                >
                  Manage tags
                </button>
              </div>
            </>
          )}
          {actionError || (!managing && searchError) ? (
            <p role="alert" className="template-tags-error">
              {actionError || searchError}
            </p>
          ) : null}
          {status ? (
            <p role="status" className="template-tags-note template-tags-status">
              {status}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="template-tags-chevron"
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <path d="M2 3.5 5 6.5 8 3.5" />
    </svg>
  );
}
