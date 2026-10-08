import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ReferenceModal } from "./ReferenceModal.jsx";

// Field errors are linked through aria-describedby rather than announced with role="alert".
const described = (element) =>
  (element.getAttribute("aria-describedby") || "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent || "")
    .join(" ");

const date = { name: "Date of birth", data_type: "date" };

const table = {
  name: "Items",
  data_type: "array<object>",
  object_schema: {
    mode: "table",
    columns: [
      { key: "sku", heading: "SKU", data_type: "string" },
      { key: "qty", heading: "Quantity", data_type: "number" },
    ],
  },
};

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
  render(
    <ReferenceModal row={{ field: date }} initial={{ value: "2026-02-30" }} onSave={vi.fn()} onClose={() => {}} />,
  );
  verify();
  const input = screen.getByRole("textbox", { name: "Expected value" });
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(described(input)).toMatch(/date/i);
  fireEvent.change(input, { target: { value: "2026-02-28" } });
  expect(input.getAttribute("aria-invalid")).toBeNull();
  expect(described(input)).toBe("");
});

it.each(["absent", "ignored"])("lets one table cell be %s while other cells stay verified", (state) => {
  const onSave = vi.fn();
  render(
    <ReferenceModal
      row={{ field: table }}
      initial={{ value: [{ sku: "A", qty: "" }], rows: { mode: "position" } }}
      onSave={onSave}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Expected row 1 Quantity status" }), {
    target: { value: state },
  });
  verify();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ verified: true, cellStates: [{ qty: state }] }));
});

it("keeps cell statuses attached to their rows when another row is removed", () => {
  const onSave = vi.fn();
  render(
    <ReferenceModal
      row={{ field: table }}
      initial={{
        value: [
          { sku: "A", qty: 1 },
          { sku: "B", qty: "" },
        ],
        cellStates: [{}, { qty: "ignored" }],
        rows: { mode: "position" },
      }}
      onSave={onSave}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove row 1" }));
  expect(screen.getByRole("combobox", { name: "Expected row 1 Quantity status" }).value).toBe("ignored");
  fireEvent.click(screen.getByRole("button", { name: "Add row" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Expected row 2 SKU" }), { target: { value: "C" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Expected row 2 Quantity status" }), {
    target: { value: "absent" },
  });
  verify();
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      value: [
        { sku: "B", qty: "" },
        { sku: "C", qty: "" },
      ],
      cellStates: [{ qty: "ignored" }, { qty: "absent" }],
    }),
  );
});

it("selects the failing table row and shows its error beside the invalid cell", () => {
  const onSave = vi.fn();
  render(
    <ReferenceModal
      row={{ field: table }}
      initial={{
        value: [
          { sku: "A", qty: 1 },
          { sku: "B", qty: "wrong" },
        ],
        rows: { mode: "position" },
      }}
      onSave={onSave}
      onClose={() => {}}
    />,
  );
  verify();
  const quantity = screen.getByRole("textbox", { name: "Expected row 2 Quantity" });
  expect(described(quantity)).toMatch(/Enter a valid number/);
  expect(quantity.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByRole("button", { name: "Select row 2" }).getAttribute("aria-current")).toBe("true");
  expect(onSave).not.toHaveBeenCalled();
});

it("normalizes expected dates inside table cells", () => {
  const field = {
    ...table,
    object_schema: { mode: "table", columns: [{ key: "date", heading: "Date", data_type: "date" }] },
  };

  const onSave = vi.fn();
  render(
    <ReferenceModal
      row={{ field }}
      initial={{ value: [{ date: "08/09/1871" }], rows: { mode: "position" } }}
      onSave={onSave}
      onClose={() => {}}
    />,
  );
  verify();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ value: [{ date: "1871-09-08" }] }));
});

it("shows an incompatible previous boolean value until the user chooses an answer", () => {
  const onSave = vi.fn();
  render(
    <ReferenceModal
      row={{ field: { name: "Dose", data_type: "boolean" } }}
      initial={{ value: "As required" }}
      onSave={onSave}
      onClose={() => {}}
    />,
  );
  expect(screen.getByText("Previous value: As required. Choose Yes or No.")).toBeTruthy();
  verify();
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "Expected value" }), { target: { value: "false" } });
  verify();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ value: false, verified: true }));
});

it("retains separate drafts when choosing between candidate schemas and asks before Cancel discards edits", async () => {
  const updated = {
    ...table,
    object_schema: {
      columns: [
        { key: "sku", heading: "SKU", data_type: "string" },
        { key: "active", heading: "Active", data_type: "boolean" },
      ],
    },
  };

  const initial = { verified: true, value: [{ sku: "A", qty: 2 }], rows: { mode: "key", key: "sku" } };
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <ReferenceModal
      row={{ field: table }}
      initial={initial}
      schemas={[
        { field: table, label: "Original" },
        { field: updated, label: "Updated" },
      ]}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Expected row 1 SKU" }), {
    target: { value: "Edited" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Expected answer Template" }), {
    target: { value: "1" },
  });
  expect(screen.getByRole("textbox", { name: "Expected row 1 SKU" }).value).toBe("A");
  expect(screen.queryByRole("textbox", { name: "Expected row 1 Quantity" })).toBeNull();
  expect(screen.getByText(/Added: Active/)).toBeTruthy();
  expect(screen.getByText(/Removed: Quantity/)).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Expected answer Template" }), {
    target: { value: "0" },
  });
  expect(screen.getByRole("textbox", { name: "Expected row 1 SKU" }).value).toBe("Edited");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(onSave).not.toHaveBeenCalled();
  expect(initial.value).toEqual([{ sku: "A", qty: 2 }]);
});

it("links renamed columns across remaining rows, carrying values, cell states and the row identifier", () => {
  const updated = {
    ...table,
    object_schema: {
      columns: [
        { key: "code", heading: "Product code", data_type: "string" },
        { key: "count", heading: "Count", data_type: "number" },
      ],
    },
  };

  const onSave = vi.fn();

  const initial = {
    verified: true,
    value: [
      { sku: "A", qty: 1 },
      { sku: "B", qty: "" },
    ],
    cellStates: [{}, { qty: "absent" }],
    rows: { mode: "key", key: "sku" },
  };

  render(
    <ReferenceModal
      row={{ field: table }}
      initial={initial}
      schemas={[{ field: updated, label: "Updated" }]}
      onSave={onSave}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove row 1" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Reuse previous answers for Product code" }), {
    target: { value: "sku" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Reuse previous answers for Count" }), {
    target: { value: "qty" },
  });
  expect(screen.getByRole("textbox", { name: "Expected row 1 Product code" }).value).toBe("B");
  expect(screen.getByRole("combobox", { name: "Expected row 1 Count status" }).value).toBe("absent");
  expect(screen.getByRole("combobox", { name: "Compare rows" }).value).toBe("code");
  verify();
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      verified: true,
      value: [{ code: "B", count: "" }],
      cellStates: [{ count: "absent" }],
      rows: { mode: "key", key: "code" },
    }),
  );
  expect(initial.value).toHaveLength(2);
});
