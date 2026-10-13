import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceCosts } from "./WorkspaceCosts.jsx";
import { OverviewTab } from "./OverviewTab.jsx";
import { useCostResource } from "./useCostResource.js";
import { resolveRange, validCustomRange } from "./costRange.js";
import { costAmount } from "../../../../../shared/processingCosts.ts";

const costs = (amount = 0.3, unknown = 0) => ({
  currency: "USD",
  total: costAmount(amount, amount === null ? 0 : 1, unknown),
  split: costAmount(),
  auto_template: costAmount(),
  extraction: costAmount(amount, amount === null ? 0 : 1, unknown),
});

const metrics = {
  costs: costs(),
  documents: 4,
  pages: 8,
  fullyCostedDocuments: 1,
  fullyCostedPages: 2,
  fullyCostedAmount: 0.2,
};

const overview = {
  range: { start: "2026-09-01T00:00:00.000Z", end: "2026-09-02T00:00:00.000Z", unit: "day" },
  totals: metrics,
  previous: null,
  samples: [],
  sampled: false,
  buckets: [{ ...metrics, key: "2026-09-01", date: "2026-09-01", hour: 0 }],
};

const props = {
  workspaceId: "workspace_a",
  workspaceCrumb: { label: "Intake", href: "/workspaces/workspace_a", onClick: vi.fn() },
  role: "owner",
  tab: "overview",
  onTab: vi.fn(),
};

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
    expect(
      (Date.parse(url.searchParams.get("end")) - Date.parse(url.searchParams.get("start"))) / 86400000,
    ).toBeGreaterThanOrEqual(365);
    expect(request.mock.calls[0][1].cache).toBe("no-store");
  });

  it("does not fetch for members and removes the dashboard immediately on a role downgrade", async () => {
    const request = vi.fn().mockResolvedValue(overview);
    const view = render(<WorkspaceCosts {...props} role="member" request={request} />);
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByText("Only workspace owners and admins can view costs.")).toBeTruthy();
    view.rerender(<WorkspaceCosts {...props} request={request} />);
    await screen.findByLabelText("Headline figures");
    view.rerender(<WorkspaceCosts {...props} role="member" request={request} />);
    expect(screen.queryByLabelText("Headline figures")).toBeNull();
  });

  it("shows unknown totals as unavailable and labels background history building", async () => {
    const unknown = {
      ...metrics,
      costs: costs(null, 1),
      fullyCostedDocuments: 0,
      fullyCostedPages: 0,
      fullyCostedAmount: 0,
    };

    render(
      <WorkspaceCosts
        {...props}
        request={vi.fn().mockResolvedValue({
          ...overview,
          totals: unknown,
          updating: true,
          historyBuilding: true,
          buckets: [{ ...overview.buckets[0], ...unknown }],
        })}
      />,
    );
    await screen.findByLabelText("Headline figures");
    expect(screen.getByText("Total spend").closest("div").textContent).toContain("—");
    expect(screen.getByText("Per day").closest("div").textContent).toContain("—");
    expect(screen.getByRole("status").textContent).toContain("Figures may be incomplete");
  });

  it("keeps sparse search continuation available and loads a deleted all-blank packet on selection", async () => {
    const packet = {
      id: "packet",
      kind: "packet",
      name: "Blank packet.pdf",
      created_at: "2026-09-01T10:00:00.000Z",
      status: "completed",
      deleted: true,
      documentCount: 0,
      pages: 2,
      pageNumbers: [2, 5],
      excludedPages: 2,
      excludedPageNumbers: [2, 5],
      children: [],
      costs: {
        ...costs(),
        extraction: costAmount(),
        split: costAmount(0.3, 1),
        excluded_pages_cost: costAmount(0.3, 1),
      },
    };

    const request = vi.fn(async (path) =>
      path.includes("/documents/packet")
        ? packet
        : path.includes("cursor=")
          ? { items: [packet], cursor: null }
          : { items: [], cursor: "next", searchContinuing: true },
    );

    render(<WorkspaceCosts {...props} tab="documents" request={request} />);
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByLabelText("Headline figures");
  });

  it("replaces empty chart axes with a plain message when the range has no costs", async () => {
    const empty = {
      ...overview,
      totals: { ...metrics, documents: 0, pages: 0, costs: costs(0) },
      buckets: [{ ...metrics, documents: 0, pages: 0, costs: costs(0), key: "2026-09-01", date: "2026-09-01", hour: 0 }],
    };

    render(<WorkspaceCosts {...props} request={vi.fn().mockResolvedValue(empty)} />);
    expect(await screen.findByText("No costs in this range")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Spend by stage" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Table" })).toBeNull();
  });
});

