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

  useEffect(() => {
    if (!fields.length) {
      setActiveFieldIndex(0);
      return;
    }

    if (activeFieldIndex > fields.length - 1) {
      setActiveFieldIndex(fields.length - 1);
    }
  }, [activeFieldIndex, fields.length]);

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
                <div className="object-schema-editor">
                  <div className="object-schema-head">
                    <div>
                      <strong>Object Schema Builder</strong>
                      <p className="hint">
                        Define output columns and ordering for table-style
                        object extraction.
                      </p>
                    </div>
                    <div className="actions compact">
                      <button
                        type="button"
                        onClick={() => addObjectColumn(activeFieldIndex)}
                        disabled={objectColumns.length >= MAX_TEMPLATE_OBJECT_COLUMNS}
                        title={`Maximum ${MAX_TEMPLATE_OBJECT_COLUMNS} columns`}
                      >
                        Add Column
                      </button>
                    </div>
                  </div>
                  {!objectColumns.length ? (
                    <p className="muted">
                      No columns yet. Add one to start defining the object
                      shape.
                    </p>
                  ) : (
                    <div className="object-column-list">
                      {objectColumns.map((column, columnIndex) => (
                        <div className="object-column-card" key={columnIndex}>
                          <p className="hint object-column-index">
                            Column {columnIndex + 1}
                          </p>
                          <div className="row object-columns-grid">
                            <label>
                              Column Name
                              <input
                                value={column.heading}
                                onChange={(event) =>
                                  updateObjectColumn(
                                    activeFieldIndex,
                                    columnIndex,
                                    "heading",
                                    event.target.value,
                                  )
                                }
                                placeholder="Line Total"
                              />
                            </label>
                            <label>
                              Column ID
                              <input
                                value={column.key}
                                readOnly
                                placeholder="auto_generated_from_name"
                              />
                            </label>
                            <label>
                              Type
                              <select
                                value={column.data_type}
                                onChange={(event) =>
                                  updateObjectColumn(
                                    activeFieldIndex,
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
                            </label>
                            <label>
                              Column Description
                              <input
                                value={column.description}
                                onChange={(event) =>
                                  updateObjectColumn(
                                    activeFieldIndex,
                                    columnIndex,
                                    "description",
                                    event.target.value,
                                  )
                                }
                                placeholder="What this column contains"
                              />
                            </label>
                          </div>
                          <div className="actions compact">
                            <button
                              type="button"
                              className="secondary"
                              onClick={() =>
                                moveObjectColumn(
                                  activeFieldIndex,
                                  columnIndex,
                                  -1,
                                )
                              }
                              disabled={columnIndex === 0}
                            >
                              Move Up
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() =>
                                moveObjectColumn(
                                  activeFieldIndex,
                                  columnIndex,
                                  1,
                                )
                              }
                              disabled={columnIndex === objectColumns.length - 1}
                            >
                              Move Down
                            </button>
                            <button
                              className="danger"
                              type="button"
                              onClick={() =>
                                removeObjectColumn(activeFieldIndex, columnIndex)
                              }
                            >
                              Remove Column
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
