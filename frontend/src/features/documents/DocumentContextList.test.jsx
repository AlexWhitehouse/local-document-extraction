import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentContextList } from "./DocumentContextList.jsx";
import { isSingleDocumentPacket, singlePacketDocument } from "./packetListing.js";

describe("DocumentContextList", () => {
  it("hides child lifecycle updates before their packet or its child list arrives", () => {
    const child = { job_id: "child_live", parent_packet_id: "packet_live", status: "queued" };
    const ordinary = { job_id: "ordinary", source_name: "ordinary.pdf", status: "completed" };
    const props = { documents: [child, ordinary], onSelectDocument: vi.fn() };
    const { container, rerender } = render(<DocumentContextList {...props} />);
    expect(within(container).getAllByRole("listitem")).toHaveLength(1);
    expect(within(container).queryByText("child_live")).toBeNull();
    rerender(
      <DocumentContextList
        {...props}
        packets={[{ packet_id: "packet_live", source_name: "bundle.pdf", status: "materializing", children: [] }]}
      />,
    );
    expect(within(container).getAllByRole("listitem")).toHaveLength(2);
    expect(within(container).queryByText("child_live")).toBeNull();
  });
  it.each([{ pages: [1] }, { pages: [1, 2, 3] }])(
    "shows an accepted one-document split as a normal document for pages $pages",
    ({ pages }) => {
      const child = { job_id: "child_single", status: "completed", source_pages: pages };

      const packet = {
        packet_id: "packet_single",
        source_name: "invoice.pdf",
        status: "completed",
        selected_pages: pages,
        plan_accepted: true,
        plan: { groups: [{ pages }] },
        children: [child],
      };

      const onSelectPacket = vi.fn();
      const onTogglePacketSelection = vi.fn();

      const { container } = render(
        <DocumentContextList
          packets={[packet]}
          documents={[{ ...child, source_name: "invoice.pdf", parent_packet_id: packet.packet_id }]}
          selectedPacketId={packet.packet_id}
          selectedPacketIds={[packet.packet_id]}
          onSelectDocument={vi.fn()}
          onSelectPacket={onSelectPacket}
          onTogglePacketSelection={onTogglePacketSelection}
          onLoadMoreDocuments={vi.fn()}
        />,
      );

      const rows = within(container).getAllByRole("listitem");
      expect(rows).toHaveLength(1);
      expect(rows[0].classList.contains("context-item-packet")).toBe(false);
      expect(rows[0].classList.contains("status-success")).toBe(true);
      expect(rows[0].classList.contains("active")).toBe(true);
      expect(rows[0].querySelector(".context-packet-mark")).toBeNull();
      expect(within(rows[0]).getByText("child_single · Completed")).toBeTruthy();
      expect(within(rows[0]).queryByText("1 document · Completed")).toBeNull();
      expect(within(rows[0]).getByRole("button", { name: "Copy document ID child_single" })).toBeTruthy();
      const checkbox = within(rows[0]).getByRole("checkbox", { name: "Select document child_single" });
      expect(checkbox.checked).toBe(true);
      fireEvent.click(checkbox);
      expect(onTogglePacketSelection).toHaveBeenCalledWith("packet_single", false);
      fireEvent.click(within(rows[0]).getByRole("button", { name: /invoice\.pdf/ }));
      expect(onSelectPacket).toHaveBeenCalledWith("packet_single");
    },
  );

  it("shows pending single-page uploads as ordinary processing documents", () => {
    const { container } = render(
      <DocumentContextList
        packets={[
          {
            packet_id: "packet_pending",
            source_name: "single.pdf",
            status: "processing",
            selected_pages: [1],
            children: [],
          },
        ]}
        documents={[]}
        onSelectDocument={vi.fn()}
        onLoadMoreDocuments={vi.fn()}
      />,
    );

    const row = within(container).getByRole("listitem");
    expect(row.classList.contains("context-item-packet")).toBe(false);
    expect(row.classList.contains("status-info")).toBe(true);
    expect(within(row).getByText("Processing")).toBeTruthy();
  });

  it("uses the current child's status when its packet summary has not refreshed yet", () => {
    const { container } = render(
      <DocumentContextList
        packets={[
          {
            packet_id: "packet_single",
            source_name: "single.pdf",
            status: "processing_children",
            plan: { groups: [{ pages: [1, 2] }] },
            children: [{ job_id: "child_single", status: "processing" }],
          },
        ]}
        documents={[{ job_id: "child_single", status: "awaiting_template" }]}
        onSelectDocument={vi.fn()}
        onLoadMoreDocuments={vi.fn()}
      />,
    );

    const row = within(container).getByRole("listitem");
    expect(row.classList.contains("context-item-packet")).toBe(false);
    expect(row.classList.contains("status-warning")).toBe(true);
  });

  it("flags a split packet whose child is waiting for a template while siblings still extract", () => {
    const { container } = render(
      <DocumentContextList
        packets={[
          {
            packet_id: "packet_split",
            source_name: "split.pdf",
            status: "processing_children",
            plan: { groups: [{ pages: [1] }, { pages: [2] }] },
            children: [
              { job_id: "child_a", status: "completed" },
              { job_id: "child_b", status: "processing" },
            ],
          },
        ]}
        documents={[{ job_id: "child_b", parent_packet_id: "packet_split", status: "awaiting_template" }]}
        onSelectDocument={vi.fn()}
        onLoadMoreDocuments={vi.fn()}
      />,
    );

    const row = within(container).getByRole("listitem");
    expect(row.classList.contains("context-item-packet")).toBe(true);
    expect(row.classList.contains("status-warning")).toBe(true);
    expect(within(row).getByText("2 documents · Needs template")).toBeTruthy();
  });

  it("keeps virtualised rows at the natural row height", () => {
    const documents = Array.from({ length: 101 }, (_, index) => ({
      job_id: `job_${index}`,
      status: "completed",
      created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }));

    const { container } = render(
      <DocumentContextList
        documents={documents}
        onSelectDocument={vi.fn()}
        onLoadMoreDocuments={vi.fn()}
      />,
    );

    const rows = within(container).getAllByRole("listitem");
    expect(rows[1].style.top).toBe("40px");
    expect(rows[1].style.height).toBe("40px");
  });

  it("keeps unresolved and genuinely split documents in packet rows, including a sole surviving child", () => {
    const packets = [
      {
        packet_id: "unresolved",
        source_name: "unresolved.pdf",
        status: "processing",
        selected_pages: [1, 2],
        children: [],
      },
      {
        packet_id: "review",
        source_name: "review.pdf",
        status: "awaiting_review",
        selected_pages: [1],
        plan: { groups: [{ pages: [1] }] },
        children: [],
      },
      {
        packet_id: "multiple",
        source_name: "multiple.pdf",
        status: "completed",
        plan_accepted: true,
        plan: { groups: [{ pages: [1] }, { pages: [2] }] },
        children: [{ job_id: "a" }, { job_id: "b" }],
      },
      {
        packet_id: "survivor",
        source_name: "survivor.pdf",
        status: "completed",
        plan_accepted: true,
        plan: { groups: [{ pages: [1] }, { pages: [2] }] },
        children: [{ job_id: "c" }],
      },
    ];

    const { container } = render(
      <DocumentContextList
        packets={packets}
        documents={[]}
        onSelectDocument={vi.fn()}
        onLoadMoreDocuments={vi.fn()}
      />,
    );

    const rows = within(container).getAllByRole("listitem");
    expect(rows).toHaveLength(4);

    for (const row of rows) expect(row.classList.contains("context-item-packet")).toBe(true);
  });

  it("only resolves a sole child after a one-group split is committed", () => {
    const child = { job_id: "only_child" };

    const packet = {
      status: "processing",
      selected_pages: [1, 2],
      plan: { groups: [{ pages: [1, 2] }] },
      children: [child],
    };

    expect(singlePacketDocument(packet)).toBeNull();
    expect(singlePacketDocument({ ...packet, plan_accepted: true })).toBe(child);
    expect(singlePacketDocument({ ...packet, status: "processing_children" })).toBe(child);
    expect(isSingleDocumentPacket({ ...packet, plan_accepted: true, status: "materializing", children: [] })).toBe(
      true,
    );
    expect(isSingleDocumentPacket({ ...packet, plan_accepted: true, status: "completed", children: [] })).toBe(false);
    expect(
      isSingleDocumentPacket({
        ...packet,
        plan_accepted: true,
        status: "completed",
        outcome: "no_documents",
        children: [],
      }),
    ).toBe(false);
  });
  it("windows long lists, preserves offscreen selections, and navigates to selected rows", () => {
    const documents = Array.from({ length: 1000 }, (_, i) => ({ job_id: `job_${i}`, source_name: `invoice-${i}.pdf` }));
    const onSelectDocument = vi.fn();
    const onToggleAllDocumentSelections = vi.fn();

    const props = {
      documents,
      selectedDocumentId: "job_0",
      selectedDocumentIds: ["job_500"],
      onSelectDocument,
      onToggleAllDocumentSelections,
      onLoadMoreDocuments() {},
    };

    const { container, rerender } = render(<DocumentContextList {...props} />);
    expect(container.querySelectorAll('[role="listitem"]').length).toBeLessThan(30);
    fireEvent.click(within(container).getByRole("checkbox", { name: "Select all documents" }));
    expect(onToggleAllDocumentSelections.mock.lastCall[0]).toHaveLength(1000);
    fireEvent.keyDown(within(container).getByRole("button", { name: /invoice-0\.pdf/ }), { key: "End" });
    expect(onSelectDocument).toHaveBeenLastCalledWith("job_999");
    rerender(<DocumentContextList {...props} selectedDocumentId="job_999" />);
    expect(within(container).getByRole("button", { name: /invoice-999\.pdf/ })).toBe(document.activeElement);
    const list = container.querySelector(".context-list");
    fireEvent.scroll(list, { target: { scrollTop: 500 * 40 } });
    expect(within(container).getByRole("checkbox", { name: "Select document job_500" }).checked).toBe(true);
    expect(container.querySelectorAll('[role="listitem"]').length).toBeLessThan(30);
  });
  it("uses the document status to colour each row's left edge", () => {
    const { container } = render(
      <DocumentContextList
        documents={[
          { job_id: "job_completed", source_name: "completed.pdf", status: "completed" },
          { job_id: "job_queued", source_name: "queued.pdf", status: "queued" },
          { job_id: "job_processing", source_name: "processing.pdf", status: "processing" },
          { job_id: "job_failed", source_name: "failed.pdf", status: "failed" },
        ]}
        selectedDocumentId="job_failed"
        hasMoreDocuments={false}
        isLoadingMoreDocuments={false}
        onSelectDocument={vi.fn()}
        onLoadMoreDocuments={vi.fn()}
      />,
    );

    const rowFor = (name) =>
      within(container)
        .getByRole("button", { name: new RegExp(name) })
        .closest(".context-item-document");

    expect(rowFor("completed.pdf").classList.contains("status-success")).toBe(true);
    expect(rowFor("queued.pdf").classList.contains("status-neutral")).toBe(true);
    expect(rowFor("processing.pdf").classList.contains("status-info")).toBe(true);
    expect(rowFor("failed.pdf").classList.contains("status-danger")).toBe(true);
    expect(rowFor("failed.pdf").classList.contains("active")).toBe(true);
    expect(rowFor("failed.pdf").querySelector("a, button.context-item-main")?.getAttribute("aria-current")).toBe("true");
    expect(rowFor("completed.pdf").querySelector("[aria-current]")).toBeNull();
  });

  it("shows a packet as one dated row in place of its child documents", () => {
    const onSelectPacket = vi.fn();
    const onTogglePacketSelection = vi.fn();
    const onToggleAllDocumentSelections = vi.fn();

    const { container, rerender } = render(
      <DocumentContextList
        packets={[
          {
            packet_id: "packet_1",
            source_name: "bundle.pdf",
            status: "completed",
            created_at: "2026-01-02T00:00:00Z",
            children: [{ job_id: "child_1" }, { job_id: "child_2" }],
          },
        ]}
        documents={[
          { job_id: "newer", source_name: "newer.pdf", status: "completed", created_at: "2026-01-03T00:00:00Z" },
          {
            job_id: "child_1",
            source_name: "bundle.pdf",
            status: "completed",
            parent_packet_id: "packet_1",
            created_at: "2026-01-02T00:00:01Z",
          },
          { job_id: "child_2", status: "completed", created_at: "2026-01-02T00:00:01Z" },
          { job_id: "older", source_name: "older.pdf", status: "completed", created_at: "2026-01-01T00:00:00Z" },
        ]}
        selectedPacketId="packet_1"
        onSelectDocument={vi.fn()}
        onSelectPacket={onSelectPacket}
        onTogglePacketSelection={onTogglePacketSelection}
        onToggleAllDocumentSelections={onToggleAllDocumentSelections}
        onLoadMoreDocuments={vi.fn()}
      />,
    );

    const rows = within(container).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("strong").textContent)).toEqual([
      "newer.pdf",
      "bundle.pdf",
      "older.pdf",
    ]);
    expect(rows[1].classList.contains("active")).toBe(true);
    expect(rows[1].textContent).toContain("2 documents · Completed");
    fireEvent.click(within(rows[1]).getByRole("checkbox", { name: "Select packet packet_1" }));
    expect(onTogglePacketSelection).toHaveBeenCalledWith("packet_1", true);
    // Ctrl+A in the list ticks every loaded row, packets included.
    fireEvent.keyDown(within(rows[0]).getByRole("button", { name: /newer\.pdf/ }), { key: "a", ctrlKey: true });
    expect(onToggleAllDocumentSelections).toHaveBeenCalledWith(["newer", "older"], true);
    expect(onTogglePacketSelection).toHaveBeenLastCalledWith("packet_1", true);
    fireEvent.click(within(rows[1]).getByRole("button", { name: /bundle\.pdf/ }));
    expect(onSelectPacket).toHaveBeenCalledWith("packet_1");
    // A search lists matching documents on their own, packet documents included.
    rerender(
      <DocumentContextList
        searchFilter={{ filter: { text: "bundle" }, summary: "text “bundle”" }}
        matchTotal={2}
        documents={[
          { job_id: "child_1", source_name: "bundle.pdf", status: "completed", parent_packet_id: "packet_1" },
          { job_id: "older", source_name: "older.pdf", status: "completed" },
        ]}
        onSelectDocument={vi.fn()}
        onLoadMoreDocuments={vi.fn()}
      />,
    );
    expect(within(container).getAllByRole("listitem")).toHaveLength(2);
    expect(within(container).getByRole("checkbox", { name: "Select document child_1" })).toBeTruthy();
  });

  it("selects every loaded document from the selection bar, and clears the selection once all are ticked", () => {
    const documents = [
      {
        job_id: "job_1",
        source_name: "invoice.pdf",
        source_mime_type: "application/pdf",
      },
      {
        job_id: "job_2",
        source_name: "receipt.pdf",
        source_mime_type: "application/pdf",
      },
    ];

    const onToggleAllDocumentSelections = vi.fn();
    const onClearSelection = vi.fn();

    const sharedProps = {
      documents,
      onClearSelection,
      selectedDocumentId: "job_1",
      hasMoreDocuments: false,
      isLoadingMoreDocuments: false,
      onSelectDocument: vi.fn(),
      onToggleAllDocumentSelections,
      onToggleDocumentSelection: vi.fn(),
      onLoadMoreDocuments: vi.fn(),
    };

    const { container, rerender } = render(<DocumentContextList {...sharedProps} selectedDocumentIds={["job_1"]} />);

    const selectAll = within(container).getByRole("checkbox", { name: "Select all documents" });

    expect(selectAll.indeterminate).toBe(true);
    expect(selectAll.checked).toBe(false);
    fireEvent.click(selectAll);
    expect(onToggleAllDocumentSelections).toHaveBeenLastCalledWith(["job_1", "job_2"], true);

    rerender(<DocumentContextList {...sharedProps} selectedDocumentIds={["job_1", "job_2"]} />);

    const allSelected = within(container).getByRole("checkbox", { name: "Select all documents" });

    expect(allSelected.checked).toBe(true);
    expect(allSelected.indeterminate).toBe(false);
    fireEvent.click(allSelected);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("locks individual and bulk selection during export", () => {
    const { container } = render(
      <DocumentContextList
        documents={[{ job_id: "job_1", source_name: "invoice.pdf" }]}
        selectedDocumentId="job_1"
        selectedDocumentIds={["job_1"]}
        hasMoreDocuments={false}
        isLoadingMoreDocuments={false}
        isExportingDocuments={true}
        onSelectDocument={vi.fn()}
        onToggleAllDocumentSelections={vi.fn()}
        onToggleDocumentSelection={vi.fn()}
        onLoadMoreDocuments={vi.fn()}
      />,
    );

    expect(within(container).getByRole("checkbox", { name: "Select all documents" }).disabled).toBe(true);
    expect(within(container).getByRole("button", { name: "Clear selection" }).disabled).toBe(true);
    expect(within(container).getByRole("checkbox", { name: "Select document job_1" }).disabled).toBe(true);
  });

});

