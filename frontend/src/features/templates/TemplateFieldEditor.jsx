import React, { useEffect, useState } from "react";

import {
  DATA_TYPES,
  EMPTY_FIELD,
  EMPTY_OBJECT_COLUMN,
  MAX_TEMPLATE_OBJECT_COLUMNS,
  OBJECT_SCHEMA_DATA_TYPES,
  isObjectLikeType,
  normalizeDataType,
  normalizeObjectSchema,
  sanitizeFieldName,
  toFieldId,
} from "./templateFields.js";

export function TemplateFieldEditor({
  fields,
  onChange,
  title,
  subtitle,
}) {
  const [activeFieldIndex, setActiveFieldIndex] = useState(0);
  const [schemaEditorFieldIndex, setSchemaEditorFieldIndex] = useState(null);

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
            next.object_schema = normalizeObjectSchema(field.object_schema);
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
        const nextSchema = updater(normalizeObjectSchema(field.object_schema));
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

        if (key === "key") {
          return column;
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
    if (!source) {
      return;
    }

    const copyName = source.name ? `${source.name} Copy` : "";

    const copy = {
      ...source,
      id: toFieldId(copyName),
      name: copyName,
      object_schema: source.object_schema
        ? normalizeObjectSchema(source.object_schema)
        : undefined,
    };

    onChange((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
    setActiveFieldIndex(index + 1);
  }

  const activeField = fields[activeFieldIndex] || null;
  const objectColumns = activeField
    ? normalizeObjectSchema(activeField.object_schema).columns
    : [];
  const schemaEditorField =
    schemaEditorFieldIndex === null ? null : fields[schemaEditorFieldIndex];
  const schemaEditorColumns = schemaEditorField
    ? normalizeObjectSchema(schemaEditorField.object_schema).columns
    : [];

  return (
    <div className="field-editor">
      <div className="field-editor-head">
        <div>
          <h3>{title}</h3>
          <p className="hint">{subtitle}</p>
        </div>
        <div className="field-editor-meta">
          <button type="button" onClick={addField}>
            Add Field
          </button>
        </div>
      </div>
      {fields.length === 0 ? (
        <p className="muted">No fields yet. Add at least one.</p>
      ) : (
        <div className="field-studio">
          <aside className="field-nav">
            {fields.map((field, index) => (
              <button
                key={`${field.id || "field"}-${index}`}
                type="button"
                className={
                  index === activeFieldIndex
                    ? "field-nav-item active"
                    : "field-nav-item"
                }
                onClick={() => setActiveFieldIndex(index)}
              >
                <div className="field-nav-top">
                  <div className="field-nav-label">
                    <strong>{field.name || `Field ${index + 1}`}</strong>
                    <span>{field.id || "ID auto-generated from name"}</span>
                  </div>
                  <div className="field-nav-badges">
                    <span className="status-pill pending">{field.data_type}</span>
                    {isObjectLikeType(field.data_type) ? (
                      <span className="status-chip">Object schema</span>
                    ) : null}
                  </div>
                </div>
              </button>
            ))}
          </aside>

          {activeField ? (
            <div className="field-detail">
              <div className="field-detail-head">
                <div>
                  <h4>
                    Field {activeFieldIndex + 1} of {fields.length}
                  </h4>
                  <p className="muted">
                    Configure extraction behavior and response shape.
                  </p>
                </div>
                <div className="actions compact">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => moveField(activeFieldIndex, -1)}
                    disabled={activeFieldIndex === 0}
                  >
                    Move Up
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => moveField(activeFieldIndex, 1)}
                    disabled={activeFieldIndex === fields.length - 1}
                  >
                    Move Down
                  </button>
                </div>
              </div>

              <div className="row three-up">
                <label>
                  Field ID
                  <input
                    value={activeField.id}
                    readOnly
                    placeholder="auto_generated_from_name"
                  />
                </label>
                <label>
                  Name
                  <input
                    value={activeField.name}
                    onChange={(event) =>
                      updateField(activeFieldIndex, "name", event.target.value)
                    }
                    placeholder="Medication Name"
                  />
                </label>
                <label>
                  Type
                  <select
                    value={activeField.data_type}
                    onChange={(event) =>
                      updateField(
                        activeFieldIndex,
                        "data_type",
                        event.target.value,
                      )
                    }
                  >
                    {DATA_TYPES.map((dataType) => (
                      <option key={dataType} value={dataType}>
                        {dataType}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                Description
                <textarea
                  value={activeField.description}
                  onChange={(event) =>
                    updateField(
                      activeFieldIndex,
                      "description",
                      event.target.value,
                    )
                  }
                  placeholder="Describe what should be extracted"
                />
              </label>

              <div className="field-controls">
                <div className="actions compact">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => duplicateField(activeFieldIndex)}
                  >
                    Duplicate
                  </button>
                  <button
                    className="danger"
                    type="button"
                    onClick={() => removeField(activeFieldIndex)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {isObjectLikeType(activeField.data_type) ? (
                <div className="object-schema-launch">
                  <div>
                    <strong>Object Schema</strong>
                    <p className="hint">
                      {objectColumns.length
                        ? `${objectColumns.length} column${
                            objectColumns.length === 1 ? "" : "s"
                          } defined`
                        : "No columns defined yet"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setSchemaEditorFieldIndex(activeFieldIndex)}
                  >
                    Edit Schema
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {schemaEditorField && isObjectLikeType(schemaEditorField.data_type) ? (
        <ObjectSchemaModal
          fieldName={schemaEditorField.name}
          columns={schemaEditorColumns}
          onAddColumn={() => addObjectColumn(schemaEditorFieldIndex)}
          onUpdateColumn={(columnIndex, key, value) =>
            updateObjectColumn(schemaEditorFieldIndex, columnIndex, key, value)
          }
          onMoveColumn={(columnIndex, direction) =>
            moveObjectColumn(schemaEditorFieldIndex, columnIndex, direction)
          }
          onRemoveColumn={(columnIndex) =>
            removeObjectColumn(schemaEditorFieldIndex, columnIndex)
          }
          onClose={() => setSchemaEditorFieldIndex(null)}
        />
      ) : null}
    </div>
  );
}

function ObjectSchemaModal({
  fieldName,
  columns,
  onAddColumn,
  onUpdateColumn,
  onMoveColumn,
  onRemoveColumn,
  onClose,
}) {
  return (
    <div
      className="modal-backdrop object-schema-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="modal-card object-schema-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="object-schema-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="object-schema-modal-head">
          <div>
            <p className="eyebrow">{fieldName || "Object Field"}</p>
            <h2 id="object-schema-modal-title">Object Schema Builder</h2>
            <p>
              Define output columns and their order for table-style object
              extraction.
            </p>
          </div>
          <div className="actions compact object-schema-modal-head-actions">
            <button
              type="button"
              onClick={onAddColumn}
              disabled={columns.length >= MAX_TEMPLATE_OBJECT_COLUMNS}
              title={`Maximum ${MAX_TEMPLATE_OBJECT_COLUMNS} columns`}
            >
              Add Column
            </button>
            <button
              type="button"
              className="icon-action-button object-schema-modal-close"
              aria-label="Close object schema editor"
              title="Close"
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>

        <div className="object-schema-table-wrap">
          <table
            className="object-schema-table"
            aria-label="Object schema columns"
          >
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Column Name</th>
                <th scope="col">Column ID</th>
                <th scope="col">Type</th>
                <th scope="col">Description</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!columns.length ? (
                <tr>
                  <td className="object-schema-empty" colSpan="6">
                    No columns yet. Add one to start defining the object shape.
                  </td>
                </tr>
              ) : (
                columns.map((column, columnIndex) => (
                  <tr className="object-column-card" key={columnIndex}>
                    <td>
                      <span className="object-schema-row-number">
                        Column {columnIndex + 1}
                      </span>
                    </td>
                    <td>
                      <input
                        aria-label="Column Name"
                        value={column.heading}
                        onChange={(event) =>
                          onUpdateColumn(
                            columnIndex,
                            "heading",
                            event.target.value,
                          )
                        }
                        placeholder="Line Total"
                      />
                    </td>
                    <td>
                      <input
                        aria-label="Column ID"
                        value={column.key}
                        readOnly
                        placeholder="auto_generated_from_name"
                      />
                    </td>
                    <td>
                      <select
                        aria-label="Type"
                        value={column.data_type}
                        onChange={(event) =>
                          onUpdateColumn(
                            columnIndex,
                            "data_type",
                            event.target.value,
                          )
                        }
                      >
                        {OBJECT_SCHEMA_DATA_TYPES.map((dataType) => (
                          <option key={dataType} value={dataType}>
                            {dataType}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label="Column Description"
                        value={column.description}
                        onChange={(event) =>
                          onUpdateColumn(
                            columnIndex,
                            "description",
                            event.target.value,
                          )
                        }
                        placeholder="What this column contains"
                      />
                    </td>
                    <td>
                      <div className="object-schema-row-actions">
                        <button
                          type="button"
                          className="secondary"
                          aria-label={`Move Column ${columnIndex + 1} Up`}
                          onClick={() => onMoveColumn(columnIndex, -1)}
                          disabled={columnIndex === 0}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          aria-label={`Move Column ${columnIndex + 1} Down`}
                          onClick={() => onMoveColumn(columnIndex, 1)}
                          disabled={columnIndex === columns.length - 1}
                        >
                          Down
                        </button>
                        <button
                          className="danger"
                          type="button"
                          aria-label={`Remove Column ${columnIndex + 1}`}
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
        </div>

        <div className="object-schema-modal-footer">
          <p className="hint">
            Changes are applied to the current template draft as you edit.
          </p>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
