import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { diagnoseTemplateDraft, groupIssuesByLocation } from "../../../../shared/templateAssistant.ts";
import { focusDiagnostic } from "./focusDiagnostic.js";
import { DiagnosticMessages } from "./TemplateDiagnostics.jsx";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ModalDialog } from "../layout/ModalDialog.jsx";

import {
  DATA_TYPES,
  EMPTY_FIELD,
  EMPTY_OBJECT_COLUMN,
  MAX_TEMPLATE_OBJECT_COLUMNS,
  OBJECT_SCHEMA_DATA_TYPES,
  getDataTypeLabel,
  isObjectLikeType,
  normalizeDataType,
  sanitizeFieldName,
  toFieldId,
} from "./templateFields.js";

const editableSchema = (schema) => ({
  ...(schema || {}),
  mode: schema?.mode || "table",
  columns: Array.isArray(schema?.columns) ? schema.columns : [],
});

export function TemplateFieldEditor({
  fields,
  onChange,
  saveAction,
  jsonAction,
  disabled = false,
  diagnostics,
  focusRequest,
}) {
  const rootRef = useRef(null);
  const diagnosticPrefix = useId();

  const issues = useMemo(
    () =>
      diagnostics ||
      diagnoseTemplateDraft({ name: "Template", fields }).filter((issue) => issue.location.scope !== "template"),
    [diagnostics, fields],
  );

  const grouped = useMemo(() => groupIssuesByLocation(issues), [issues]);
  const at = (property, fieldIndex = activeFieldIndex) => `field:${fieldIndex}:${property}`;

  const diagnosticProps = (key) => ({
    "data-diagnostic-location": key,
    "aria-invalid": (grouped.byKey.get(key)?.length || 0) > 0,
    "aria-describedby": `${diagnosticPrefix}-${key}`,
  });

  const messages = (key) => <DiagnosticMessages id={`${diagnosticPrefix}-${key}`} issues={grouped.byKey.get(key)} />;
  const [activeFieldIndex, setActiveFieldIndex] = useState(0);
  const [schemaEditorFieldIndex, setSchemaEditorFieldIndex] = useState(null);

  useEffect(() => {
    const location = focusRequest?.issue?.location;

    if (!location) return;

    if (location.scope !== "template") setActiveFieldIndex(location.fieldIndex);

    if (location.scope === "column") setSchemaEditorFieldIndex(location.fieldIndex);
    else if (location.scope !== "template") setSchemaEditorFieldIndex(null);

    const timer = setTimeout(() => {
      if (location.scope === "template" && location.property === "fields")
        rootRef.current?.querySelector('[data-tour="add-field"]')?.focus();
      else if (location.scope !== "column") focusDiagnostic(rootRef.current, location);
    }, 0);

    return () => clearTimeout(timer);
  }, [focusRequest]);

  useEffect(() => {
    if (!fields.length) {
      setActiveFieldIndex(0);

      return;
    }

    if (activeFieldIndex > fields.length - 1) {
      setActiveFieldIndex(fields.length - 1);
    }
  }, [activeFieldIndex, fields.length]);

  useEffect(() => {
    if (schemaEditorFieldIndex === null) {
      return undefined;
    }

    const schemaField = fields[schemaEditorFieldIndex];

    if (!schemaField || !isObjectLikeType(schemaField.data_type)) {
      setSchemaEditorFieldIndex(null);

      return undefined;
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setSchemaEditorFieldIndex(null);
      }
    }

    document.addEventListener("keydown", closeOnEscape);

    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [fields, schemaEditorFieldIndex]);

  function addField() {
    onChange((prev) => [...prev, { ...EMPTY_FIELD }]);
    setActiveFieldIndex(fields.length);
  }

  function moveField(index, direction) {
    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= fields.length) {
      return;
    }

    onChange((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);

      return next;
    });
    setActiveFieldIndex(targetIndex);
  }

  function updateField(index, key, value) {
    onChange((prev) =>
      prev.map((field, i) => {
        if (i !== index) {
          return field;
        }

        if (key === "name") {
          const sanitizedName = sanitizeFieldName(value);

          return {
            ...field,
            name: sanitizedName,
            id: toFieldId(sanitizedName),
          };
        }

        if (key === "data_type") {
          const normalizedDataType = normalizeDataType(value) || "string";
          const next = { ...field, [key]: normalizedDataType };

          if (isObjectLikeType(normalizedDataType)) {
            next.object_schema = editableSchema(field.object_schema);
          } else {
            delete next.object_schema;
          }

          return next;
        }

        return { ...field, [key]: value };
      }),
    );
  }

  function updateObjectSchema(index, updater) {
    onChange((prev) =>
      prev.map((field, i) => {
        if (i !== index) {
          return field;
        }

        const nextSchema = updater(editableSchema(field.object_schema));

        return { ...field, object_schema: nextSchema };
      }),
    );
  }

  function addObjectColumn(index) {
    updateObjectSchema(index, (schema) => ({
      ...schema,
      columns:
        schema.columns.length >= MAX_TEMPLATE_OBJECT_COLUMNS
          ? schema.columns
          : [...schema.columns, { ...EMPTY_OBJECT_COLUMN }],
    }));
  }

  function updateObjectColumn(index, columnIndex, key, value) {
    updateObjectSchema(index, (schema) => ({
      ...schema,
      columns: schema.columns.map((column, i) => {
        if (i !== columnIndex) {
          return column;
        }

        if (key === "heading") {
          const sanitizedHeading = sanitizeFieldName(value).replace(/\s+/g, " ");

          return {
            ...column,
            heading: sanitizedHeading,
            key: toFieldId(sanitizedHeading),
          };
        }

        return { ...column, [key]: value };
      }),
    }));
  }

  function removeObjectColumn(index, columnIndex) {
    updateObjectSchema(index, (schema) => ({
      ...schema,
      columns: schema.columns.filter((_, i) => i !== columnIndex),
    }));
  }

  function moveObjectColumn(index, columnIndex, direction) {
    updateObjectSchema(index, (schema) => {
      const targetIndex = columnIndex + direction;

      if (targetIndex < 0 || targetIndex >= schema.columns.length) {
        return schema;
      }

      const nextColumns = [...schema.columns];
      const [moved] = nextColumns.splice(columnIndex, 1);
      nextColumns.splice(targetIndex, 0, moved);

      return {
        ...schema,
        columns: nextColumns,
      };
    });
  }

  function removeField(index) {
    onChange((prev) => prev.filter((_, i) => i !== index));
  }

  function duplicateField(index) {
    const source = fields[index];
    const copyName = source.name ? `${source.name} Copy` : "";

    const copy = {
      ...source,
      id: toFieldId(copyName),
      name: copyName,
      object_schema: source.object_schema ? structuredClone(source.object_schema) : undefined,
    };

    onChange((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, copy);

      return next;
    });
    setActiveFieldIndex(index + 1);
  }

  const activeField = fields[activeFieldIndex] || null;

  const objectColumns = activeField ? editableSchema(activeField.object_schema).columns : [];

  const schemaEditorField = schemaEditorFieldIndex === null ? null : fields[schemaEditorFieldIndex];

  const schemaEditorColumns = schemaEditorField ? editableSchema(schemaEditorField.object_schema).columns : [];

  return (
    <fieldset ref={rootRef} className="field-editor" disabled={disabled}>
      <div className="field-studio">
        <ScrollArea as="nav" className="field-nav" aria-label="Template fields" tabIndex={0}>
          {fields.map((field, index) => (
            <button
              key={`${field.id || "field"}-${index}`}
              type="button"
              className={
                (index === activeFieldIndex ? "field-nav-item active" : "field-nav-item") +
                (grouped.byField.get(index)?.length ? " template-field-has-problems" : "")
              }
              aria-current={index === activeFieldIndex ? "true" : undefined}
              onClick={() => setActiveFieldIndex(index)}
            >
              <span className="studio-row-number">{String(index + 1).padStart(2, "0")}</span>
              <div className="field-nav-top">
                <div className="field-nav-label">
                  <strong>{field.name || `Field ${index + 1}`}</strong>
                  {grouped.byField.get(index)?.length > 0 ? (
                    <span className="template-problem-badge">
                      {grouped.byField.get(index).length} problem{grouped.byField.get(index).length === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span>{getDataTypeLabel(field.data_type)}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
          <button data-tour="add-field" className="studio-add-field" type="button" onClick={addField}>
            + Add field
          </button>
        </ScrollArea>

        {activeField ? (
          <ScrollArea className="field-detail" role="region" aria-label="Selected field editor" tabIndex={0}>
            <div className="field-detail-head">
              <p className="studio-eyebrow">
                Field {activeFieldIndex + 1} of {fields.length}
              </p>
              <h2>{activeField.name || "New field"}</h2>
              <p>Tell the model exactly what belongs in this field.</p>
            </div>

            <div className="row two-up">
              <div>
                <label>
                  Name
                  <input
                    data-tour="field-name"
                    {...diagnosticProps(at("name"))}
                    value={activeField.name}
                    onChange={(event) => updateField(activeFieldIndex, "name", event.target.value)}
                    placeholder="Medication Name"
                  />
                </label>
                {messages(at("name"))}
              </div>
              <div>
                <label>
                  Type
                  <select
                    data-tour="field-type"
                    {...diagnosticProps(at("data_type"))}
                    value={activeField.data_type}
                    onChange={(event) => updateField(activeFieldIndex, "data_type", event.target.value)}
                  >
                    {!DATA_TYPES.includes(activeField.data_type) && (
                      <option value={activeField.data_type}>{activeField.data_type || "Choose a type"}</option>
                    )}
                    {activeField.data_type === "array" ? (
                      <option value="array" disabled>
                        {getDataTypeLabel("array")}
                      </option>
                    ) : null}
                    {DATA_TYPES.flatMap((dataType) =>
                      dataType === "array"
                        ? []
                        : [
                            <option key={dataType} value={dataType}>
                              {getDataTypeLabel(dataType)}
                            </option>,
                          ],
                    )}
                  </select>
                </label>
                {messages(at("data_type"))}
              </div>
            </div>
            <label>
              Extraction instructions
              <textarea
                data-tour="field-description"
                {...diagnosticProps(at("description"))}
                value={activeField.description}
                onChange={(event) => updateField(activeFieldIndex, "description", event.target.value)}
                placeholder="Describe what should be extracted"
              />
            </label>

            {messages(at("description"))}
            <p className="studio-field-id">
              Field ID <code>{activeField.id || "Generated from the field name"}</code>
            </p>
            <div className="field-controls">
              <div className="studio-field-order">
                <button
                  type="button"
                  className="studio-text-button"
                  onClick={() => moveField(activeFieldIndex, -1)}
                  disabled={activeFieldIndex === 0}
                >
                  ↑ Move up
                </button>
                <button
                  type="button"
                  className="studio-text-button"
                  onClick={() => moveField(activeFieldIndex, 1)}
                  disabled={activeFieldIndex === fields.length - 1}
                >
                  ↓ Move down
                </button>
                <button type="button" className="studio-text-button" onClick={() => duplicateField(activeFieldIndex)}>
                  Duplicate
                </button>
              </div>
              <div className="studio-field-save">
                {jsonAction}
                <button
                  type="button"
                  className="studio-text-button studio-destructive"
                  onClick={() => removeField(activeFieldIndex)}
                >
                  Remove field
                </button>
                {saveAction}
              </div>
            </div>

            {isObjectLikeType(activeField.data_type) ? (
              <div className="object-schema-launch">
                <div>
                  <strong>Object schema</strong>
                  <p className="hint">
                    {objectColumns.length
                      ? `${objectColumns.length} column${objectColumns.length === 1 ? "" : "s"} defined`
                      : "No columns defined yet"}
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary"
                  data-tour="schema-open"
                  {...diagnosticProps(at("object_schema"))}
                  onClick={() => setSchemaEditorFieldIndex(activeFieldIndex)}
                >
                  Edit schema
                </button>
                {messages(at("object_schema"))}
              </div>
            ) : null}
          </ScrollArea>
        ) : (
          <div className="field-detail">
            <p className="muted">No fields yet. Add at least one.</p>
            <div className="studio-field-save">
              {jsonAction}
              {saveAction}
            </div>
          </div>
        )}
      </div>

      {schemaEditorField && isObjectLikeType(schemaEditorField.data_type)
        ? createPortal(
            <ObjectSchemaModal
              fieldName={schemaEditorField.name}
              fieldIndex={schemaEditorFieldIndex}
              grouped={grouped}
              focusRequest={focusRequest}
              disabled={disabled}
              columns={schemaEditorColumns}
              onAddColumn={() => addObjectColumn(schemaEditorFieldIndex)}
              onUpdateColumn={(columnIndex, key, value) =>
                updateObjectColumn(schemaEditorFieldIndex, columnIndex, key, value)
              }
              onMoveColumn={(columnIndex, direction) =>
                moveObjectColumn(schemaEditorFieldIndex, columnIndex, direction)
              }
              onRemoveColumn={(columnIndex) => removeObjectColumn(schemaEditorFieldIndex, columnIndex)}
              onClose={() => setSchemaEditorFieldIndex(null)}
            />,
            document.body,
          )
        : null}
    </fieldset>
  );
}

function ObjectSchemaModal({
  fieldName,
  fieldIndex,
  grouped,
  focusRequest,
  disabled,
  columns,
  onAddColumn,
  onUpdateColumn,
  onMoveColumn,
  onRemoveColumn,
  onClose,
}) {
  const headRef = useRef(null);
  const prefix = useId();
  const at = (columnIndex, property) => `column:${fieldIndex}:${columnIndex}:${property}`;

  const diagnosticProps = (key) => ({
    "data-diagnostic-location": key,
    "aria-invalid": (grouped.byKey.get(key)?.length || 0) > 0,
    "aria-describedby": `${prefix}-${key}`,
  });

  const messages = (key) => <DiagnosticMessages compact id={`${prefix}-${key}`} issues={grouped.byKey.get(key)} />;
  useEffect(() => {
    if (focusRequest?.issue?.location?.scope !== "column") return;
    const timer = setTimeout(() => focusDiagnostic(headRef.current?.closest(".modal-card"), focusRequest.issue.location), 0);

    return () => clearTimeout(timer);
  }, [focusRequest]);

  return (
    <ModalDialog
      labelledBy="object-schema-modal-title"
      className="object-schema-modal"
      data-tour="schema-editor"
      initialFocus="button:not(:disabled)"
      onClose={onClose}
    >
        <div className="object-schema-modal-head" ref={headRef}>
          <div>
            <p className="eyebrow">{fieldName || "Object Field"}</p>
            <h2 id="object-schema-modal-title">Object schema builder</h2>
            <p>Define output columns and their order for table-style object extraction.</p>
          </div>
          <div className="actions compact object-schema-modal-head-actions">
            <button
              type="button"
              onClick={onAddColumn}
              disabled={disabled || columns.length >= MAX_TEMPLATE_OBJECT_COLUMNS}
              title={`Maximum ${MAX_TEMPLATE_OBJECT_COLUMNS} columns`}
            >
              Add column
            </button>
            <button
              type="button"
              className="modal-close"
              aria-label="Close object schema editor"
              data-tour="schema-close"
              title="Close"
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>

        <ScrollArea
          className="object-schema-table-wrap"
          role="region"
          aria-label="Object schema scroll area"
          tabIndex={0}
        >
          <table className="object-schema-table" aria-label="Object schema columns">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Column name</th>
                <th scope="col">Type</th>
                <th scope="col">Description</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!columns.length ? (
                <tr>
                  <td className="object-schema-empty" colSpan="5">
                    No columns yet. Add one to start defining the object shape.
                  </td>
                </tr>
              ) : (
                columns.map((column, columnIndex) => (
                  <tr className="object-column-card" key={columnIndex}>
                    <td>
                      <span className="object-schema-row-number">Column {columnIndex + 1}</span>
                    </td>
                    <td>
                      <input
                        aria-label="Column name"
                        disabled={disabled}
                        {...diagnosticProps(at(columnIndex, "heading"))}
                        value={column.heading}
                        onChange={(event) => onUpdateColumn(columnIndex, "heading", event.target.value)}
                        placeholder="Line Total"
                      />
                      {messages(at(columnIndex, "heading"))}
                    </td>
                    <td>
                      <select
                        aria-label="Type"
                        disabled={disabled}
                        {...diagnosticProps(at(columnIndex, "data_type"))}
                        value={column.data_type}
                        onChange={(event) => onUpdateColumn(columnIndex, "data_type", event.target.value)}
                      >
                        {!OBJECT_SCHEMA_DATA_TYPES.includes(column.data_type) && (
                          <option value={column.data_type}>{column.data_type || "Choose a type"}</option>
                        )}
                        {OBJECT_SCHEMA_DATA_TYPES.map((dataType) => (
                          <option key={dataType} value={dataType}>
                            {getDataTypeLabel(dataType)}
                          </option>
                        ))}
                      </select>
                      {messages(at(columnIndex, "data_type"))}
                    </td>
                    <td>
                      <input
                        aria-label="Column Description"
                        disabled={disabled}
                        {...diagnosticProps(at(columnIndex, "description"))}
                        value={column.description}
                        onChange={(event) => onUpdateColumn(columnIndex, "description", event.target.value)}
                        placeholder="What this column contains"
                      />
                      {messages(at(columnIndex, "description"))}
                    </td>
                    <td>
                      <div className="object-schema-row-actions">
                        <button
                          type="button"
                          className="secondary"
                          aria-label={`Move Column ${columnIndex + 1} Up`}
                          onClick={() => onMoveColumn(columnIndex, -1)}
                          disabled={disabled || columnIndex === 0}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          aria-label={`Move Column ${columnIndex + 1} Down`}
                          onClick={() => onMoveColumn(columnIndex, 1)}
                          disabled={disabled || columnIndex === columns.length - 1}
                        >
                          Down
                        </button>
                        <button
                          className="danger"
                          type="button"
                          aria-label={`Remove Column ${columnIndex + 1}`}
                          disabled={disabled}
                          onClick={() => onRemoveColumn(columnIndex)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollArea>

        <div className="object-schema-modal-footer">
          <p className="hint">Changes are applied to the current template draft as you edit.</p>
          <button type="button" data-tour="schema-done" onClick={onClose}>
            Done
          </button>
        </div>
    </ModalDialog>
  );
}
