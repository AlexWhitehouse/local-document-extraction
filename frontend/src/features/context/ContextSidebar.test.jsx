import React from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ContextSidebar } from "./ContextSidebar.jsx";

const styles = readFileSync("src/styles.css", "utf8");

describe("ContextSidebar", () => {
  it("keeps the search control compact above the scrollable context list", () => {
    const style = document.createElement("style");
    style.textContent = styles;
    document.head.append(style);

    try {
      const { container } = render(
        <ContextSidebar title="Templates" footer={<span>Templates 2</span>}>
          <label>
            Search Templates
            <input placeholder="Template name or ID" />
          </label>
          <div className="context-list">
            <button type="button" className="context-item">
              <strong>Receipt</strong>
              <span>tpl_1</span>
            </button>
          </div>
        </ContextSidebar>,
      );

      const sidebar = container.querySelector(".context-sidebar");

      expect(getComputedStyle(sidebar).gridTemplateRows).toBe(
        "auto auto minmax(0, 1fr) auto",
      );
    } finally {
      style.remove();
    }
  });
});
