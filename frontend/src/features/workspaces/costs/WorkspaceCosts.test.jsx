import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceCosts } from "./WorkspaceCosts.jsx";
import { useCostResource } from "./useCostResource.js";
import { resolveRange, validCustomRange } from "./costRange.js";
import { costAmount } from "../../../../../shared/processingCosts.ts";

const costs = (amount = 0.3, unknown = 0) => ({ currency: "USD", total: costAmount(amount, amount === null ? 0 : 1, unknown), split: costAmount(), auto_template: costAmount(), extraction: costAmount(amount, amount === null ? 0 : 1, unknown) });
const metrics = { costs: costs(), documents: 4, pages: 8, fullyCostedDocuments: 1, fullyCostedPages: 2, fullyCostedAmount: 0.2 };
const overview = {
  range: { start: "2026-09-01T00:00:00.000Z", end: "2026-09-02T00:00:00.000Z", unit: "day" },
  totals: metrics, previous: null, samples: [], sampled: false,
  buckets: [{ ...metrics, key: "2026-09-01", date: "2026-09-01", hour: 0 }],
};
const props = { workspaceId: "workspace_a", workspaceName: "Intake", role: "owner", tab: "overview", onTab: vi.fn(), onBack: vi.fn() };

describe("workspace costs", () => {
  it("shows exact backend figures with fully costed denominators and requests a twelve-month range", async () => {
    const request = vi.fn().mockResolvedValue(overview);
    render(<WorkspaceCosts {...props} request={request} />);
    await screen.findByLabelText("Headline figures");
    expect(screen.getByText("Per document", { selector: "dt" }).closest("div").textContent).toContain("$0.20");
    expect(screen.getByText("Per page", { selector: "dt" }).closest("div").textContent).toContain("$0.10");
    expect(screen.getByText("Total spend").closest("div").textContent).toContain("$0.30");
    fireEvent.click(screen.getByRole("radio", { name: "12M" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const url = new URL(request.mock.calls[1][0], "http://localhost");
    expect((Date.parse(url.searchParams.get("end")) - Date.parse(url.searchParams.get("start"))) / 86400000).toBeGreaterThanOrEqual(365);
    expect(request.mock.calls[0][1].cache).toBe("no-store");
  });

  it("does not fetch for members and removes the dashboard immediately on a role downgrade", async () => {
    const request = vi.fn().mockResolvedValue(overview);
    const view = render(<WorkspaceCosts {...props} role="member" request={request} />);
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByText("Costs are visible to Workspace owners and admins.")).toBeTruthy();
    view.rerender(<WorkspaceCosts {...props} request={request} />);
    await screen.findByLabelText("Headline figures");
    view.rerender(<WorkspaceCosts {...props} role="member" request={request} />);
    expect(screen.queryByLabelText("Headline figures")).toBeNull();
  });

  it("shows unknown totals as unavailable and labels background history building", async () => {
    const unknown = { ...metrics, costs: costs(null, 1), fullyCostedDocuments: 0, fullyCostedPages: 0, fullyCostedAmount: 0 };
    render(<WorkspaceCosts {...props} request={vi.fn().mockResolvedValue({ ...overview, totals: unknown, updating: true, historyBuilding: true, buckets: [{ ...overview.buckets[0], ...unknown }] })} />);
    await screen.findByLabelText("Headline figures");
    expect(screen.getByText("Total spend").closest("div").textContent).toContain("—");
    expect(screen.getByText("Per day").closest("div").textContent).toContain("—");
    expect(screen.getByRole("status").textContent).toContain("Figures are incomplete");
  });

  it("keeps sparse search continuation available and loads a deleted all-blank packet on selection", async () => {
    const packet = { id: "packet", kind: "packet", name: "Blank packet.pdf", created_at: "2026-09-01T10:00:00.000Z", status: "completed", deleted: true,
      documentCount: 0, pages: 2, pageNumbers: [2, 5], excludedPages: 2, excludedPageNumbers: [2, 5], children: [],
      costs: { ...costs(), extraction: costAmount(), split: costAmount(0.3, 1), excluded_pages_cost: costAmount(0.3, 1) } };
    const request = vi.fn(async path => path.includes("/documents/packet") ? packet : path.includes("cursor=") ? { items: [packet], cursor: null } : { items: [], cursor: "next", searchContinuing: true });
    render(<WorkspaceCosts {...props} tab="documents" request={request} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue search" }));
    const detail = await screen.findByRole("region", { name: "Blank packet.pdf cost" });
    expect(within(detail).getByText("No documents to extract · 2 pages")).toBeTruthy();
    expect(within(detail).getByText("Deleted")).toBeTruthy();
    expect(within(detail).getByTitle("Page 2 · Excluded pages")).toBeTruthy();
    expect(within(detail).getByTitle("Page 5 · Excluded pages")).toBeTruthy();
    expect(request.mock.calls.some(([path]) => path.includes("cursor=next"))).toBe(true);
  });

  it("offers recovery when loading fails", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(overview);
    render(<WorkspaceCosts {...props} request={request} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByLabelText("Headline figures");
  });
});

it("aborts obsolete reads and never renders another workspace's late result", async () => {
  const pending = [];
  const request = vi.fn((path, options) => new Promise(resolve => pending.push({ path, options, resolve })));
  const hook = renderHook(({ path }) => useCostResource(request, path), { initialProps: { path: "/a" } });
  hook.rerender({ path: "/b" });
  expect(pending[0].options.signal.aborted).toBe(true);
  await act(async () => pending[0].resolve({ name: "Private A" }));
  expect(hook.result.current.data).toBeNull();
  await act(async () => pending[1].resolve({ name: "B" }));
  expect(hook.result.current.data.name).toBe("B");
});

it("validates dates and uses UTC hourly buckets even across daylight saving changes", () => {
  expect(validCustomRange("2026-02-30", "2026-03-01", "2026-10-04")).toBe(false);
  expect(validCustomRange("2024-01-01", "2026-01-01", "2026-10-04")).toBe(false);
  expect(validCustomRange("2025-01-01", "2025-12-31", "2026-10-04")).toBe(true);
  expect(resolveRange({ preset: "1d" }, Date.parse("2026-10-04T13:20:00Z"))).toEqual({ start: "2026-10-03T14:00:00.000Z", end: "2026-10-04T14:00:00.000Z", unit: "hour" });
  expect(resolveRange({ preset: "custom", from: "2026-03-29", to: "2026-03-29" }, Date.parse("2026-10-04"))).toEqual({ start: "2026-03-29T00:00:00.000Z", end: "2026-03-30T00:00:00.000Z", unit: "hour" });
});