const rowsOf = (count) =>
  Array.from({ length: count }, (_, i) => ({
    job_id: `job_${i}`,
    source_name: `invoice-${i}.pdf`,
    status: "completed",
    created_at: new Date(Date.UTC(2026, 9, 1, 0, 59 - i)).toISOString(),
  }));

// Holds the selection the way the document controller does, so the bar follows real ticks.
function SelectionHarness({ documents = rowsOf(3), hasMoreDocuments = false, onSelectAll, onClearSearch = vi.fn(), ...props }) {
  const [selected, setSelected] = useState([]);
  const [everything, setEverything] = useState(false);

  const toggle = (ids, on) => {
    setEverything(false);
    setSelected((current) => (on ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id))));
  };

  return (
    <DocumentContextList
      documents={documents}
      selectedDocumentIds={selected}
      selectedDocumentCount={everything ? props.totalDocuments : selected.length}
      hasMoreDocuments={!everything && hasMoreDocuments}
      onSelectDocument={vi.fn()}
      onLoadMoreDocuments={vi.fn()}
      onToggleDocumentSelection={(id, on) => toggle([id], on)}
      onToggleAllDocumentSelections={toggle}
      onClearSelection={() => {
        setEverything(false);
        setSelected([]);
      }}
      onSelectAllDocuments={async () => {
        await onSelectAll?.();
        setSelected(documents.map((job) => job.job_id));
        setEverything(true);
      }}
      onClearSearchFilter={onClearSearch}
      {...props}
    />
  );
}

