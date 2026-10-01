import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ReferenceModal } from "./ReferenceModal.jsx";

const date = { name: "Date of birth", data_type: "date" };
const table = { name: "Items", data_type: "array<object>", object_schema: { mode: "table", columns: [
  { key: "sku", heading: "SKU", data_type: "string" },
  { key: "qty", heading: "Quantity", data_type: "number" },
] } };
const verify = () => fireEvent.click(screen.getByRole("button", { name: "Use as expected answer" }));

it("verifies the screenshot's date using the visible day/month date format", () => {
  const onSave = vi.fn();
  render(<ReferenceModal row={{ field: date }} initial={{ value: "" }} onSave={onSave} onClose={() => {}} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Expected value" }), { target: { value: "08/09/1871" } });
  expect(screen.getByRole("combobox", { name: "Date format" }).value).toBe("dmy");
  expect(screen.getByText("Interpreted as 8 September 1871")).toBeTruthy();
  verify();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ verified: true, value: "1871-09-08" }));
});

it("supports explicit month-first entry without changing how ISO dates are read", () => {
  const onSave = vi.fn();
  render(<ReferenceModal row={{ field: date }} initial={{ value: "08/09/1871" }} onSave={onSave} onClose={() => {}} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Date format" }), { target: { value: "mdy" } });
  expect(screen.getByText("Interpreted as 9 August 1871")).toBeTruthy();
  verify();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ value: "1871-08-09" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Expected value" }), { target: { value: "1871-09-08" } });
  verify();
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ value: "1871-09-08" }));
});

it("uses the selected format consistently and still rejects impossible dates", () => {
  const onSave = vi.fn();
  render(<ReferenceModal row={{ field: date }} initial={{ value: "09/27/2026" }} onSave={onSave} onClose={() => {}} />);
  verify();
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "Date format" }), { target: { value: "mdy" } });
  verify();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ value: "2026-09-27" }));
  onSave.mockClear();
  fireEvent.change(screen.getByRole("textbox", { name: "Expected value" }), { target: { value: "02/30/2026" } });
  verify();
  expect(onSave).not.toHaveBeenCalled();
});

it("attaches actionable validation to the date input and clears it when corrected", () => {
  render(<ReferenceModal row={{ field: date }} initial={{ value: "2026-02-30" }} onSave={vi.fn()} onClose={() => {}} />);
  verify();
  const input = screen.getByRole("textbox", { name: "Expected value" });
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toMatch(/date/i);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby").split(" ")).toContain(alert.id);
  fireEvent.change(input, { target: { value: "2026-02-28" } });
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each(["absent", "ignored"])("lets one table cell be %s while other cells stay verified", state => {
  const onSave = vi.fn();
  render(<ReferenceModal row={{ field: table }} initial={{ value: [{ sku: "A", qty: "" }], rows: { mode: "position" } }} onSave={onSave} onClose={() => {}} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Expected row 1 Quantity status" }), { target: { value: state } });
  verify();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ verified: true, cellStates: [{ qty: state }] }));
});

it("keeps cell statuses attached to their rows when another row is removed", () => {
  const onSave = vi.fn();
  render(<ReferenceModal row={{ field: table }} initial={{ value: [{ sku: "A", qty: 1 }, { sku: "B", qty: "" }], cellStates: [{}, { qty: "ignored" }], rows: { mode: "position" } }} onSave={onSave} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove row 1" }));
  expect(screen.getByRole("combobox", { name: "Expected row 1 Quantity status" }).value).toBe("ignored");
  fireEvent.click(screen.getByRole("button", { name: "Add row" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Expected row 2 SKU" }), { target: { value: "C" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Expected row 2 Quantity status" }), { target: { value: "absent" } });
  verify();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ value: [{ sku: "B", qty: "" }, { sku: "C", qty: "" }], cellStates: [{ qty: "ignored" }, { qty: "absent" }] }));
});

it("selects the failing table row and shows its error beside the invalid cell", () => {
  const onSave = vi.fn();
  render(<ReferenceModal row={{ field: table }} initial={{ value: [{ sku: "A", qty: 1 }, { sku: "B", qty: "wrong" }], rows: { mode: "position" } }} onSave={onSave} onClose={() => {}} />);
  verify();
  expect(screen.getByRole("alert").textContent).toMatch(/Row 2 · Quantity: Enter a valid number/);
  expect(screen.getByRole("textbox", { name: "Expected row 2 Quantity" }).getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByRole("button", { name: "Select row 2" }).getAttribute("aria-pressed")).toBe("true");
  expect(onSave).not.toHaveBeenCalled();
});

it("normalizes expected dates inside table cells", () => {
  const field = { ...table, object_schema: { mode: "table", columns: [{ key: "date", heading: "Date", data_type: "date" }] } };
  const onSave = vi.fn();
  render(<ReferenceModal row={{ field }} initial={{ value: [{ date: "08/09/1871" }], rows: { mode: "position" } }} onSave={onSave} onClose={() => {}} />);
  verify();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ value: [{ date: "1871-09-08" }] }));
});
