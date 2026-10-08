import { describe, expect, it } from "bun:test";
import { parseJson, type JsonValue } from "../../../shared/json";
import {
  EVALUATION_EVIDENCE_LIMITS,
  EvaluationEvidenceError,
  buildEvaluationEvidence,
  evaluationFieldIds,
  validateEvaluationEvidence,
  type EvaluationDocumentEvidence,
  type EvaluationEvidence,
  type EvaluationFailure,
} from "../../../shared/evaluationEvidence";
import { validateAssistantOutput } from "../../../shared/templateAssistant";
import { assistanceContext, assistanceSystemPrompt } from "../consumer/templateAssistance";

const candidate = {
  label: "Candidate 1: Invoice · v3",
  model: "gpt-test",
  template_name: "Invoice",
  template_id: "template_a",
  template_version: 3,
  modified: false,
};

const failure = (fieldId = "total", extracted: string | number | null = 10, expected: string | number = 12): EvaluationFailure => ({
  field_id: fieldId,
  field_name: fieldId === "total" ? "Total" : fieldId,
  data_type: "number",
  verdict: "Mismatch",
  expected_verified: true,
  extracted_status: "ok",
  extracted,
  expected,
  expected_absent: false,
  cells: null,
});

const tableFailure = (): EvaluationFailure => ({
  field_id: "lines",
  field_name: "Lines",
  data_type: "array<object>",
  verdict: "Mismatch",
  expected_verified: true,
  extracted_status: "ok",
  extracted: null,
  expected: null,
  expected_absent: false,
  cells: {
    matched: 3,
    total: 4,
    mismatches: [{ row: 2, column: "Amount", expected: 5, expected_absent: false, extracted: 6 }],
    omitted_mismatches: 0,
    missing_rows: [],
    extra_rows: [3],
  },
});

const documentWith = (name: string, failures: EvaluationFailure[]): EvaluationDocumentEvidence => ({
  name,
  accuracy: { matched: 1, total: 1 + failures.length },
  failures,
});

const evidence = (documents = [documentWith("invoice.pdf", [failure(), tableFailure()])]) =>
  buildEvaluationEvidence(candidate, { matched: 1, total: 3 }, documents);

// Round-trips through JSON, as the request body does.
const wire = (value: EvaluationEvidence): JsonValue => parseJson(JSON.stringify(value));

const rejects = (value: JsonValue, message: RegExp) => {
  expect(() => validateEvaluationEvidence(value)).toThrow(EvaluationEvidenceError);
  expect(() => validateEvaluationEvidence(value)).toThrow(message);
};

describe("evaluation evidence validation", () => {
  it("accepts failing fields with verified expected answers and table cell mismatches", () => {
    const valid = validateEvaluationEvidence(wire(evidence()));
    expect(valid.documents[0]!.failures.map((item) => item.field_id)).toEqual(["total", "lines"]);
    expect(valid.documents[0]!.failures[1]!.cells?.mismatches).toHaveLength(1);
    expect(evaluationFieldIds(valid)).toEqual(["total", "lines"]);
  });

  it("rejects unverified answers, passing fields and unknown properties", () => {
    const base = wire(evidence());

    const edit = (change: (value: any) => void) => {
      const copy = structuredClone(base);
      change(copy);

      return copy;
    };

    rejects(edit((value) => (value.documents[0].failures[0].expected_verified = false)), /Only verified expected answers/);
    rejects(edit((value) => delete value.documents[0].failures[0].expected_verified), /expected_verified is required/);
    rejects(edit((value) => (value.documents[0].failures[0].verdict = "Match")), /send only failing fields/);
    rejects(edit((value) => (value.documents[0].failures[0].confidence = 0.4)), /unsupported property “confidence”/);
    rejects(edit((value) => (value.extra = true)), /unsupported property “extra”/);
    rejects(edit((value) => (value.documents[0].failures[0].data_type = "object")), /scored field type/);
    rejects(edit((value) => (value.documents[0].failures[1].cells = null)), /failure.cells must be an object/);
    rejects(edit((value) => (value.documents[0].failures[0].cells = value.documents[0].failures[1].cells)), /carry values only/);
    rejects(edit((value) => (value.documents[0].failures[0].expected_absent = true)), /absent expected answer has no value/);
    rejects(edit((value) => (value.documents[0].failures[1] = value.documents[0].failures[0])), /appears once per evaluation document/);
    rejects(edit((value) => (value.documents = [])), /1 to 50 documents/);
    rejects(edit((value) => (value.documents[0].failures = [])), /1 to 100 failing fields/);
    rejects(edit((value) => (value.accuracy = { matched: 4, total: 3 })), /cannot exceed/);
    rejects(edit((value) => (value.candidate.template_version = 0)), /whole number/);
    rejects(edit((value) => (value.documents[0].failures[0].field_id = "../total")), /field identity/);
    rejects(edit((value) => (value.documents[0].failures[0].extracted = { nested: true })), /at most 1000 characters/);
  });

  it("rejects evidence over the 128 KiB budget instead of truncating it on the server", () => {
    // Built by hand: the builder would truncate it to fit.
    const big: EvaluationEvidence = {
      ...evidence(),
      documents: Array.from({ length: 40 }, (_, index) => ({
        name: `invoice-${index}.pdf`,
        accuracy: { matched: 0, total: 100 },
        failures: Array.from({ length: 100 }, (_, field) => failure(`field_${field}`, "x".repeat(10), "y".repeat(10))),
      })),
    };

    rejects(wire(big), /exceeds the 128 KiB/);
  });
});

