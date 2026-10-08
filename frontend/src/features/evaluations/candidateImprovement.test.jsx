import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvaluationsPage } from "./EvaluationsPage.jsx";
import {
  accuracyVerdict,
  collectEvaluationEvidence,
  compareCandidates,
  documentFailures,
  improvementRequest,
  scoreResult,
} from "./candidateImprovement.js";

afterEach(cleanup);

const fields = [
  { id: "total", name: "Total", description: "Total due", data_type: "number" },
  { id: "vat", name: "VAT", description: "VAT amount", data_type: "number" },
  { id: "supplier", name: "Supplier", description: "Supplier name", data_type: "string" },
];

const template = { name: "Invoice", description: "", fields };

// Total is verified and wrong, VAT is wrong but unverified, Supplier is verified and right.
const reference = () => ({
  definitions: {},
  references: {
    "total:number": { verified: true, value: 12 },
    "vat:number": { verified: false, value: 2 },
    "supplier:string": { verified: true, value: "Acme" },
  },
});

const raw = (total) => [
  { field_id: "total", status: "ok", answer: total },
  { field_id: "vat", status: "ok", answer: 1 },
  { field_id: "supplier", status: "ok", answer: "Acme" },
];

const record = (id) => ({ recordId: id, revision: 0, fields, model: "m", processingMs: 1, attempts: 1 });

const documentFor = (key) => ({
  key,
  kind: "upload",
  file: new File(["%PDF"], `${key}.pdf`, { type: "application/pdf" }),
  name: `${key}.pdf`,
  reference: reference(),
  save: "idle",
  availability: "ok",
});

const pair = (id) => ({ status: "success", result: record(id), previous: null, detail: "retained" });

function evaluationWith({ documents = ["doc"], candidates = ["a"], details = {}, pairs } = {}) {
  const state = {
    id: "evaluation",
    mode: "templates",
    setup: { configured: true, model: "m" },
    library: { save_available: true },
    libraryVersion: 0,
    documents: documents.map(documentFor),
    candidates: candidates.map((id) => ({ id, revision: 0, model: "m", pdf: false, structured: false, template })),
    pairs: pairs || Object.fromEntries(documents.map((key) => [key, { a: pair(`${key}-a`) }])),
    alignments: {},
    columns: {},
  };

  const cache = {
    "doc-a": { raw: raw(10) },
    "doc2-a": { raw: raw(10) },
    ...details,
  };

  return {
    state,
    detail: vi.fn((id) => (id === "doc-a" ? cache[id] : null)),
    readDetail: vi.fn(async (id) => cache[id]),
    library: { source: vi.fn() },
  };
}

describe("evaluation evidence from candidate results", () => {
  it("sends only failing fields that have a verified expected answer", () => {
    const evaluation = evaluationWith();
    const document = evaluation.state.documents[0];
    const result = { ...record("doc-a"), raw: raw(10) };
    const failures = documentFailures(document, result, scoreResult(evaluation.state, document, "a", result));
    expect(failures).toEqual([
      expect.objectContaining({ field_id: "total", extracted: 10, expected: 12, expected_verified: true, verdict: "Mismatch" }),
    ]);
  });

  it("collects failures across documents, reading details that aren't on screen", async () => {
    const evaluation = evaluationWith({ documents: ["doc", "doc2"] });
    const candidate = evaluation.state.candidates[0];
    const collected = await collectEvaluationEvidence(evaluation, candidate, "Candidate 1: Invoice", "doc2");
    expect(evaluation.readDetail).toHaveBeenCalledWith("doc2-a");
    expect(collected.fieldNames).toEqual(["Total"]);
    expect(collected.evidence.accuracy).toEqual({ matched: 2, total: 4 });
    expect(collected.evidence.documents.map((document) => document.name)).toEqual(["doc.pdf", "doc2.pdf"]);
    expect(collected.sample.name).toBe("doc2.pdf");
    expect(await collected.sample.load()).toBe(evaluation.state.documents[1].file);
    expect(improvementRequest(collected.fieldNames)).toBe(
      "Improve the instructions for “Total” so the extracted values match the verified expected answers.",
    );
  });

  it("returns nothing when no verified field fails", async () => {
    const evaluation = evaluationWith({ details: { "doc-a": { raw: raw(12) } } });
    evaluation.detail.mockImplementation(() => null);
    expect(await collectEvaluationEvidence(evaluation, evaluation.state.candidates[0], "Candidate 1", "doc")).toBeNull();
  });
});

describe("before and after accuracy", () => {
  it("flags improved, regressed and unchanged accuracy", () => {
    expect(accuracyVerdict({ matched: 1, total: 2 }, { matched: 2, total: 2 })).toBe("improved");
    expect(accuracyVerdict({ matched: 2, total: 2 }, { matched: 1, total: 2 })).toBe("regressed");
    expect(accuracyVerdict({ matched: 1, total: 2 }, { matched: 2, total: 4 })).toBe("unchanged");
    expect(accuracyVerdict({ matched: 0, total: 0 }, { matched: 1, total: 1 })).toBe("unscored");
  });

  it("compares the original with its copy on the documents both ran", async () => {
    const evaluation = evaluationWith({
      candidates: ["a", "b"],
      details: { "doc-b": { raw: raw(12) } },
      pairs: { doc: { a: pair("doc-a"), b: pair("doc-b") } },
    });

    const comparison = await compareCandidates(evaluation, "a", "b", ["doc"]);
    expect(comparison.documents).toBe(1);
    expect(comparison.overall).toEqual({
      before: { matched: 1, total: 2 },
      after: { matched: 2, total: 2 },
      verdict: "improved",
    });
    expect(comparison.fields).toEqual([
      { name: "Total", before: { matched: 0, total: 1 }, after: { matched: 1, total: 1 }, verdict: "improved" },
      { name: "Supplier", before: { matched: 1, total: 1 }, after: { matched: 1, total: 1 }, verdict: "unchanged" },
    ]);
  });
});

