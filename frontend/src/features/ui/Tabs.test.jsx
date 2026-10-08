import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import { Segmented, Tabs } from "./Tabs.jsx";

const ITEMS = [
  { value: "overview", label: "Overview" },
  { value: "documents", label: "Documents" },
  { value: "pricing", label: "Pricing" },
];

function TabsHarness() {
  const [value, setValue] = useState("overview");

  return <Tabs label="Cost views" items={ITEMS} value={value} onChange={setValue} renderPanel={(active) => <p>{active} panel</p>} />;
}

function SegmentedHarness() {
  const [value, setValue] = useState("chart");

  return (
    <Segmented
      label="View"
      items={[
        { value: "chart", label: "Chart" },
        { value: "table", label: "Table" },
      ]}
      value={value}
      onChange={setValue}
    />
  );
}

describe("Tabs", () => {
  it("links tabs to their panel and moves with arrow, Home and End keys", async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);

    const overview = screen.getByRole("tab", { name: "Overview" });
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(overview.id);

    await user.click(overview);
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Documents" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Documents" }));
    expect(screen.getByText("documents panel")).toBeTruthy();

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Pricing" }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowLeft}{Home}");
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: "Pricing" }).getAttribute("tabindex")).toBe("-1");
  });
});

describe("Segmented", () => {
  it("is a radio group with roving focus", async () => {
    const user = userEvent.setup();
    render(<SegmentedHarness />);

    expect(screen.getByRole("radiogroup", { name: "View" })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Chart" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Table" }).getAttribute("aria-checked")).toBe("true");
  });
});
