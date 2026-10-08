import { statusLabel } from "../../../lib/status.js";
import React, { useEffect, useState } from "react";
import { allocateCost, costAmount } from "../../../../../shared/processingCosts.ts";
import { ChartTip, FigureStrip, StageBar, StageLegend, StageTipRows } from "./costShared.jsx";
import { costLabel, percent, plural, shortDate } from "./costFormat.js";
import { useChartTip } from "./costHooks.js";
import { useCostResource } from "./useCostResource.js";
import { CostResourceStatus } from "./WorkspaceCosts.jsx";
import { EmptyState } from "../../ui/States.jsx";
import { Pager } from "../../ui/Pager.jsx";
import { Badge } from "../../ui/Status.jsx";
import { DataTable } from "../../ui/DataTable.jsx";
import { Segmented } from "../../ui/Tabs.jsx";

const STACK = ["split", "auto_template", "extraction"];

const perPage = (item) =>
  item.pages && item.costs.total.amount !== null ? item.costs.total.amount / item.pages : null;

const isMulti = (item) => item.documentCount > 1;

const documentsOf = (item) => item.children || [item];

const time = (value) =>
  new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

const usedCalls = (cost) => cost.reported_calls + cost.unreported_calls;

/** Every upload in range in one list: split packets and single documents, with how each cost divides. */
export function DocumentsTab({ request, base, queryString }) {
  const [kind, setKind] = useState("all");
  const [sort, setSort] = useState("recent");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);

    return () => clearTimeout(timer);
  }, [query]);
  const filter = new URLSearchParams({ sort, kind, search }).toString();

  return (
    <div className="cp-tab-panel">
      <div className="cp-document-filters">
        <input
          type="search"
          aria-label="Search documents"
          placeholder="Document or template"
          maxLength={200}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Segmented
          label="Document type"
          value={kind}
          onChange={setKind}
          items={[
            { value: "all", label: "All" },
            { value: "multi", label: "Split PDFs" },
            { value: "single", label: "Single documents" },
          ]}
        />
        <label className="cp-sort-select">
          Sort
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="recent">Recent</option>
            <option value="total">Total</option>
            <option value="perPage">Per page</option>
          </select>
        </label>
      </div>
      <DocumentResults
        key={filter}
        request={request}
        base={base}
        queryString={`${queryString}&${filter}`}
        sort={sort}
      />
    </div>
  );
}

