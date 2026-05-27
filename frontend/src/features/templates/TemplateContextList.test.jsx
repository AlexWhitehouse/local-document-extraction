import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TemplateContextList } from "./TemplateContextList.jsx";

describe("TemplateContextList", () => {
  it("lets users search, select the draft Template, and load an existing Template", () => {
    const onSearchChange = vi.fn();
    const onSelectDraftTemplate = vi.fn();
    const onSelectTemplate = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <TemplateContextList
        search="prescription"
        templates={[
          { id: "__draft_template__", name: "New Template", is_draft: true },
          { id: "tpl_1", name: "Prescription Template" },
        ]}
        selectedTemplateId="tpl_1"
        isEditingTemplate={true}
        onSearchChange={onSearchChange}
        onSelectDraftTemplate={onSelectDraftTemplate}
        onSelectTemplate={onSelectTemplate}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Templates"), {
      target: { value: "receipt" },
    });
    fireEvent.click(screen.getByRole("button", { name: /New Template DraftUnsaved/ }));
    fireEvent.click(screen.getByRole("button", { name: "Copy template ID tpl_1" }));
    fireEvent.click(screen.getByRole("button", { name: /Prescription Templatetpl_1/ }));

    expect(onSearchChange).toHaveBeenCalledWith("receipt");
    expect(onSelectDraftTemplate).toHaveBeenCalledOnce();
    expect(onSelectTemplate).toHaveBeenCalledWith("tpl_1");
    expect(
      screen.getByRole("button", { name: /Prescription Templatetpl_1/ }).className,
    ).toContain("active");
    expect(writeText).toHaveBeenCalledWith("tpl_1");
  });
});
