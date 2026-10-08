import React, { useEffect, useMemo, useRef, useState } from "react";
import { normalizeTemplateTagName, normalizeTemplateTags } from "../../../../shared/templateTags.ts";
import { describeError } from "../../lib/describeError";
import { confirmDialog } from "../ui/confirm.jsx";
import "./TemplateTags.css";
import { CloseIcon, ChevronDownIcon, ChevronLeftIcon } from "../layout/Icons.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import { ListAddButton } from "../ui/ListAddButton.jsx";
import { Tag } from "../ui/Status.jsx";
import { Field, TextInput } from "../ui/Field.jsx";
import { Popover } from "../ui/Popover.jsx";

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
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [actionError, setActionError] = useState("");
  const busy = disabled || isManaging;

  const close = () => {
    setOpen(false);
    setEditing(null);
    setActionError("");
  };

  useEffect(() => {
    if (!open) return;

    if (!managing) searchRef.current?.focus();
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

    try {
      normalizeTemplateTagName(name);
    } catch (failure) {
      setActionError(failure.message);

      return;
    }

    try {
      // The controller reports success and failure as toasts; only a duplicate name stays here.
      if (await onRename(editing, name)) setEditing(null);
    } catch (failure) {
      setActionError(describeError(failure, "Couldn't rename the tag. Try again."));
    }
  }

  async function remove(tag) {
    const count = tag.template_count;

    const confirmed = await confirmDialog({
      title: `Delete tag "${tag.name}"?`,
      body: `It will be removed from ${count} template${count === 1 ? "" : "s"}. This can't be undone.`,
      confirmLabel: "Delete tag",
      pendingLabel: "Deleting…",
    });

    if (!confirmed) return;
    setActionError("");

    try {
      if (await onDelete(tag)) setEditing(null);
    } catch (failure) {
      setActionError(describeError(failure, "Couldn't delete the tag. Try again."));
    }
  }

  const usage = (name) => tags.find((tag) => tag.name === name)?.template_count;

  const back = () => {
    setManaging(false);
    setEditing(null);
    setActionError("");
  };

  return (
    <div className="template-tags">
      <span className="template-tags-label">Tags</span>
      <Popover
        open={open}
        onClose={close}
        label="Template tags"
        className="template-tags-anchor"
        panelClassName="template-tags-popup"
        trigger={(triggerProps) => (
          <button
            type="button"
            className="template-tags-trigger"
            aria-label="Template tags"
            aria-haspopup="dialog"
            disabled={busy}
            title={value.join(", ") || undefined}
            {...triggerProps}
            onClick={() => {
              setOpen(!open);
              setManaging(false);
              setSearch("");
              setActionError("");
            }}
          >
            {value.length ? (
              <span className="template-tags-chips">
                {value.map((tag) => (
                  <Tag key={tag} className="template-tag-chip">
                    {tag}
                  </Tag>
                ))}
              </span>
            ) : (
              <span className="template-tags-placeholder">Add tags</span>
            )}
            {value.length > 1 ? <span className="template-tags-count">{value.length}</span> : null}
            <ChevronDownIcon className="template-tags-chevron" size={10} />
          </button>
        )}
      >
        <div className="template-tags-popup-head">
          <div>
            {managing ? <span className="eyebrow">Shared across this workspace</span> : null}
            <strong>{managing ? "Manage tags" : "Template tags"}</strong>
          </div>
          <IconButton
            label="Close template tags"
            icon={CloseIcon}
            size="sm"
            onClick={close}
          />
        </div>
        {error ? (
          <div className="template-tags-error" role="alert">
            <span>{error}</span>
            <Button type="button" variant="text" disabled={busy} onClick={onReload}>
              Try again
            </Button>
          </div>
        ) : null}
        {isLoading ? (
          <p className="template-tags-note" role="status">
            Loading tags…
          </p>
        ) : null}
        {managing ? (
          <>
            <div className="template-tags-list">
              {!tags.length && !isLoading ? (
                <p className="template-tags-empty">No tags yet.</p>
              ) : null}
              {tags.map((tag) =>
                editing?.id === tag.id ? (
                  <form key={tag.id} className="template-tags-rename" onSubmit={rename}>
                    <Field label="New tag name">
                      <TextInput
                        autoFocus
                        value={name}
                        disabled={busy}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </Field>
                    <div>
                      <Button
                        type="button"
                        variant="text"
                        disabled={busy}
                        onClick={() => {
                          setEditing(null);
                          setActionError("");
                        }}
                      >
                        Cancel rename
                      </Button>
                      <Button type="submit" size="sm" disabled={busy || !name.trim()}>
                        Save tag name
                      </Button>
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
                      <Button
                        type="button"
                        variant="text"
                        aria-label={`Rename ${tag.name}`}
                        disabled={busy}
                        onClick={() => {
                          setEditing(tag);
                          setName(tag.name);
                          setActionError("");
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        type="button"
                        variant="danger-text"
                        aria-label={`Delete ${tag.name}`}
                        disabled={busy}
                        onClick={() => remove(tag)}
                      >
                        Delete
                      </Button>
                    </span>
                  </div>
                ),
              )}
            </div>
            <div className="template-tags-footer">
              <Button
                type="button"
                variant="text"
                disabled={busy}
                onClick={back}
              >
                <ChevronLeftIcon />
                Back to tags
              </Button>
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
                placeholder="e.g. Finance"
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
                <ListAddButton
                  disabled={busy}
                  onClick={() => {
                    toggle(candidate);
                    setSearch("");
                    searchRef.current?.focus();
                  }}
                >
                  Create “{candidate}”
                </ListAddButton>
              ) : null}
              {!filtered.length && !canCreate && !isLoading ? (
                <p className="template-tags-empty">
                  {choices.length ? "No matching tags." : "No tags yet. Type a name to create one."}
                </p>
              ) : null}
            </div>
            <div className="template-tags-footer">
              <Button
                type="button"
                variant="text"
                disabled={busy}
                onClick={() => {
                  setManaging(true);
                  setActionError("");
                }}
              >
                Manage tags
              </Button>
            </div>
          </>
        )}
        {actionError || (!managing && searchError) ? (
          <p role="alert" className="template-tags-error">
            {actionError || searchError}
          </p>
        ) : null}
      </Popover>
    </div>
  );
}