const heading = () => screen.getByRole("heading", { name: "Documents" });

const selectionBar = () => screen.queryByRole("group", { name: "Selection" });

describe("DocumentContextList selection bar", () => {
  it("takes the heading's place on the first tick, keeps focus on the row, and gives the heading back when cleared", async () => {
    const user = userEvent.setup();
    render(<SelectionHarness />);

    expect(heading().className).toBe("");
    expect(selectionBar()).toBeNull();

    const row = screen.getByRole("checkbox", { name: "Select document job_1" });
    await user.click(row);

    expect(heading().className).toBe("sr-only");
    expect(within(selectionBar()).getByRole("status").textContent).toBe("1 selected");
    expect(document.activeElement).toBe(row);

    await user.click(screen.getByRole("checkbox", { name: "Select document job_2" }));
    expect(within(selectionBar()).getByRole("status").textContent).toBe("2 selected");

    await user.click(within(selectionBar()).getByRole("button", { name: "Clear selection" }));
    expect(selectionBar()).toBeNull();
    expect(heading().className).toBe("");
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Document list" }));
  });

  it("runs the tri-state checkbox from partly selected to all loaded rows to nothing", async () => {
    const user = userEvent.setup();
    render(<SelectionHarness />);

    await user.click(screen.getByRole("checkbox", { name: "Select document job_0" }));
    const all = () => screen.getByRole("checkbox", { name: "Select all documents" });
    expect(all().indeterminate).toBe(true);
    expect(all().checked).toBe(false);

    await user.click(all());
    expect(all().indeterminate).toBe(false);
    expect(all().checked).toBe(true);
    expect(within(selectionBar()).getByRole("status").textContent).toBe("3 selected");

    for (const id of ["job_0", "job_1", "job_2"])
      expect(screen.getByRole("checkbox", { name: `Select document ${id}` }).checked).toBe(true);

    await user.click(all());
    expect(selectionBar()).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select document job_0" }).checked).toBe(false);
  });

  it("offers Select all N for the workspace total and hides it once everything is selected", async () => {
    const user = userEvent.setup();
    let finish;
    const onSelectAll = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    render(<SelectionHarness hasMoreDocuments totalDocuments={1259} onSelectAll={onSelectAll} />);

    await user.click(screen.getByRole("checkbox", { name: "Select document job_0" }));
    await user.click(screen.getByRole("checkbox", { name: "Select document job_1" }));
    await user.click(screen.getByRole("checkbox", { name: "Select document job_2" }));
    // Every loaded row is ticked, but more documents haven't loaded yet.
    const selectAll = within(selectionBar()).getByRole("button", { name: "Select all 1,259" });
    await user.click(selectAll);
    expect(onSelectAll).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(within(selectionBar()).getByRole("status").textContent).toBe("1,259 selected");
    expect(within(selectionBar()).queryByRole("button", { name: /Select all/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "Select all documents" }));
  });

  it("selects every loaded row with ⌘A or Ctrl+A from the list", async () => {
    const user = userEvent.setup();
    render(<SelectionHarness />);

    await user.click(screen.getByRole("checkbox", { name: "Select document job_0" }));
    await user.keyboard("{Meta>}a{/Meta}");
    expect(within(selectionBar()).getByRole("status").textContent).toBe("3 selected");

    await user.keyboard("{Escape}");
    screen.getByRole("button", { name: /invoice-1\.pdf/ }).focus();
    await user.keyboard("{Control>}a{/Control}");
    expect(within(selectionBar()).getByRole("status").textContent).toBe("3 selected");
  });

  it("clears the selection with Esc in the list or the bar, and leaves Esc alone without one", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();

    render(
      <div onKeyDown={onKeyDown}>
        <SelectionHarness />
      </div>,
    );

    const row = screen.getByRole("checkbox", { name: "Select document job_0" });
    await user.click(row);
    await user.keyboard("{Escape}");
    expect(selectionBar()).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(onKeyDown).not.toHaveBeenCalled();

    // Without a selection Esc carries on to the rest of the page, such as the list drawer.
    await user.keyboard("{Escape}");
    expect(onKeyDown).toHaveBeenCalledTimes(1);

    await user.click(row);
    within(selectionBar()).getByRole("button", { name: "Clear selection" }).focus();
    await user.keyboard("{Escape}");
    expect(selectionBar()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Document list" }));
  });
});

