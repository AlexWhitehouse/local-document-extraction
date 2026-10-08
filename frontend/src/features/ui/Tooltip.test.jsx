import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { Tooltip } from "./Tooltip.jsx";

function renderTip(props) {
  render(
    <Tooltip content="Cost breakdown" {...props}>
      <button type="button">Total</button>
    </Tooltip>,
  );

  return { trigger: screen.getByRole("button", { name: "Total" }), tip: screen.getByRole("tooltip", { hidden: true }) };
}

describe("Tooltip", () => {
  it("closes when the pointer leaves the trigger", () => {
    const { trigger, tip } = renderTip();

    fireEvent.mouseEnter(trigger);
    expect(tip.className).toContain("is-open");
    fireEvent.mouseLeave(trigger);
    expect(tip.className).not.toContain("is-open");
  });

  it("stays open while the pointer is over an interactive tip", () => {
    const { trigger, tip } = renderTip({ interactive: true });
    const anchor = trigger.parentElement;

    fireEvent.mouseEnter(anchor);
    expect(tip.className).toContain("is-open");
    fireEvent.mouseLeave(trigger, { relatedTarget: tip });
    expect(tip.className).toContain("is-open");
    fireEvent.mouseLeave(anchor);
    expect(tip.className).not.toContain("is-open");
  });
});