describe("evaluation evidence budget", () => {
  it("caps long values and keeps the opening text", () => {
    const built = evidence([documentWith("long.pdf", [failure("total", "a".repeat(5_000), "b".repeat(5_000))])]);
    const [kept] = built.documents[0]!.failures;
    expect(String(kept!.extracted)).toHaveLength(EVALUATION_EVIDENCE_LIMITS.valueCharacters);
    expect(String(kept!.extracted).endsWith("…")).toBe(true);
    expect(validateEvaluationEvidence(wire(built)).documents).toHaveLength(1);
  });

  it("drops failures from the end deterministically until the evidence fits", () => {
    const documents = Array.from({ length: 30 }, (_, index) =>
      documentWith(
        `invoice-${String(index).padStart(2, "0")}.pdf`,
        Array.from({ length: 20 }, (_, field) => failure(`field_${field}`, "x".repeat(900), "y".repeat(900))),
      ),
    );

    const first = evidence(documents);
    const second = evidence(structuredClone(documents));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBeLessThanOrEqual(
      EVALUATION_EVIDENCE_LIMITS.bytes,
    );
    // The earliest documents survive whole; later failures are counted as omitted.
    expect(first.documents[0]!.name).toBe("invoice-00.pdf");
    expect(first.documents[0]!.failures).toHaveLength(20);
    const kept = first.documents.reduce((sum, document) => sum + document.failures.length, 0);
    expect(kept + first.omitted.failures).toBe(600);
    expect(first.omitted.failures).toBeGreaterThan(0);
    expect(validateEvaluationEvidence(wire(first)).omitted).toEqual(first.omitted);
  });

  it("limits documents, failures per document and table cells", () => {
    const manyCells = tableFailure();
    manyCells.cells!.mismatches = Array.from({ length: 90 }, (_, index) => ({
      row: index + 1,
      column: "Amount",
      expected: index,
      expected_absent: false,
      extracted: index + 1,
    }));

    const documents = Array.from({ length: 60 }, (_, index) => documentWith(`d${index}`, [failure()]));
    documents[0] = documentWith("cells", [manyCells, ...Array.from({ length: 120 }, (_, i) => failure(`f_${i}`))]);
    const built = evidence(documents);
    expect(built.documents).toHaveLength(50);
    expect(built.omitted.documents).toBe(10);
    expect(built.documents[0]!.failures).toHaveLength(100);
    expect(built.documents[0]!.failures[0]!.cells?.mismatches).toHaveLength(40);
    expect(built.documents[0]!.failures[0]!.cells?.omitted_mismatches).toBe(50);
    expect(built.omitted.failures).toBe(10 + 21);
    expect(() => validateEvaluationEvidence(wire(built))).not.toThrow();
  });

  it("leaves out documents without failing fields", () => {
    const built = evidence([documentWith("passes.pdf", []), documentWith("fails.pdf", [failure()])]);
    expect(built.documents.map((document) => document.name)).toEqual(["fails.pdf"]);
  });
});

describe("evaluation evidence prompt and references", () => {
  it("adds ground-truth rules only with evaluation evidence and keeps the job evidence rule", () => {
    const plain = assistanceSystemPrompt(false);
    const withEvaluation = assistanceSystemPrompt(true);
    expect(plain).not.toContain("evaluationEvidence");
    expect(plain).toContain("An Extraction result is model output, NOT ground truth.");
    expect(withEvaluation).toContain("An Extraction result is model output, NOT ground truth.");
    expect(withEvaluation).toContain("treat each verified Expected answer as ground truth for its document");
    expect(withEvaluation).toContain('{scope:"evaluation",fieldId}');
  });

  it("sends evaluation evidence under its own context key", () => {
    const draft = { name: "Invoice", description: "", fields: [{ name: "Total", description: "Total", data_type: "number" }] };
    const value = validateEvaluationEvidence(wire(evidence()));
    expect(JSON.parse(assistanceContext({ draft, evidence: null })).evaluationEvidence).toBeUndefined();
    const context = JSON.parse(assistanceContext({ draft, evidence: null, evaluation: value }));
    expect(context.evaluationEvidence.documents[0].failures[0]).toMatchObject({ field_id: "total", expected: 12 });
    expect(context.historicalEvidence).toBeNull();
  });

  it("accepts evaluation references only for supplied failing fields", () => {
    const draft = { name: "Invoice", fields: [{ name: "Total", description: "Total", data_type: "number" }] };

    const output = (fieldId: string) => ({
      explanation: "Total misses VAT.",
      observations: [{ kind: "observation", text: "Total differs", references: [{ scope: "evaluation", fieldId }] }],
      groups: [],
    });

    expect(() => validateAssistantOutput(output("total"), draft, "explain", { evaluationFieldIds: ["total"] })).not.toThrow();
    expect(() => validateAssistantOutput(output("vat"), draft, "explain", { evaluationFieldIds: ["total"] })).toThrow(
      /supplied failing field/,
    );
    expect(() => validateAssistantOutput(output("total"), draft, "explain")).toThrow(/supplied failing field/);
  });
});
