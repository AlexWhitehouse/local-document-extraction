import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { Dropzone } from "./Dropzone.jsx";
import { DataTable } from "./DataTable.jsx";

const pdf = () => new File(["sample"], "invoice.pdf", { type: "application/pdf" });

describe("Dropzone", () => {
  it("browses from the keyboard and hands dropped files to onFiles", async () => {
    const user = userEvent.setup();
    const onFiles = vi.fn();
    render(<Dropzone label="Source files" hint="PDF only" onFiles={onFiles} />);
    const input = screen.getByLabelText("Source files");
    const browse = vi.spyOn(input, "click");
    const zone = screen.getByRole("button", { name: /Drop files or click to browse/ });

    zone.focus();
    await user.keyboard("{Enter}");
    expect(browse).toHaveBeenCalledTimes(1);

    const file = pdf();
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);

    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onFiles).toHaveBeenLastCalledWith([file]);
  });

  it("marks the zone while a file is dragged over it", () => {
    const { container } = render(<Dropzone label="Source files" onFiles={() => {}} />);
    const zone = container.querySelector(".ui-dropzone");

    fireEvent.dragOver(zone);
    expect(zone.className).toContain("is-active");
    fireEvent.dragLeave(zone, { relatedTarget: document.body });
    expect(zone.className).not.toContain("is-active");
  });

  it("ignores drops while disabled", () => {
    const onFiles = vi.fn();
    render(<Dropzone label="Source files" disabled onFiles={onFiles} />);

    fireEvent.drop(screen.getByRole("button", { name: /Drop files/ }), { dataTransfer: { files: [pdf()] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("lets callers place their own buttons with browse()", async () => {
    const user = userEvent.setup();
    const onFiles = vi.fn();
    render(
      <Dropzone
        label="Evaluation document"
        onFiles={onFiles}
        renderContent={({ browse }) => <button type="button" onClick={browse}>Upload new</button>}
      />,
    );
    const browse = vi.spyOn(screen.getByLabelText("Evaluation document"), "click");

    await user.click(screen.getByRole("button", { name: "Upload new" }));
    expect(browse).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Drop files/ })).toBeNull();
  });
});

describe("DataTable", () => {
  it("applies the shared table class and modifiers", () => {
    render(
      <DataTable label="Costs" compact>
        <thead>
          <tr>
            <th>Name</th>
          </tr>
        </thead>
      </DataTable>,
    );

    const table = screen.getByRole("table", { name: "Costs" });
    expect(table.className).toBe("table table--compact");
  });
});
