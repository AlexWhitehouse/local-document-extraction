import React from "react";
import { documentFields, LINE_ITEMS } from "./sampleData.js";
import { Confidence, PageHeading, SectionHeading, Status } from "./PrototypeShared.jsx";

export function DocumentVariations({ document, onUpload, onDelete, onExport, selectedCount, workspaceName }) {
  const fields = document ? documentFields(document) : [];
  const hasTarget = selectedCount > 0 || Boolean(document);
  return <div className="lp-document lp-C1">
    <PageHeading
      eyebrow={workspaceName ? `${workspaceName} / Documents` : "Documents"}
      title={document?.source_name || "Documents"}
      description={document ? "Supplier invoice · 2 pages · Extracted 03 Sep 2026, 09:42" : "Upload a document to see its extraction results."}
    >
      <button className="danger" disabled={!hasTarget} onClick={onDelete}>{selectedCount ? `Delete ${selectedCount}` : "Delete"}</button>
      <button className="secondary" onClick={onUpload}>Upload</button>
      <button disabled={!hasTarget} onClick={onExport}>{selectedCount ? `Export ${selectedCount}` : "Export"}</button>
    </PageHeading>
    {document ? <>
      <div className="lp-document-summary">
        <Status>Completed</Status>
        <span><strong>{fields.length}</strong> fields extracted</span>
        <span><strong>97.6%</strong> average confidence</span>
        <code>{document.job_id}</code>
      </div>
      <div className="lp-table-scroll lp-results-scroll">
        <table className="lp-table lp-results-table">
          <thead><tr><th>Field</th><th>Extracted value</th><th>Confidence</th><th>Evidence</th></tr></thead>
          <tbody>{fields.filter(field => field.id !== "line_items").map(field => <tr key={field.id}>
            <td className="lp-result-field-name">{field.name}</td>
            <td className="lp-extracted-value">{field.value}</td>
            <td><Confidence value={field.confidence} /></td>
            <td className="lp-evidence-text">{field.evidence}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <section className="lp-line-item-section">
        <SectionHeading title="Line items" description="Structured rows from the source document."><Confidence value={98.7} /></SectionHeading>
        <LineItems amount={document.amount} />
      </section>
    </> : <p className="lp-muted">No documents in this preview. Upload a sample document to get started.</p>}
  </div>;
}

function LineItems({ amount }) {
  // Keep the fictional line items consistent when another sample invoice is selected.
  const total = Number(amount.replaceAll(",", ""));
  const rows = total === 3420 ? LINE_ITEMS : [{ description: "Professional services", quantity: 1, rate: (total / 1.2).toFixed(2), amount: (total / 1.2).toFixed(2) }];
  return <div className="lp-line-items"><div className="lp-table-scroll"><table className="lp-table">
    <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.description}><td>{row.description}</td><td>{row.quantity}</td><td>{row.rate}</td><td>{row.amount}</td></tr>)}</tbody>
  </table></div></div>;
}
