import React, { useState } from "react";
import { ChartTip, FigureStrip, StageLegend, StageTipRows } from "./costShared.jsx";
import { Segmented } from "../../ui/Tabs.jsx";
import { EmptyState } from "../../ui/States.jsx";
import { DataTable } from "../../ui/DataTable.jsx";
import { costLabel, niceMax, percent, plural, shortDate, usd, weightedQuantile } from "./costFormat.js";
import { useChartTip, useWidth } from "./costHooks.js";

const STACK = ["split", "auto_template", "extraction"];

const PAD = { left: 56, right: 12 };

function topRounded(x, y, width, height, radius) {
  const r = Math.min(radius, height, width / 2);

  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

const bucketLabel = (bucket, unit) =>
  unit === "hour" ? `${String(bucket.hour).padStart(2, "0")}:00` : shortDate(bucket.date);

/** Exact figures use bucket summaries; only the distribution is sampled. */
export function OverviewTab({ data }) {
  const { totals: metrics, previous, range, samples, sampled } = data;
  const totals = metrics.costs;

  const buckets = data.buckets.map((bucket) => ({
    ...bucket,
    unit: bucket.fullyCostedDocuments ? bucket.fullyCostedAmount / bucket.fullyCostedDocuments : null,
    partial: !bucket.costs.total.complete,
  }));

  const comparable =
    !data.updating && totals.total.complete && previous?.costs.total.complete && previous.costs.total.amount > 0;

  const delta = comparable ? (totals.total.amount - previous.costs.total.amount) / previous.costs.total.amount : null;

  const figures = [
    {
      hero: true,
      label: "Total spend",
      value: costLabel(totals.total, "—"),
      trend: buckets.map((bucket) => bucket.costs.total.amount || 0),
      chip: delta === null ? null : `${delta >= 0 ? "▲" : "▼"} ${percent(Math.abs(delta))}`,
      detail: delta === null ? "No complete earlier period to compare" : "vs previous period",
    },
    { label: "Documents", value: metrics.documents.toLocaleString(), detail: plural(metrics.pages, "page") },
    {
      label: "Per document",
      value: usd(metrics.fullyCostedDocuments ? metrics.fullyCostedAmount / metrics.fullyCostedDocuments : null),
      detail: "Fully costed documents",
    },
    {
      label: "Per page",
      value: usd(metrics.fullyCostedPages ? metrics.fullyCostedAmount / metrics.fullyCostedPages : null),
      detail: "Fully costed document pages",
    },
    {
      label: range.unit === "hour" ? "Per hour" : "Per day",
      value: costLabel(
        { ...totals.total, amount: totals.total.amount === null ? null : totals.total.amount / buckets.length },
        "—",
      ),
      detail: `Average over ${plural(buckets.length, range.unit)}`,
    },
  ];

  return (
    <div className="cp-tab-panel">
      <FigureStrip figures={figures} label="Headline figures" />
      <SpendCharts buckets={buckets} unit={range.unit} totals={totals} />
      <CostSpread documents={samples} sampled={sampled} population={metrics.fullyCostedDocuments} />
    </div>
  );
}

function SpendCharts({ buckets, unit, totals }) {
  const [ref, width] = useWidth(720);
  const { tip, show, hide } = useChartTip();
  const [view, setView] = useState("chart");
  const hasSpend = buckets.some((bucket) => bucket.documents > 0 || bucket.costs.total.amount > 0);
  const plotWidth = Math.max(240, width - PAD.left - PAD.right);
  const band = plotWidth / buckets.length;
  const barWidth = Math.min(24, band * 0.62);
  const x = (index) => PAD.left + band * index + band / 2;
  const columnMax = niceMax(Math.max(...buckets.map((bucket) => bucket.costs.total.amount || 0)));
  const unitMax = niceMax(Math.max(...buckets.map((bucket) => bucket.unit || 0)));
  const columnHeight = 170;
  const lineHeight = 90;
  const label = (bucket) => bucketLabel(bucket, unit);

  const tipFor = (bucket) => (
    <>
      <StageTipRows
        costs={bucket.costs}
        title={unit === "hour" ? `${shortDate(bucket.date)}, ${label(bucket)}` : label(bucket)}
        meta={plural(bucket.documents, "document")}
      />
      {bucket.unit !== null ? <p className="cp-tip-foot">Average {usd(bucket.unit)} per document</p> : null}
      {bucket.partial ? <p className="cp-tip-foot">Includes calls without a reported cost.</p> : null}
    </>
  );

  const bands = (height) =>
    buckets.map((bucket, index) => (
      <rect
        key={bucket.key}
        className="cp-band"
        x={PAD.left + band * index}
        y={0}
        width={band}
        height={height}
        tabIndex={0}
        aria-label={`${label(bucket)}: ${costLabel(bucket.costs.total, "cost unavailable")}, ${plural(bucket.documents, "document")}`}
        onMouseMove={(event) => show(event, tipFor(bucket))}
        onMouseLeave={hide}
        onFocus={(event) => show(event, tipFor(bucket))}
        onBlur={hide}
      />
    ));

  const tickEvery = Math.ceil(buckets.length / Math.max(2, Math.floor(plotWidth / 64)));

  const xTicks = (y) =>
    buckets.map((bucket, index) =>
      index % tickEvery === 0 ? (
        <text key={bucket.key} x={x(index)} y={y} textAnchor="middle" className="cp-axis-text">
          {label(bucket)}
        </text>
      ) : null,
    );

  const grid = (height, max, steps) =>
    steps.map((step) => (
      <g key={step}>
        <line
          className="cp-grid"
          x1={PAD.left}
          x2={width - PAD.right}
          y1={height - height * step + 0.5}
          y2={height - height * step + 0.5}
        />
        <text className="cp-axis-text" x={PAD.left - 8} y={height - height * step + 4} textAnchor="end">
          {usd(max * step)}
        </text>
      </g>
    ));

  return (
    <section className="cp-section" aria-label="Spend over time">
      <div className="studio-section-heading">
        <div>
          <h2>Spend over time</h2>
          <p>{unit === "hour" ? "Hourly" : "Daily"} model cost, stacked by processing stage.</p>
        </div>
        {hasSpend ? (
          <Segmented
            label="Display"
            value={view}
            onChange={setView}
            items={[
              { value: "chart", label: "Chart" },
              { value: "table", label: "Table" },
            ]}
          />
        ) : null}
      </div>
      {hasSpend ? <StageLegend costs={totals} /> : null}
      {!hasSpend ? (
        <EmptyState message="No costs in this range" variant="panel" />
      ) : view === "chart" ? (
        <div ref={ref} className="cp-chart">
          <svg width={width} height={columnHeight + 28} role="group" aria-label="Spend by stage">
            {grid(columnHeight, columnMax, [0, 0.5, 1])}
            {buckets.map((bucket, index) => {
              let top = columnHeight;
              const segments = STACK.filter((stage) => bucket.costs[stage].amount > 0);

              return (
                <g key={bucket.key} aria-hidden="true">
                  {segments.map((stage, segmentIndex) => {
                    const height = (bucket.costs[stage].amount / columnMax) * columnHeight;
                    top -= height;
                    const drawn = Math.max(0, height - (segmentIndex ? Math.min(2, height * 0.1) : 0));

                    return segmentIndex === segments.length - 1 ? (
                      <path
                        key={stage}
                        className={`cp-stage-${stage}`}
                        d={topRounded(x(index) - barWidth / 2, top, barWidth, drawn, 4)}
                      />
                    ) : (
                      <rect
                        key={stage}
                        className={`cp-stage-${stage}`}
                        x={x(index) - barWidth / 2}
                        y={top}
                        width={barWidth}
                        height={drawn}
                      />
                    );
                  })}
                  {bucket.partial ? (
                    <circle className="cp-partial-dot" cx={x(index)} cy={columnHeight + 7} r={2.5} />
                  ) : null}
                </g>
              );
            })}
            {xTicks(columnHeight + 24)}
            {bands(columnHeight + 12)}
          </svg>
          <div className="cp-subchart-head">
            <h3>Average cost per document</h3>
            <span>Finished, fully costed documents, including their split shares.</span>
          </div>
          <svg width={width} height={lineHeight + 8} role="group" aria-label="Average cost per document">
            {grid(lineHeight, unitMax, [0, 1])}
            <path
              className="cp-line"
              d={buckets.reduce(
                (path, bucket, index) =>
                  bucket.unit === null
                    ? path
                    : `${path}${path && buckets[index - 1]?.unit != null ? "L" : "M"}${x(index)},${lineHeight - (bucket.unit / unitMax) * lineHeight}`,
                "",
              )}
            />
            {buckets.map((bucket, index) =>
              bucket.unit === null ? null : (
                <circle
                  key={bucket.key}
                  className="cp-dot"
                  cx={x(index)}
                  cy={lineHeight - (bucket.unit / unitMax) * lineHeight}
                  r={4}
                  aria-hidden="true"
                />
              ),
            )}
            {bands(lineHeight + 8)}
          </svg>
        </div>
      ) : (
        <div className="cp-table-scroll" ref={ref}>
          <DataTable className="cp-table">
            <thead>
              <tr>
                <th>{unit === "hour" ? "Hour" : "Date"}</th>
                <th className="cp-num">Documents</th>
                <th className="cp-num">Smart split</th>
                <th className="cp-num">Auto template</th>
                <th className="cp-num">Extraction</th>
                <th className="cp-num">Total</th>
                <th className="cp-num">Per document</th>
              </tr>
            </thead>
            <tbody>
              {[...buckets].reverse().map((bucket) => (
                <tr key={bucket.key}>
                  <td>{unit === "hour" ? `${shortDate(bucket.date)}, ${label(bucket)}` : label(bucket)}</td>
                  <td className="cp-num">{bucket.documents}</td>
                  {STACK.map((stage) => (
                    <td key={stage} className="cp-num">
                      {costLabel(bucket.costs[stage], "—")}
                    </td>
                  ))}
                  <td className="cp-num cp-strong">{costLabel(bucket.costs.total, "—")}</td>
                  <td className="cp-num">{usd(bucket.unit)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}
      <ChartTip tip={tip} />
    </section>
  );
}

const ROW = 46;

const SPREAD_PAD = { left: 118, right: 16, top: 8, bottom: 26 };

const OUTLIER = 2.5;

function jitter(id) {
  let hash = 0;

  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;

  return ((hash >>> 0) % 1000) / 1000 - 0.5;
}

function CostSpread({ documents, sampled, population }) {
  const [ref, width] = useWidth(720);
  const { tip, show, hide } = useChartTip();
  const [metric, setMetric] = useState("document");
  const value = (item) => (metric === "page" ? item.costs.total.amount / item.pages : item.costs.total.amount);
  const priced = documents;
  const templates = new Map();

  for (const item of priced) {
    const key = item.templateId ?? "unassigned";

    if (!templates.has(key)) templates.set(key, { key, label: item.template, members: [] });
    templates.get(key).members.push(item);
  }

  const ranked = [...templates.values()].sort(
    (a, b) =>
      b.members.reduce((sum, item) => sum + item.weight, 0) - a.members.reduce((sum, item) => sum + item.weight, 0),
  );

  const visible =
    ranked.length > 12
      ? [
          ...ranked.slice(0, 11),
          { key: "other", label: "Other templates", members: ranked.slice(11).flatMap((group) => group.members) },
        ]
      : ranked;

  const groups = visible.map((group) => ({
    ...group,
    middle: weightedQuantile(group.members, value, 0.5),
    low: weightedQuantile(group.members, value, 0.25),
    high: weightedQuantile(group.members, value, 0.75),
    p90: weightedQuantile(group.members, value, 0.9),
  }));

  const max = niceMax(Math.max(...priced.map(value), 0));
  const plotWidth = Math.max(200, width - SPREAD_PAD.left - SPREAD_PAD.right);
  const x = (amount) => SPREAD_PAD.left + (amount / max) * plotWidth;
  const height = SPREAD_PAD.top + groups.length * ROW + SPREAD_PAD.bottom;

  const tipFor = (item) => (
    <>
      <StageTipRows costs={item.costs} title={item.name} meta={`${item.template} · ${plural(item.pages, "page")}`} />
      {metric === "page" ? <p className="cp-tip-foot">{usd(value(item))} per page</p> : null}
      {item.retried ? <p className="cp-tip-foot">Extraction was reassessed. The retries are included.</p> : null}
    </>
  );

  return (
    <section className="cp-section" aria-label="Cost per document">
      <div className="studio-section-heading">
        <div>
          <h2>Cost per {metric === "page" ? "page" : "document"}</h2>
          <p>
            Each dot is one fully costed document, grouped by template. The band is the middle half and the tick is the
            median.
          </p>
        </div>
        <div className="cp-controls">
          <Segmented
            label="Measure"
            value={metric}
            onChange={setMetric}
            items={[
              { value: "document", label: "Per document" },
              { value: "page", label: "Per page" },
            ]}
          />
        </div>
      </div>
      {sampled ? (
        <p className="cp-muted">
          Sample of {documents.length} of {population.toLocaleString()} documents. Percentiles are estimates weighted by
          upload-period volume.
        </p>
      ) : null}
      {groups.length ? (
        <>
          <div ref={ref} className="cp-chart">
            <svg width={width} height={height} role="group" aria-label={`Cost per ${metric} by template`}>
              {[0, 0.25, 0.5, 0.75, 1].map((step) => (
                <g key={step}>
                  <line
                    className="cp-grid"
                    x1={x(max * step) + 0.5}
                    x2={x(max * step) + 0.5}
                    y1={SPREAD_PAD.top}
                    y2={height - SPREAD_PAD.bottom}
                  />
                  <text
                    className="cp-axis-text"
                    x={x(max * step)}
                    y={height - 8}
                    textAnchor={step === 1 ? "end" : "middle"}
                  >
                    {usd(max * step)}
                  </text>
                </g>
              ))}
              {groups.map((group, index) => {
                const middleY = SPREAD_PAD.top + index * ROW + ROW / 2;

                const flagged = group.members
                  .filter((item) => value(item) > group.middle * OUTLIER)
                  .sort((a, b) => value(b) - value(a))[0];

                return (
                  <g key={group.key}>
                    <text className="cp-row-label" x={SPREAD_PAD.left - 12} y={middleY + 4} textAnchor="end">
                      {group.label.length > 17 ? `${group.label.slice(0, 16)}…` : group.label}
                      <title>{group.label}</title>
                    </text>
                    <rect
                      className="cp-iqr"
                      x={x(group.low)}
                      y={middleY - 13}
                      width={Math.max(2, x(group.high) - x(group.low))}
                      height={26}
                      rx={3}
                    />
                    <line
                      className="cp-median"
                      x1={x(group.middle)}
                      x2={x(group.middle)}
                      y1={middleY - 15}
                      y2={middleY + 15}
                    />
                    {group.members.map((item) => (
                      <circle
                        key={item.id}
                        className={`cp-spread-dot${value(item) > group.middle * OUTLIER ? " cp-spread-outlier" : ""}`}
                        cx={x(value(item))}
                        cy={middleY + jitter(item.id) * 20}
                        r={4}
                        tabIndex={0}
                        aria-label={`${item.name}: ${usd(value(item))}`}
                        onMouseMove={(event) => show(event, tipFor(item))}
                        onMouseLeave={hide}
                        onFocus={(event) => show(event, tipFor(item))}
                        onBlur={hide}
                      />
                    ))}
                    {flagged ? (
                      <text
                        className="cp-dot-label"
                        x={x(value(flagged)) + (x(value(flagged)) + 130 > SPREAD_PAD.left + plotWidth ? -10 : 10)}
                        y={middleY + jitter(flagged.id) * 20 + 3.5}
                        textAnchor={x(value(flagged)) + 130 > SPREAD_PAD.left + plotWidth ? "end" : "start"}
                      >
                        {flagged.retried ? "Reassessed" : "Outlier"} · {usd(value(flagged))}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          </div>
          <DataTable className="cp-table cp-spread-table">
            <thead>
              <tr>
                <th>Template</th>
                <th className="cp-num">{sampled ? "Sample documents" : "Documents"}</th>
                <th className="cp-num">{sampled ? "Est. median" : "Median"}</th>
                <th className="cp-num">{sampled ? "Est. 90th percentile" : "90th percentile"}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.key}>
                  <td>{group.label}</td>
                  <td className="cp-num">{group.members.length}</td>
                  <td className="cp-num">{usd(group.middle)}</td>
                  <td className="cp-num">{usd(group.p90)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </>
      ) : (
        <EmptyState message="No priced documents in this range" variant="inline" />
      )}
      <ChartTip tip={tip} />
    </section>
  );
}
