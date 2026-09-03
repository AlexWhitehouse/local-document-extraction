import React, { useState } from "react";
import { PageHeading } from "./PrototypeShared.jsx";

export function TemplateVariations({ template, onUpdate, onCreate, onDelete, notify, showJson, workspaceName }) {
  const [activeId, setActiveId] = useState(null);
  const [dirty, setDirty] = useState(false);
  const fields = template.fields;
  const selected = fields.find(field => field.id === activeId) || fields[0];
  function update(key, value) { onUpdate({ ...template, [key]: value }); setDirty(true); }
  function updateField(id, key, value) { update("fields", fields.map(field => field.id === id ? { ...field, [key]: value } : field)); }
  function addField() {
    const id = `field_${Date.now()}`;
    update("fields", [...fields, { id, name: "New field", type: "string", description: "", value: "—", confidence: 0 }]);
    setActiveId(id);
    notify("New field added to this preview.");
  }
  function removeField(id) { update("fields", fields.filter(field => field.id !== id)); }
  function moveField(id, direction) {
    const index = fields.findIndex(field => field.id === id);
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    update("fields", next);
  }
  function save() { setDirty(false); notify("Template saved in this preview."); }
  const props = { fields, selected, setActiveId, updateField, removeField, moveField, addField, dirty, onSave: save };
  return <div className="lp-template lp-B2">
    <PageHeading eyebrow={`${workspaceName} / Templates`} title={template.name} description="Define what Studio should look for in each document."><button className="secondary" onClick={onCreate}>Create Template</button><button className="danger" onClick={onDelete}>Delete Template</button></PageHeading>
    <div className="lp-template-meta"><label>Template name<input value={template.name} onChange={event => update("name", event.target.value)} /></label><label>Description<input value={template.description} onChange={event => update("description", event.target.value)} /></label></div>
    <B2 {...props} />
    <footer className="lp-editor-footer"><span>{fields.length} fields <i>·</i> {dirty ? "Unsaved preview changes" : "All changes saved"}</span><button className="lp-text-button" onClick={() => showJson(template)}>View JSON</button></footer>
  </div>;
}

function FieldInputs({ field, updateField, removeField, moveField, count, index, dirty, onSave }) {
  return <div className="lp-field-inputs"><div className="lp-two-col"><label>Field name<input value={field.name} onChange={event => updateField(field.id, "name", event.target.value)} /></label><label>Data type<select value={field.type} onChange={event => updateField(field.id, "type", event.target.value)}>{["string", "number", "date", "boolean", "array<object>"].map(type => <option key={type}>{type}</option>)}</select></label></div><label>Extraction instructions<textarea placeholder="Describe the value to extract…" value={field.description} onChange={event => updateField(field.id, "description", event.target.value)} /></label>
    {field.type === "array<object>" && <div className="lp-schema-note"><span>Object columns</span><code>description</code><code>quantity</code><code>unit_price</code><code>amount</code></div>}
    <div className="lp-form-footer"><div className="lp-action-row"><button className="lp-text-button" aria-label={`Move ${field.name} up`} disabled={index === 0} onClick={() => moveField(field.id, -1)}>↑ Move up</button><button className="lp-text-button" aria-label={`Move ${field.name} down`} disabled={index === count - 1} onClick={() => moveField(field.id, 1)}>↓ Move down</button></div><div className="lp-action-row lp-field-save-actions"><button className="lp-text-button lp-destructive" onClick={() => removeField(field.id)}>Remove field</button><button className="lp-text-button lp-save-action" disabled={!dirty} onClick={onSave}>Save changes</button></div></div></div>;
}

function B2(props) {
  const { fields, selected, setActiveId, addField } = props;
  return <section className="lp-split-editor" aria-label="Template editor"><nav className="lp-field-outline" aria-label="Template fields" tabIndex={0}>{fields.map((field, index) => <button key={field.id} aria-current={field.id === selected?.id ? "true" : undefined} onClick={() => setActiveId(field.id)}><span className="lp-row-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{field.name}</strong><small>{field.type}</small></span><span aria-hidden="true">↗</span></button>)}<button className="lp-add-outline" onClick={addField}>+ Add field</button></nav><div className="lp-field-inspector" role="region" aria-label="Selected field editor" tabIndex={0}>{selected ? <><div className="lp-inspector-heading"><span className="lp-kicker">Field {fields.findIndex(field => field.id === selected.id) + 1} of {fields.length}</span><h2>{selected.name}</h2><p>Tell the model exactly what belongs in this field.</p></div><FieldInputs {...props} field={selected} count={fields.length} index={fields.findIndex(field => field.id === selected.id)} /><div className="lp-example-value"><span className="lp-kicker">Example output</span><code>{selected.value}</code></div></> : <div><p>Add a field to begin.</p><button className="lp-text-button lp-save-action" disabled={!props.dirty} onClick={props.onSave}>Save changes</button></div>}</div></section>;
}

