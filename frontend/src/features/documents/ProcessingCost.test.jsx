import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ProcessingCost } from "./ProcessingCost.jsx";
import { DocumentPage } from "./DocumentPage.jsx";
import { PacketPage } from "./PacketPage.jsx";
import { createCompletedDocumentCache } from "../../lib/completedDocumentCache.js";

const amount = (value, complete = true) => ({
  amount: value,
  complete,
  reported_calls: value === null ? 0 : 1,
  unreported_calls: complete ? 0 : 1,
});

const costs = {
  currency: "USD",
  split: amount(0.006),
  auto_template: amount(0.0022842),
  extraction: amount(0.004),
  total: amount(0.0122842),
  split_allocation: { document_pages: 3, packet_pages: 10 },
};

const document = {
  job_id: "cost_doc",
  status: "completed",
  costs,
  results: [{ field_id: "total", name: "Total", answer: "42", confidence: 0.9 }],
};

describe("Processing cost headers", () => {
  it("places the document total beside confidence and shows stage costs on hover", async () => {
    const user = userEvent.setup();
    render(<DocumentPage selectedDocument={document} />);
    const button = screen.getByRole("button", { name: "Document total cost: $0.0122842" });
    expect(button.closest(".processing-cost").previousElementSibling.textContent).toContain("average confidence");
    expect(screen.getByRole("tooltip").className).not.toContain("is-open");
    await user.hover(button);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).toContain("is-open");
    expect(within(tooltip).getByText("Smart split").nextElementSibling.textContent).toBe("$0.006");
    expect(within(tooltip).getByText("Auto template").nextElementSibling.textContent).toBe("$0.0022842");
    expect(within(tooltip).getByText("Extraction").nextElementSibling.textContent).toBe("$0.004");
    // Escape also dismisses a hovered tooltip when the trigger does not have focus.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("tooltip").className).not.toContain("is-open");
  });

  it("places the packet total after excluded count and supports keyboard focus and Escape", async () => {
    const user = userEvent.setup();
    const packetCosts = { ...costs, split_allocation: undefined, excluded_pages_cost: amount(0.002) };
    render(
      <PacketPage
        packet={{
          packet_id: "packet",
          status: "completed",
          selected_pages: [1, 2],
          plan: { groups: [], exclusions: [{ page: 2, reason: "Blank" }] },
          children: [],
          costs: packetCosts,
        }}
      />,
    );
    const button = screen.getByRole("button", { name: "Packet total cost: $0.0122842" });
    expect(button.closest(".processing-cost").previousElementSibling.textContent).toBe("1 excluded");
    act(() => button.focus());
    expect(screen.getByRole("tooltip").id).toBe(button.getAttribute("aria-describedby"));
    expect(screen.getByRole("tooltip").className).toContain("is-open");
    expect(screen.getByText(/kept at packet level/)).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("tooltip").className).not.toContain("is-open");
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip").className).toContain("is-open");
  });

  it("distinguishes zero, partial, unavailable, and very small amounts", () => {
    const { rerender } = render(<ProcessingCost costs={{ ...costs, total: amount(0) }} />);
    expect(screen.getByRole("button", { name: "Document total cost: $0.00" })).toBeTruthy();
    rerender(<ProcessingCost costs={{ ...costs, total: amount(0.003, false), auto_template: amount(null, false) }} />);
    fireEvent.focus(screen.getByRole("button", { name: "Document total cost: $0.003+" }));
    expect(screen.getByText(/known subtotal/)).toBeTruthy();
    expect(screen.getByText("Auto template").nextElementSibling.textContent).toBe("Unavailable");
    rerender(<ProcessingCost />);
    expect(screen.getByRole("button", { name: "Document total cost: Unavailable" })).toBeTruthy();
    rerender(<ProcessingCost costs={{ ...costs, total: amount(0.000000001) }} />);
    expect(screen.getByRole("button", { name: "Document total cost: <$0.00000001" })).toBeTruthy();
  });

  it("retains cost metadata in the completed document cache", () => {
    const cache = createCompletedDocumentCache();
    cache.store("workspace", document);
    const reloaded = createCompletedDocumentCache();
    expect(reloaded.get("workspace", "cost_doc").costs).toEqual(costs);
  });
});
