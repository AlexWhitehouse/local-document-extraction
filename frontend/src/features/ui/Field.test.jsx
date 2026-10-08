import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { CheckboxField, Field, TextInput } from "./Field.jsx";

describe("Field", () => {
  it("labels the control and links its hint and error", () => {
    render(
      <Field label="Email" hint="We'll send the invitation here." error="Enter a valid email address.">
        <TextInput />
      </Field>,
    );

    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby").split(" ");
    expect(describedBy.map((id) => document.getElementById(id).textContent)).toEqual([
      "We'll send the invitation here.",
      "Enter a valid email address.",
    ]);
  });

  it("leaves valid controls unmarked", () => {
    render(
      <Field label="Name">
        <TextInput />
      </Field>,
    );

    expect(screen.getByLabelText("Name").hasAttribute("aria-invalid")).toBe(false);
  });
});

describe("CheckboxField", () => {
  it("reports the checked state and describes the option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CheckboxField label="Exclude blank pages" description="Skip blank pages when splitting." checked={false} onChange={onChange} />);

    const checkbox = screen.getByRole("checkbox", { name: "Exclude blank pages" });
    expect(document.getElementById(checkbox.getAttribute("aria-describedby")).textContent).toBe(
      "Skip blank pages when splitting.",
    );
    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
