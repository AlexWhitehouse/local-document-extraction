import { isBoolean, isNumber } from "../../../../shared/json.ts";
import { scalarValue, tableAnswerRows, tableSchemaChanges } from "./evaluationScoring.js";

export function draftValue(value, type) {
  if (type === "string" && (isBoolean(value) || isNumber(value))) return String(value);

  if (type === "boolean" || type === "number") {
    const parsed = scalarValue(value, type);

    if (parsed.valid) return parsed.value;
  }

  return value ?? "";
}

// Adapt a private editor draft. Verification and the shared saved answer remain explicit actions.
export function adaptReferenceDraft(reference, previous, next, keepPreviousColumns = false) {
  const draft = { ...reference, verified: false };

  if (next.data_type !== "array<object>") return { ...draft, value: draftValue(reference.value, next.data_type) };
  const records = tableAnswerRows(reference.value);

  if (!records) return { ...draft, value: "", cellStates: [{}], rows: { mode: "", key: "" } };
  const { pairs } = tableSchemaChanges(previous, next);

  return {
    ...draft,
    value: records.map((record) => {
      const values = {};

      if (keepPreviousColumns) Object.assign(values, record);

      for (const [column, old] of pairs) values[column.key] = draftValue(old && record[old.key], column.data_type);

      return values;
    }),
    cellStates: records.map((_, index) => {
      const states = {};

      if (keepPreviousColumns) Object.assign(states, reference.cellStates?.[index]);

      for (const [column, old] of pairs) {
        const state = old && reference.cellStates?.[index]?.[old.key];

        if (state) states[column.key] = state;
      }

      return states;
    }),
    rows:
      reference.rows?.mode === "key"
        ? { mode: "key", key: pairs.find(([, old]) => old?.key === reference.rows.key)?.[0].key || "" }
        : reference.rows,
  };
}
