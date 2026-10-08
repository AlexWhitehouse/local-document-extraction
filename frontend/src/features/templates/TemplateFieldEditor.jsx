import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { diagnoseTemplateDraft, groupIssuesByLocation } from "../../../../shared/templateAssistant.ts";
import { focusDiagnostic } from "./focusDiagnostic.js";
import { issueMessage, issueRemedy } from "./issueMessages.js";
import { Field, Select, TextInput, Textarea } from "../ui/Field.jsx";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { DataTable } from "../ui/DataTable.jsx";
import "./TemplateFieldEditor.css";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, MoreIcon } from "../layout/Icons.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import { ListAddButton } from "../ui/ListAddButton.jsx";
import { ActionMenu } from "../ui/ActionMenu.jsx";
import { createNotifier, defaultToast } from "../../lib/notify";
import { insertAt } from "../../lib/lists";

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

const defaultShowActionToast = createNotifier(defaultToast);

const editableSchema = (schema) => ({
  ...(schema || {}),
  mode: schema?.mode || "table",
  columns: Array.isArray(schema?.columns) ? schema.columns : [],
});

export function TemplateFieldEditor({
  fields,
  onChange,
  disabled = false,
  diagnostics,
  focusRequest,
  showActionToast = defaultShowActionToast,
}) {
  const rootRef = useRef(null);

  const issues = useMemo(
    () =>
      diagnostics ||
      diagnoseTemplateDraft({ name: "Template", fields }).filter((issue) => issue.location.scope !== "template"),
    [diagnostics, fields],
  );

  const grouped = useMemo(() => groupIssuesByLocation(issues), [issues]);
  const at = (property, fieldIndex = activeFieldIndex) => `field:${fieldIndex}:${property}`;

  const diagnosticProps = (key) => ({ "data-diagnostic-location": key });
  const errorAt = (key) => issueMessage(grouped.byKey.get(key));
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

  // Removes immediately. Undo puts the column back at its position, if the field is still a Table.
  function removeObjectColumn(index, columnIndex) {
    const removed = editableSchema(fields[index]?.object_schema).columns[columnIndex];

    updateObjectSchema(index, (schema) => ({
      ...schema,
      columns: schema.columns.filter((_, i) => i !== columnIndex),
    }));

    if (!removed) return;

    showActionToast("draft.removeColumn", "success", {
      targetName: removed.heading || `Column ${columnIndex + 1}`,
      undo: () =>
        onChange((prev) =>
          prev.map((field, i) => {
            if (i !== index || !isObjectLikeType(field.data_type)) return field;

            const schema = editableSchema(field.object_schema);

            return { ...field, object_schema: { ...schema, columns: insertAt(schema.columns, columnIndex, removed) } };
          }),
        ),
    });
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

  // Removes immediately. Undo puts the field back at its position and re-selects what was selected.
  function removeField(index) {
    const removed = fields[index];
    const previousActiveIndex = activeFieldIndex;

    onChange((prev) => prev.filter((_, i) => i !== index));

    if (index < activeFieldIndex) setActiveFieldIndex(activeFieldIndex - 1);

    if (!removed) return;

    showActionToast("draft.removeField", "success", {
      targetName: removed.name || `Field ${index + 1}`,
      undo: () => {
        onChange((prev) => insertAt(prev, index, removed));
        setActiveFieldIndex(previousActiveIndex);
      },
    });
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
          {fields.map((field, index) => {
            const fieldName = field.name || `Field ${index + 1}`;

            return (
              <div key={`${field.id || "field"}-${index}`} className="field-nav-row">
                <button
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
                      <strong>{fieldName}</strong>
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
                <div className="field-nav-row-actions">
                  <IconButton
                    label={`Move ${fieldName} up`}
                    icon={ArrowUpIcon}
                    size="sm"
                    disabled={index === 0}
                    onClick={() => moveField(index, -1)}
                  />
                  <IconButton
                    label={`Move ${fieldName} down`}
                    icon={ArrowDownIcon}
                    size="sm"
                    disabled={index === fields.length - 1}
                    onClick={() => moveField(index, 1)}
                  />
                  <ActionMenu
                    label={`More actions for ${fieldName}`}
                    icon={MoreIcon}
                    items={[
                      { key: "duplicate", label: "Duplicate", onSelect: () => duplicateField(index) },
                      { key: "remove", label: "Remove field", danger: true, onSelect: () => removeField(index) },
                    ]}
                  />
                </div>
              </div>
            );
          })}
          <ListAddButton data-tour="add-field" onClick={addField}>
            Add field
          </ListAddButton>
        </ScrollArea>

        {activeField ? (
          <ScrollArea className="field-detail" role="region" aria-label="Selected field editor" tabIndex={0}>
            <div className="field-detail-head">
              <p className="studio-eyebrow">
                Field {activeFieldIndex + 1} of {fields.length}
              </p>
              <h2>{activeField.name || "New field"}</h2>
            </div>

            <div className="row two-up">
              <Field label="Name" error={errorAt(at("name"))}>
                <TextInput
                  data-tour="field-name"
                  {...diagnosticProps(at("name"))}
                  value={activeField.name}
                  onChange={(event) => updateField(activeFieldIndex, "name", event.target.value)}
                  placeholder="e.g. Invoice number"
                />
              </Field>
              <Field label="Type" error={errorAt(at("data_type"))}>
                <Select
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
                </Select>
              </Field>
            </div>
            <Field label="Extraction instructions" error={errorAt(at("description"))}>
              <Textarea
                data-tour="field-description"
                {...diagnosticProps(at("description"))}
                value={activeField.description}
                onChange={(event) => updateField(activeFieldIndex, "description", event.target.value)}
                placeholder="e.g. The invoice number printed near the top"
              />
            </Field>

            <p className="studio-field-id">
              Field ID <code>{activeField.id || "Generated from the field name"}</code>
            </p>
            {isObjectLikeType(activeField.data_type) ? (
              <div className="object-schema-launch">
                <div>
                  <strong>Table columns</strong>
                  <p>
                    {objectColumns.length
                      ? `${objectColumns.length} column${objectColumns.length === 1 ? "" : "s"} defined`
                      : "No columns yet."}
                  </p>
                  {errorAt(at("object_schema")) ? (
                    <p id={`object-schema-error-${activeFieldIndex}`} className="ui-field-error">
                      {errorAt(at("object_schema"))}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  data-tour="schema-open"
                  {...diagnosticProps(at("object_schema"))}
                  aria-describedby={errorAt(at("object_schema")) ? `object-schema-error-${activeFieldIndex}` : undefined}
                  aria-invalid={errorAt(at("object_schema")) ? true : undefined}
                  onClick={() => setSchemaEditorFieldIndex(activeFieldIndex)}
                >
                  Edit columns
                </Button>
              </div>
            ) : null}
          </ScrollArea>
        ) : (
          <div className="field-detail">
            <p className="muted">No fields yet. Add at least one.</p>
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
  // Column problems stay hidden until Done or a template save reports them, so a new column starts clean.
  const [showErrors, setShowErrors] = useState(focusRequest?.issue?.location?.scope === "column");
  const at = (columnIndex, property) => `column:${fieldIndex}:${columnIndex}:${property}`;
  // The row already says which column it is, so each cell shows only what to do.
  const errorAt = (key) => (showErrors ? issueRemedy(grouped.byKey.get(key)) : undefined);
  const columnIssues = (grouped.byField.get(fieldIndex) || []).filter((issue) => issue.location.scope === "column");

  const focusIssue = (location) =>
    setTimeout(() => focusDiagnostic(headRef.current?.closest(".modal-card"), location), 0);

  useEffect(() => {
    if (focusRequest?.issue?.location?.scope !== "column") return;
    setShowErrors(true);
    const timer = focusIssue(focusRequest.issue.location);

    return () => clearTimeout(timer);
  }, [focusRequest]);

  function done() {
    if (!columnIssues.length) {
      onClose();

      return;
    }

    setShowErrors(true);
    focusIssue(columnIssues[0].location);
  }

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
            <p className="eyebrow">{fieldName || "New field"}</p>
            <h2 id="object-schema-modal-title">Table columns</h2>
          </div>
          <div className="actions compact object-schema-modal-head-actions">
            <Button
              onClick={onAddColumn}
              disabled={disabled || columns.length >= MAX_TEMPLATE_OBJECT_COLUMNS}
              title={`Maximum ${MAX_TEMPLATE_OBJECT_COLUMNS} columns`}
            >
              Add column
            </Button>
            <IconButton
              label="Close columns editor"
              icon={CloseIcon}
              data-tour="schema-close"
              onClick={onClose}
            />
          </div>
        </div>

        <ScrollArea
          className="object-schema-table-wrap"
          role="region"
          aria-label="Table columns"
          tabIndex={0}
        >
          <DataTable className="object-schema-table" label="Table columns">
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
                    No columns yet.
                  </td>
                </tr>
              ) : (
                columns.map((column, columnIndex) => (
                  <tr className="object-column-card" key={columnIndex}>
                    <td>
                      <span className="object-schema-row-number">Column {columnIndex + 1}</span>
                    </td>
                    <td>
                      <Field label="Column name" labelHidden error={errorAt(at(columnIndex, "heading"))}>
                        <TextInput
                          disabled={disabled}
                          data-diagnostic-location={at(columnIndex, "heading")}
                          value={column.heading}
                          onChange={(event) => onUpdateColumn(columnIndex, "heading", event.target.value)}
                          placeholder="e.g. Line total"
                        />
                      </Field>
                    </td>
                    <td>
                      <Field label="Type" labelHidden error={errorAt(at(columnIndex, "data_type"))}>
                        <Select
                          disabled={disabled}
                          data-diagnostic-location={at(columnIndex, "data_type")}
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
                        </Select>
                      </Field>
                    </td>
                    <td>
                      <Field label="Column description" labelHidden error={errorAt(at(columnIndex, "description"))}>
                        <TextInput
                          disabled={disabled}
                          data-diagnostic-location={at(columnIndex, "description")}
                          value={column.description}
                          onChange={(event) => onUpdateColumn(columnIndex, "description", event.target.value)}
                          placeholder="e.g. Price for this line"
                        />
                      </Field>
                    </td>
                    <td>
                      <div className="object-schema-row-actions">
                        <IconButton
                          label={`Move column ${columnIndex + 1} up`}
                          icon={ArrowUpIcon}
                          size="sm"
                          disabled={disabled || columnIndex === 0}
                          onClick={() => onMoveColumn(columnIndex, -1)}
                        />
                        <IconButton
                          label={`Move column ${columnIndex + 1} down`}
                          icon={ArrowDownIcon}
                          size="sm"
                          disabled={disabled || columnIndex === columns.length - 1}
                          onClick={() => onMoveColumn(columnIndex, 1)}
                        />
                        <Button
                          variant="danger"
                          size="sm"
                          aria-label={`Remove column ${columnIndex + 1}`}
                          disabled={disabled}
                          onClick={() => onRemoveColumn(columnIndex)}
                        >
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </ScrollArea>

        <div className="object-schema-modal-footer">
          <Button data-tour="schema-done" onClick={done}>
            Done
          </Button>
          {showErrors && columnIssues.length ? (
            <p className="object-schema-modal-problems" role="alert">
              Fix {columnIssues.length} {columnIssues.length === 1 ? "problem" : "problems"} to finish.
            </p>
          ) : null}
        </div>
    </ModalDialog>
  );
}