it("aborts obsolete reads and never renders another workspace's late result", async () => {
  const pending = [];
  const request = vi.fn((path, options) => new Promise((resolve) => pending.push({ path, options, resolve })));
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
  expect(resolveRange({ preset: "1d" }, Date.parse("2026-10-04T13:20:00Z"))).toEqual({
    start: "2026-10-03T14:00:00.000Z",
    end: "2026-10-04T14:00:00.000Z",
    unit: "hour",
  });
  expect(resolveRange({ preset: "custom", from: "2026-03-29", to: "2026-03-29" }, Date.parse("2026-10-04"))).toEqual({
    start: "2026-03-29T00:00:00.000Z",
    end: "2026-03-30T00:00:00.000Z",
    unit: "hour",
  });
});

it("shows weighted template percentiles, combines small groups, and explains reassessed outliers", () => {
  const primary = {
    id: "ordinary",
    name: "Ordinary invoice",
    templateId: "invoices",
    template: "Primary invoice template",
    pages: 2,
    costs: costs(2),
    weight: 10,
  };

  const retry = {
    ...primary,
    id: "retry",
    name: "Reassessed invoice",
    pages: 4,
    costs: costs(20),
    weight: 1,
    retried: true,
  };

  const samples = [
    primary,
    retry,
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `other-${index}`,
      name: `Other document ${index}`,
      templateId: `template-${index}`,
      template: `Template ${index}`,
      pages: 1,
      costs: costs(1),
      weight: 1,
    })),
  ];

  const totals = {
    ...metrics,
    costs: costs(52),
    documents: 23,
    pages: 36,
    fullyCostedDocuments: 23,
    fullyCostedPages: 36,
    fullyCostedAmount: 52,
  };

  render(
    <OverviewTab data={{ ...overview, totals, previous: { ...totals, costs: costs(26) }, samples, sampled: true }} />,
  );
  expect(screen.getByText("▲ 100%")).toBeTruthy();
  const spread = screen.getByRole("region", { name: "Cost per document" });
  expect(within(spread).getByText(/Based on a sample of 14 of 23 documents/)).toBeTruthy();
  expect(within(spread).getByRole("radio", { name: "Chart" }).getAttribute("aria-checked")).toBe("true");
  expect(within(spread).queryByRole("table")).toBeNull();
  fireEvent.focus(screen.getByLabelText("Reassessed invoice: $20.00"));
  expect(screen.getByRole("tooltip").textContent).toContain("The retries are included.");
  fireEvent.blur(screen.getByLabelText("Reassessed invoice: $20.00"));
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.click(within(spread).getByRole("radio", { name: "Table" }));
  expect(within(spread).getByRole("columnheader", { name: "Est. median" })).toBeTruthy();
  const table = within(spread).getByRole("table");
  expect(within(table).getAllByRole("row")).toHaveLength(13);
  expect(within(table).getByText("Other templates")).toBeTruthy();
  expect(within(table).getByText(primary.template).closest("tr").textContent).toContain("$2.00$2.00");
  fireEvent.click(within(spread).getByRole("radio", { name: "Per page" }));
  expect(within(table).getByText(primary.template).closest("tr").textContent).toContain("$1.00$1.00");
  fireEvent.click(within(spread).getByRole("radio", { name: "Chart" }));
  fireEvent.mouseMove(screen.getByLabelText("Reassessed invoice: $5.00"), { clientX: 50, clientY: 50 });
  expect(screen.getByRole("tooltip").textContent).toContain("$5.00 per page");
  fireEvent.mouseLeave(screen.getByLabelText("Reassessed invoice: $5.00"));
});