function DocumentResults({ request, base, queryString, sort }) {
  const [cursors, setCursors] = useState([null]);
  const [selectedId, setSelectedId] = useState(null);
  const cursor = cursors.at(-1);

  const resource = useCostResource(
    request,
    `${base}/documents?${queryString}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );

  const items = resource.data?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) || items[0];
  const detail = useCostResource(request, selected ? `${base}/documents/${encodeURIComponent(selected.id)}` : null);
  const max = Math.max(...items.map((item) => item.costs.total.amount || 0), 0);

  return (
    <>
      <CostResourceStatus resource={resource} />
      <div className="cp-documents">
        <section className="cp-document-list" aria-label="Documents">
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === selected?.id ? "cp-list-item active" : "cp-list-item"}
                  aria-current={item.id === selected?.id ? "true" : undefined}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="cp-list-name">
                    {item.name}
                    <small>
                      {shortDate(item.created_at)} {time(item.created_at)} UTC ·{" "}
                      {plural(item.documentCount, "document")}
                    </small>
                  </span>
                  <strong>
                    {sort === "perPage"
                      ? `${costLabel({ ...item.costs.total, amount: perPage(item) }, "—")}/pg`
                      : costLabel(item.costs.total)}
                  </strong>
                  <StageBar costs={item.costs} max={max} label={item.name} />
                  {item.deleted ? <Badge className="cp-list-deleted">Deleted</Badge> : null}
                </button>
              </li>
            ))}
          </ul>
          {!items.length && resource.data ? (
            <EmptyState
              variant="inline"
              message={
                resource.data.cursor
                  ? "No matches yet. Load more to keep searching."
                  : "Nothing matches this range and filter."
              }
            />
          ) : null}
          <Pager
            className="cp-pagination"
            label={`Page ${cursors.length}`}
            hasPrevious={cursors.length > 1}
            hasNext={Boolean(resource.data?.cursor)}
            onPrevious={() => setCursors((value) => value.slice(0, -1))}
            onNext={() => setCursors((value) => [...value, resource.data.cursor])}
            disabled={resource.loading}
          />
        </section>
        <div>
          <CostResourceStatus resource={detail} />
          {detail.data ? (
            <CostAnatomy key={detail.data.id} item={detail.data} />
          ) : !detail.loading && !detail.error ? (
            <p className="cp-muted">Choose a document to see its costs.</p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function CostAnatomy({ item }) {
  const [focus, setFocus] = useState(null);
  const { tip, show, hide } = useChartTip();
  const total = item.costs.total.amount || 0;
  const split = item.costs.split;
  const excluded = item.costs.excluded_pages_cost;
  const multi = isMulti(item);

  const parts = [
    ...documentsOf(item).map((child) => ({
      id: child.id,
      label: child.name,
      sub: child.template,
      pages: child.pages,
      pageNumbers: child.pageNumbers,
      costs: child.costs,
      deleted: child.deleted,
    })),
    ...(item.excludedPages
      ? [
          {
            id: "excluded",
            label: "Excluded pages",
            sub: "Split overhead",
            pages: item.excludedPages,
            pageNumbers: item.excludedPageNumbers,
            costs: { split: excluded, auto_template: costAmount(), extraction: costAmount(), total: excluded },
            overhead: true,
          },
        ]
      : []),
  ];

  const assigned = new Set(parts.flatMap((part) => part.pageNumbers));
  const unassigned = item.pageNumbers.filter((page) => !assigned.has(page));

  if (unassigned.length) {
    const share = allocateCost(split, unassigned.length, item.pages);
    parts.push({
      id: "unassigned",
      label: "Unallocated pages",
      sub: "Awaiting document boundaries",
      pages: unassigned.length,
      pageNumbers: unassigned,
      costs: { split: share, auto_template: costAmount(), extraction: costAmount(), total: share },
      overhead: true,
    });
  }

  const pageCells = parts
    .flatMap((part) => part.pageNumbers.map((number) => ({ part, number })))
    .sort((a, b) => a.number - b.number);

  const example = documentsOf(item)[0];

  const tipFor = (part) => (
    <StageTipRows
      costs={part.costs}
      title={part.label}
      meta={`${plural(part.pages, "page")} · ${percent((part.costs.total.amount || 0) / (total || 1))} of total${part.deleted ? " · deleted" : ""}`}
    />
  );

  const events = (part) => ({
    onMouseEnter: () => setFocus(part.id),
    onMouseLeave: () => {
      setFocus(null);
      hide();
    },
    onFocus: (event) => {
      setFocus(part.id);
      show(event, tipFor(part));
    },
    onBlur: () => {
      setFocus(null);
      hide();
    },
    onMouseMove: (event) => show(event, tipFor(part)),
  });

  const dim = (part) => (focus && focus !== part.id ? " cp-dim" : "");

  const figures = [
    { hero: true, label: "Total", value: costLabel(item.costs.total) },
    { label: "Per page", value: costLabel({ ...item.costs.total, amount: perPage(item) }, "—") },
    { label: "Smart split", value: usedCalls(split) ? costLabel(split) : "Not used" },
    { label: multi ? "Documents" : "Pages", value: multi ? String(item.children.length) : String(item.pages) },
  ];

  return (
    <section className="cp-anatomy" aria-label={`${item.name} cost`}>
      <header className="cp-anatomy-head">
        <p className="studio-eyebrow">
          {multi
            ? `${plural(item.children.length, "document")} · ${plural(item.pages, "page")}`
            : `${example?.template ?? (item.excludedPages === item.pages ? "No documents to extract" : "Awaiting document boundaries")} · ${plural(item.pages, "page")}`}
        </p>
        <h3 title={item.name}>
          {item.name}
          {item.deleted ? <Badge>Deleted</Badge> : null}
        </h3>
        <p className="cp-anatomy-meta">
          {shortDate(item.created_at)} {time(item.created_at)} UTC · {statusLabel(item.status)}
        </p>
      </header>
      <FigureStrip compact figures={figures} label={`${item.name} figures`} />

      <h4>{multi || item.excludedPages ? "Where the cost goes" : "Cost by stage"}</h4>
      <div className="cp-anatomy-bar" role="list" aria-label="Cost by document">
        {parts.map((part) => (
          <div
            key={part.id}
            role="listitem"
            tabIndex={0}
            className={`cp-anatomy-part${part.overhead ? " cp-anatomy-overhead" : ""}${part.deleted ? " cp-anatomy-deleted" : ""}${dim(part)}`}
            style={{ flexGrow: 1000 * Math.max((part.costs.total.amount || 0) / (total || 1), 0.03) }}
            aria-label={`${part.label}: ${costLabel(part.costs.total)}`}
            {...events(part)}
          >
            <span className="cp-anatomy-stack">
              {STACK.flatMap((stage) =>
                part.costs[stage].amount > 0
                  ? [
                      <span
                        key={stage}
                        className={`cp-stage-${stage}`}
                        style={{ flexGrow: (1000 * part.costs[stage].amount) / part.costs.total.amount }}
                      />,
                    ]
                  : [],
              )}
            </span>
            {parts.length > 1 ? (
              <span className="cp-anatomy-label">
                {part.label}
                <small>{costLabel(part.costs.total)}</small>
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <StageLegend costs={item.costs} />

      {item.pages > 1 ? (
        <>
          <h4>
            Pages{" "}
            {multi || item.excludedPages ? (
              <span className="cp-muted">· the split cost is shared by page count</span>
            ) : null}
          </h4>
          <div className="cp-pages" role="list" aria-label="Pages by document">
            {pageCells.map((cell, index) => (
              <span
                key={cell.number}
                role="listitem"
                className={`cp-page${cell.part.overhead ? " cp-page-excluded" : ""}${dim(cell.part)}${cell.part.id !== pageCells[index + 1]?.part.id ? " cp-page-last" : ""}`}
                title={`Page ${cell.number} · ${cell.part.label}`}
                onMouseEnter={() => setFocus(cell.part.id)}
                onMouseLeave={() => setFocus(null)}
              >
                {cell.number}
              </span>
            ))}
          </div>
        </>
      ) : null}

      {parts.length > 1 ? (
        <DataTable className="cp-table cp-anatomy-table">
          <thead>
            <tr>
              <th>Document</th>
              <th className="cp-num">Pages</th>
              <th className="cp-num">Split share</th>
              <th className="cp-num">Auto template</th>
              <th className="cp-num">Extraction</th>
              <th className="cp-num">Total</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((part) => (
              <tr
                key={part.id}
                className={focus === part.id ? "cp-selected-row" : ""}
                onMouseEnter={() => setFocus(part.id)}
                onMouseLeave={() => setFocus(null)}
              >
                <td>
                  {part.label} <span className="cp-muted">{part.sub}</span>
                  {part.deleted ? <Badge className="cp-row-chip">Deleted</Badge> : null}
                </td>
                <td className="cp-num">
                  {part.pages} <span className="cp-muted">/ {item.pages}</span>
                </td>
                <td className="cp-num">{usedCalls(part.costs.split) ? costLabel(part.costs.split) : "—"}</td>
                <td className="cp-num">{part.overhead ? "—" : costLabel(part.costs.auto_template, "—")}</td>
                <td className="cp-num">{part.overhead ? "—" : costLabel(part.costs.extraction, "—")}</td>
                <td className="cp-num cp-strong">{costLabel(part.costs.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="cp-num">{item.pages}</td>
              <td className="cp-num">{costLabel(split)}</td>
              <td className="cp-num">{costLabel(item.costs.auto_template)}</td>
              <td className="cp-num">{costLabel(item.costs.extraction)}</td>
              <td className="cp-num cp-strong">{costLabel(item.costs.total)}</td>
            </tr>
          </tfoot>
        </DataTable>
      ) : null}
      {item.deleted || parts.some((part) => part.deleted) ? (
        <p className="cp-note">
          Deleted documents keep their cost here. That cost was incurred and still counts in Workspace totals.
        </p>
      ) : null}
      {item.costs.total.amount === null ? (
        <p className="cp-note">This work predates cost tracking, or the endpoint did not report a cost.</p>
      ) : !item.costs.total.complete ? (
        <p className="cp-note">+ marks a known subtotal. Some calls did not report a cost.</p>
      ) : null}
      <ChartTip tip={tip} />
    </section>
  );
}
