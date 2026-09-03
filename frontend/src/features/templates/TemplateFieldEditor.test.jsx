import React, { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { TemplateFieldEditor } from "./TemplateFieldEditor.jsx";

describe("Template field editor", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps Template field editing focused on field configuration", async () => {
    const user = userEvent.setup();

    function TemplateFieldHarness() {
      const [fields, setFields] = useState([
        {
          id: "patient_name",
          name: "Patient Name",
          description: "Full name of the patient",
          data_type: "string",
        },
      ]);

      return (
        <TemplateFieldEditor
          fields={fields}
          onChange={setFields}
          title="Field Designer"
          subtitle="Edit Template fields."
        />
      );
    }

    render(<TemplateFieldHarness />);

    expect(screen.queryByText(/^Total Field Limit /)).toBeNull();
    expect(screen.queryByText(/^Table Field Limit /)).toBeNull();

    await user.selectOptions(screen.getByLabelText("Type"), "array<object>");
    expect(
      screen.queryByRole("dialog", { name: "Object Schema Builder" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Edit Schema" }));
    expect(screen.getByRole("table", { name: "Object schema columns" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add Column" }));
    expect(screen.queryByText(/^Table Field Limit /)).toBeNull();
  });

  it("edits object-like Template field columns through the public field change interface", async () => {
    const user = userEvent.setup();
    let latestFields = [];

    function TemplateFieldHarness() {
      const [fields, setFields] = useState([
        {
          id: "prescription_lines",
          name: "Prescription Lines",
          description: "Medication rows from the prescription",
          data_type: "string",
        },
      ]);
      latestFields = fields;

      return (
        <TemplateFieldEditor
          fields={fields}
          onChange={setFields}
          title="Field Designer"
          subtitle="Edit Template fields."
        />
      );
    }

    render(<TemplateFieldHarness />);

    await user.selectOptions(screen.getByLabelText("Type"), "array<object>");
    await user.click(screen.getByRole("button", { name: "Edit Schema" }));
    await user.click(screen.getByRole("button", { name: "Add Column" }));

    const columnCard = screen.getByText("Column 1").closest(".object-column-card");
    await user.type(within(columnCard).getByLabelText("Column Name"), "Dose #1");
    await user.selectOptions(within(columnCard).getByLabelText("Type"), "number");
    await user.type(
      within(columnCard).getByLabelText("Column Description"),
      "Dose amount",
    );

    expect(latestFields[0]).toMatchObject({
      data_type: "array<object>",
      object_schema: {
        mode: "table",
        columns: [
          {
            heading: "Dose 1",
            key: "dose_1",
            data_type: "number",
            description: "Dose amount",
          },
        ],
      },
    });
    expect(within(columnCard).getByLabelText("Column ID").value).toBe("dose_1");
  });

  it("does not offer a twenty-first object column", async () => {
    const user = userEvent.setup();

    render(
      <TemplateFieldEditor
        fields={[
          {
            id: "line_items",
            name: "Line Items",
            description: "Invoice line items",
            data_type: "array<object>",
            object_schema: {
              mode: "table",
              columns: Array.from({ length: 20 }, (_, index) => ({
                key: `column_${index + 1}`,
                heading: `Column ${index + 1}`,
                data_type: "string",
                description: `Column ${index + 1} value`,
              })),
            },
          },
        ]}
        onChange={() => {}}
        title="Field Designer"
        subtitle="Edit Template fields."
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit Schema" }));
    expect(screen.getByRole("button", { name: "Add Column" }).disabled).toBe(true);
  });

  it("closes the schema table with Done while retaining draft edits", async () => {
    const user = userEvent.setup();
    let latestFields = [];

    function TemplateFieldHarness() {
      const [fields, setFields] = useState([
        {
          id: "line_items",
          name: "Line Items",
          description: "Invoice line items",
          data_type: "array<object>",
          object_schema: {
            mode: "table",
            columns: [],
          },
        },
      ]);
      latestFields = fields;

      return (
        <TemplateFieldEditor
          fields={fields}
          onChange={setFields}
          title="Field Designer"
          subtitle="Edit Template fields."
        />
      );
    }

    render(<TemplateFieldHarness />);

    await user.click(screen.getByRole("button", { name: "Edit Schema" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add Column" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Done" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add Column" }));
    await user.click(screen.getByRole("button", { name: "Add Column" }));
    await user.type(screen.getByLabelText("Column Name"), "Quantity");
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(
      screen.queryByRole("dialog", { name: "Object Schema Builder" }),
    ).toBeNull();
    expect(screen.getByText("1 column defined")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Schema" }));
    expect(latestFields[0].object_schema.columns[0]).toMatchObject({
      heading: "Quantity",
      key: "quantity",
    });
  });
});