describe("DocumentContextList search filter", () => {
  const search = { filter: { template_ids: ["t1"] }, summary: "Invoice › uploaded 5 Oct – 11 Oct" };

  it("shows the matches and the search in place of the heading, and Clear removes it", async () => {
    const user = userEvent.setup();
    const onClearSearch = vi.fn();
    render(<SelectionHarness searchFilter={search} matchTotal={6} onClearSearch={onClearSearch} />);

    const bar = screen.getByRole("group", { name: "Search filter" });
    expect(heading().className).toBe("sr-only");
    expect(within(bar).getByRole("status").textContent).toBe("6 matches");
    expect(within(bar).getByTitle(search.summary).textContent).toBe(search.summary);

    await user.click(within(bar).getByRole("button", { name: "Clear search" }));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Document list" }));
  });

  it("caps the match count the way the search does", () => {
    render(<SelectionHarness searchFilter={search} matchTotal={10000} matchTotalCapped />);

    expect(within(screen.getByRole("group", { name: "Search filter" })).getByRole("status").textContent).toBe(
      "10,000+ matches",
    );
  });

  it("swaps to the selection bar while rows are ticked, offers every match, and Esc never clears the search", async () => {
    const user = userEvent.setup();
    const onClearSearch = vi.fn();
    render(<SelectionHarness searchFilter={search} matchTotal={60} hasMoreDocuments onClearSearch={onClearSearch} />);

    await user.click(screen.getByRole("checkbox", { name: "Select document job_0" }));
    expect(screen.queryByRole("group", { name: "Search filter" })).toBeNull();
    expect(within(selectionBar()).getByRole("button", { name: "Select all 60" })).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(selectionBar()).toBeNull();
    expect(screen.getByRole("group", { name: "Search filter" })).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("group", { name: "Search filter" })).toBeTruthy();
    expect(onClearSearch).not.toHaveBeenCalled();
  });
});