it("exports the selected range from the header as a summary and detailed workbook", async () => {
  const child = (id, template, amount) => ({
    id,
    kind: "document",
    name: `${id}.pdf`,
    template,
    templateId: template,
    pages: 2,
    pageNumbers: [],
    created_at: "2026-09-01T10:30:00.000Z",
    status: "completed",
    deleted: false,
    costs: costs(amount),
    retried: false,
  });

  const exported = {
    updating: false,
    generatedAt: "2026-09-02T09:00:00.000Z",
    truncated: false,
    uploads: [
      {
        id: "packet",
        kind: "packet",
        name: "Bundle & co.pdf",
        created_at: "2026-09-01T10:30:00.000Z",
        status: "completed",
        pages: 5,
        deleted: false,
        documentCount: 2,
        costs: costs(0.5),
        children: [child("first", "Invoices", 0.2), child("second", "Receipts", 0.2)],
      },
    ],
  };

  const request = vi.fn(async (path) => (path.includes("/export?") ? exported : overview));
  const notify = vi.fn();
  const createObjectURL = vi.fn(() => "blob:costs");
  const revokeObjectURL = vi.fn();

  class ExportURL extends globalThis.URL {}

  ExportURL.createObjectURL = createObjectURL;
  ExportURL.revokeObjectURL = revokeObjectURL;
  vi.stubGlobal("URL", ExportURL);

  const names = [];

  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    names.push(this.download);
  });

  try {
    render(<WorkspaceCosts {...props} tab="documents" request={request} notify={notify} />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("costs.export", "success", { label: "Last 30 days" }));

    const exportUrl = new URL(request.mock.calls.find(([path]) => path.includes("/export?"))[0], "http://localhost");
    expect(exportUrl.pathname).toBe("/workspaces/workspace_a/costs/export");
    expect(Date.parse(exportUrl.searchParams.get("end")) - Date.parse(exportUrl.searchParams.get("start"))).toBe(
      30 * 86400000,
    );
    expect(names[0]).toMatch(/^costs-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:costs");
    const text = new TextDecoder().decode(await createObjectURL.mock.calls[0][0].arrayBuffer());

    for (const sheet of ["Summary", "Daily", "By template", "Documents"]) expect(text).toContain(`<sheet name="${sheet}"`);
    expect(text).toContain("Bundle &amp; co.pdf");
    expect(text).toContain("Pages not in a document");
  } finally {
    click.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("reports a failed export without downloading", async () => {
  const request = vi.fn(async (path) => {
    if (path.includes("/export?")) throw new Error("offline");

    return overview;
  });

  const notify = vi.fn();
  render(<WorkspaceCosts {...props} request={request} notify={notify} />);
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith("costs.export", "failure", expect.anything()));
  expect(screen.getByRole("button", { name: "Export" }).disabled).toBe(false);
});

it("keeps incomplete hourly spend distinct from fully costed averages in chart and table views", () => {
  const partial = {
    ...costs(0.5, 1),
    split: costAmount(0.1, 1),
    auto_template: costAmount(0.1, 1),
    extraction: costAmount(0.3, 1, 1),
  };

  const bucket = { ...metrics, costs: partial, key: "2026-09-01T10", date: "2026-09-01", hour: 10 };

  const empty = {
    ...bucket,
    key: "2026-09-01T11",
    hour: 11,
    documents: 0,
    fullyCostedDocuments: 0,
    costs: costs(null, 1),
  };

  render(
    <OverviewTab
      data={{
        ...overview,
        range: { ...overview.range, unit: "hour" },
        totals: { ...metrics, costs: partial },
        previous: metrics,
        buckets: [bucket, empty],
      }}
    />,
  );
  expect(screen.queryByText(/vs previous period/)).toBeNull();
  expect(screen.getByText("Total spend").closest("div").textContent).toContain("$0.50+");
  const chart = screen.getByRole("group", { name: "Spend by stage" });
  const band = within(chart).getByLabelText("10:00: $0.50+, 4 documents");
  fireEvent.focus(band);
  expect(screen.getByRole("tooltip").textContent).toContain("Average $0.20 per document");
  expect(screen.getByRole("tooltip").textContent).toContain("Includes calls without a reported cost.");
  fireEvent.blur(band);
  fireEvent.click(screen.getByRole("radio", { name: "Table" }));
  const table = screen.getByRole("table");
  expect(within(table).getByRole("columnheader", { name: "Hour" })).toBeTruthy();
  expect(within(table).getByText("1 Sept, 10:00").closest("tr").textContent).toContain("$0.50+$0.20");
  expect(within(table).getByText("1 Sept, 11:00").closest("tr").textContent).toContain("—");
});

it("applies bounded historical custom ranges and supports dashboard navigation", async () => {
  const request = vi.fn().mockResolvedValue(overview),
    onTab = vi.fn(),
    onBack = vi.fn();

  render(<WorkspaceCosts {...props} workspaceCrumb={{ label: "Intake", href: "/workspaces/workspace_a", onClick: onBack }} request={request} onTab={onTab} />);
  await screen.findByLabelText("Headline figures");
  fireEvent.click(screen.getByRole("button", { name: "Custom…" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2020-01-01" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2021-01-01" } });
  expect(screen.getByRole("button", { name: "Apply" }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2020-01-31" } });
  expect(screen.getByText("Shown by day.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  const range = new URL(request.mock.calls[1][0], "http://localhost").searchParams;
  expect(Object.fromEntries(range)).toEqual({
    start: "2020-01-01T00:00:00.000Z",
    end: "2020-02-01T00:00:00.000Z",
    unit: "day",
  });
  expect(screen.getByText("2020-01-01 to 2020-01-31")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "01-01 – 01-31" }));
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "01-01 – 01-31" }));
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2020-01-01" } });
  expect(screen.getByText("One day is shown by hour.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(new URL(request.mock.calls[2][0], "http://localhost").searchParams.get("unit")).toBe("hour");
  fireEvent.click(screen.getByRole("tab", { name: "Documents" }));
  expect(onTab).toHaveBeenCalledWith("documents");
  const breadcrumb = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
  expect(breadcrumb.getByRole("link", { name: "Intake" }).getAttribute("href")).toBe("/workspaces/workspace_a");
  expect(breadcrumb.getByText("Costs").getAttribute("aria-current")).toBe("page");
  fireEvent.click(breadcrumb.getByRole("link", { name: "Intake" }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

it("links the cost view tabs to their panel and moves between views with arrow keys", async () => {
  const request = vi.fn().mockResolvedValue(overview),
    onTab = vi.fn();

  render(<WorkspaceCosts {...props} request={request} onTab={onTab} />);
  await screen.findByLabelText("Headline figures");
  const overviewTab = screen.getByRole("tab", { name: "Overview" });
  const panel = screen.getByRole("tabpanel");
  expect(overviewTab.getAttribute("aria-selected")).toBe("true");
  expect(panel.getAttribute("aria-labelledby")).toBe(overviewTab.id);
  fireEvent.keyDown(overviewTab, { key: "ArrowRight" });
  expect(onTab).toHaveBeenCalledWith("documents");
});

it("reconciles packet split shares, deleted children, and unallocated original pages", async () => {
  const child = {
    id: "invoice",
    name: "Invoice",
    template: "Invoices",
    pages: 2,
    pageNumbers: [2, 5],
    deleted: true,
    costs: {
      ...costs(0.6),
      split: costAmount(0.2, 1),
      auto_template: costAmount(0.1, 1),
      extraction: costAmount(0.3, 1),
    },
  };

  const second = {
    ...child,
    id: "receipt",
    name: "Receipt",
    template: "Receipts",
    deleted: false,
    pages: 1,
    pageNumbers: [9],
    costs: { ...costs(0.2), split: costAmount(0.1, 1), extraction: costAmount(0.1, 1) },
  };

  const packet = {
    id: "packet",
    kind: "packet",
    name: "Mixed packet.pdf",
    created_at: "2026-09-01T10:00:00.000Z",
    status: "processing_children",
    documentCount: 2,
    pages: 5,
    pageNumbers: [2, 5, 9, 10, 12],
    excludedPages: 1,
    excludedPageNumbers: [10],
    children: [child, second],
    costs: {
      ...costs(1),
      split: costAmount(0.5, 1),
      auto_template: costAmount(0.1, 1),
      extraction: costAmount(0.4, 2),
      excluded_pages_cost: costAmount(0.1, 1),
    },
  };

  const request = vi.fn(async (path) =>
    path.includes("/documents/packet") ? packet : { items: [packet], cursor: null },
  );

  render(<WorkspaceCosts {...props} tab="documents" request={request} />);
  const detail = await screen.findByRole("region", { name: "Mixed packet.pdf cost" });
  const table = within(detail).getByRole("table");
  expect(within(table).getByText("Invoice").closest("tr").textContent).toContain("Deleted");
  expect(within(table).getByText("Unallocated pages").closest("tr").textContent).toContain("$0.10");
  expect(within(table).getByText("Excluded pages").closest("tr").textContent).toContain("$0.10");
  expect(within(within(table).getByText("Invoice").closest("tr")).getAllByRole("cell")[2].textContent).toBe("$0.20");
  const page = within(detail).getByTitle("Page 12 · Unallocated pages");
  fireEvent.mouseEnter(page);
  expect(within(detail).getByLabelText("Invoice: $0.60").className).toContain("cp-dim");
  fireEvent.mouseLeave(page);
  const invoice = within(detail).getByLabelText("Invoice: $0.60");
  fireEvent.focus(invoice);
  expect(screen.getByRole("tooltip").textContent).toContain("60% of total · deleted");
  fireEvent.blur(invoice);
  fireEvent.click(screen.getByRole("radio", { name: "Split PDFs" }));
  await waitFor(() => expect(request.mock.calls.some(([path]) => path.includes("kind=multi"))).toBe(true));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "perPage" } });
  await screen.findByText("$0.20/pg");
  expect(request.mock.calls.some(([path]) => path.includes("sort=perPage"))).toBe(true);
});

it("refreshes only visible pages and clears previously loaded costs after access is revoked", async () => {
  vi.useFakeTimers();
  let visibility = "visible";
  const visible = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);

  const request = vi
    .fn()
    .mockResolvedValueOnce(overview)
    .mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403 }));

  const hook = renderHook(() => useCostResource(request, "/costs"));

  try {
    await act(async () => {});
    expect(hook.result.current.data).toEqual(overview);
    visibility = "hidden";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(request).toHaveBeenCalledTimes(1);
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(hook.result.current.data).toBeNull();
    expect(hook.result.current.error).toContain("signed-in Workspace owners and admins");
  } finally {
    hook.unmount();
    visible.mockRestore();
    vi.useRealTimers();
  }
});

it("shows search spend for the range apart from document spend, and nothing when there were no searches", () => {
  const { rerender } = render(
    <OverviewTab
      data={{
        ...overview,
        searches: { calls: 12, costs: costAmount(0.03, 12, 0) },
        previous_searches: { calls: 0, costs: costAmount() },
      }}
    />,
  );

  expect(screen.getByText(/^Search:/).textContent).toBe("Search: $0.0300 across 12 requests. Not included in total spend.");
  rerender(<OverviewTab data={{ ...overview, searches: { calls: 2, costs: costAmount(null, 0, 2) } }} />);
  expect(screen.getByText(/^Search:/).textContent).toBe("Search: 2 requests without a reported cost. Not included in total spend.");
  rerender(<OverviewTab data={{ ...overview, searches: { calls: 0, costs: costAmount() } }} />);
  expect(screen.queryByText(/^Search:/)).toBeNull();
});