describe("Improve failing fields and Test changes", () => {
  const groups = [
    {
      id: "total",
      title: "Include VAT in Total",
      rationale: "The verified total includes VAT.",
      dependsOn: [],
      operations: [
        { op: "update_field", fieldIndex: 0, expectName: "Total", set: { description: "Total due including VAT" } },
      ],
    },
  ];

  function setup() {
    const base = evaluationWith();

    const evaluation = {
      ...base,
      patch: vi.fn(),
      edit: vi.fn(),
      run: vi.fn(),
      clear: vi.fn(),
      duplicate: vi.fn(),
      remove: vi.fn(async () => () => {}),
      branch: vi.fn(() => "b"),
      hydrate: vi.fn(),
      setColumns: vi.fn(),
      setReference: vi.fn(),
      api: vi.fn(async (path, options) => {
        if (path === "/templates/assist") {
          const payload = JSON.parse(options.body.get("payload"));

          return Response.json({
            base: payload.base,
            evidence: { job: null, source: "no_binary_source_supplied", evaluation: { failures: 1 } },
            explanation: "Total misses VAT.",
            observations: [],
            groups,
          });
        }

        return Response.json({ source: "model", suggestions: [] });
      }),
    };

    const page = (next) => (
      <EvaluationsPage evaluation={next} templates={[]} enabled maxSourceFileBytes={1000} toast={{ success: vi.fn(), error: vi.fn() }} />
    );

    const view = render(page(evaluation));

    return { evaluation, rerender: (state) => view.rerender(page({ ...evaluation, state: { ...evaluation.state, ...state } })) };
  }

  it("opens the assistant with the failing fields, then tests the edits on a copy and compares accuracy", async () => {
    const { evaluation, rerender } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Candidate 1 options" }));
    fireEvent.click(screen.getByRole("button", { name: "Improve failing fields" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit template" });
    const assistant = await within(dialog).findByRole("complementary", { name: "Template assistant" });
    expect(within(assistant).getByRole("textbox").value).toContain("“Total”");
    expect(within(assistant).getByText(/1 failing field in 1 document/)).toBeTruthy();

    fireEvent.click(within(assistant).getByRole("button", { name: "Propose edits" }));
    fireEvent.click(await within(assistant).findByRole("button", { name: "Apply 1 change to draft" }));
    const sent = JSON.parse(evaluation.api.mock.calls.find(([path]) => path === "/templates/assist")[1].body.get("payload"));
    expect(sent.evaluation.documents[0].failures.map((failure) => failure.field_id)).toEqual(["total"]);
    expect(sent.evaluation.candidate.label).toBe("Candidate 1: Invoice");

    fireEvent.click(await within(assistant).findByRole("button", { name: "Test changes" }));
    await waitFor(() => expect(evaluation.branch).toHaveBeenCalled());
    expect(evaluation.branch.mock.calls[0][0]).toBe("a");
    expect(evaluation.branch.mock.calls[0][1].fields[0].description).toBe("Total due including VAT");
    expect(evaluation.edit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit template" })).toBeNull());

    const copy = { ...evaluation.state.candidates[0], id: "b", template: evaluation.branch.mock.calls[0][1] };
    const candidates = [...evaluation.state.candidates, copy];
    rerender({ candidates });
    await waitFor(() => expect(evaluation.run).toHaveBeenCalledWith(["b"], ["doc"]));
    expect(screen.getByRole("region", { name: "Test changes" })).toBeTruthy();

    evaluation.readDetail.mockImplementation(async (id) => (id === "doc-b" ? { raw: raw(12) } : { raw: raw(10) }));
    await act(async () => rerender({ candidates, pairs: { doc: { a: pair("doc-a"), b: pair("doc-b") } } }));
    const trial = screen.getByRole("region", { name: "Test changes" });
    await waitFor(() => expect(within(trial).getAllByText("Improved").length).toBeGreaterThan(0));
    expect(within(trial).getByText(/50% \(1\/2\) → 100% \(2\/2\)/)).toBeTruthy();

    fireEvent.click(within(trial).getByRole("button", { name: "Remove copy" }));
    await waitFor(() => expect(evaluation.remove).toHaveBeenCalledWith("b"));
    // A full journey through the editor, the assistant and the comparison; allow for slow runners.
  }, 20_000);

  it("hides Improve failing fields when every verified field matches", () => {
    const passing = evaluationWith({ details: { "doc-a": { raw: raw(12) } } });
    passing.detail.mockImplementation((id) => (id === "doc-a" ? { raw: raw(12) } : null));
    render(
      <EvaluationsPage
        evaluation={{ ...passing, hydrate: vi.fn(), run: vi.fn(), patch: vi.fn(), edit: vi.fn() }}
        templates={[]}
        enabled
        maxSourceFileBytes={1000}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Candidate 1 options" }));
    expect(screen.queryByRole("button", { name: "Improve failing fields" })).toBeNull();
  });
});
