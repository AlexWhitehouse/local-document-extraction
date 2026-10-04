import React, { useMemo, useState } from "react";
import { MODEL_CHANGE, TEMPLATES } from "./sampleCosts.js";
import { ChartTip, FigureStrip, Segmented, StageLegend, StageTipRows } from "./costShared.jsx";
import { costLabel, median, niceMax, percent, plural, quantile, shortDate, sumItemCosts, usd } from "./costFormat.js";
import { useChartTip, useWidth } from "./costHooks.js";

const STACK = ["split", "auto_template", "extraction"];
const PAD = { left: 56, right: 12 };

function topRounded(x, y, width, height, radius) {
  const r = Math.min(radius, height, width / 2);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

const bucketLabel = (bucket, unit) => unit === "hour" ? `${String(bucket.hour).padStart(2, "0")}:00` : shortDate(bucket.date);
const pricedAverage = documents => {
  const priced = documents.filter(item => item.costs.total.amount !== null);
  return priced.length ? priced.reduce((sum, item) => sum + item.costs.total.amount, 0) / priced.length : null;
};

/** Workspace-level spend: headline figures, spend over time, and unit cost spread. */
export function OverviewTab({ sample, range }) {
  const items = [...sample.packets, ...sample.direct];
  const current = items.filter(range.contains);
  const previous = range.previous ? items.filter(item => item.created_at >= range.previous.start && item.created_at < range.previous.end) : null;
  const documents = current.flatMap(item => item.children || [item]);
  const totals = sumItemCosts(current);
  const previousTotal = previous ? sumItemCosts(previous).total.amount : null;
  const delta = previousTotal ? (totals.total.amount - previousTotal) / previousTotal : null;
  const unpriced = documents.filter(item => !item.costs.total.complete).length;
  const pricedDocuments = documents.filter(item => item.costs.total.amount !== null);
  const pricedPages = pricedDocuments.reduce((sum, item) => sum + item.pages, 0);
  const pages = documents.reduce((sum, item) => sum + item.pages, 0);
  const buckets = range.buckets.map(bucket => {
    const bucketItems = current.filter(item => range.bucketOf(item) === bucket.key);
    const bucketDocuments = bucketItems.flatMap(item => item.children || [item]);
    return { ...bucket, items: bucketItems, documents: bucketDocuments, costs: sumItemCosts(bucketItems), unit: pricedAverage(bucketDocuments), partial: bucketItems.some(item => !item.costs.total.complete) };
  });
  const perBucket = (totals.total.amount || 0) / buckets.length;
  const figures = [
    { hero: true, label: "Total spend", value: costLabel(totals.total, "—"), trend: buckets.map(bucket => bucket.costs.total.amount || 0),
      chip: delta === null ? null : `${delta >= 0 ? "▲" : "▼"} ${percent(Math.abs(delta))}`,
      detail: delta === null ? "No earlier period to compare" : "vs previous period" },
    { label: "Documents", value: String(documents.length), detail: plural(pages, "page") },
    { label: "Per document", value: usd(pricedAverage(documents)), detail: "Includes split share" },
    { label: "Per page", value: usd(pricedPages ? pricedDocuments.reduce((sum, item) => sum + item.costs.total.amount, 0) / pricedPages : null), detail: "Across all pages" },
    { label: range.unit === "hour" ? "Per hour" : "Per day", value: usd(perBucket), detail: `Average over ${plural(buckets.length, range.unit)}` },
  ];

  return <div className="cp-tab-panel" role="tabpanel" aria-label="Overview">
    <FigureStrip figures={figures} label="Headline figures" />
    {unpriced ? <p className="cp-footnote"><i className="cp-partial-dot-key" aria-hidden="true" /> {plural(unpriced, "document")} in this range did not report every call cost. Totals with + are known subtotals.</p> : null}
    <SpendCharts buckets={buckets} unit={range.unit} totals={totals} />
    <CostSpread documents={documents} />
  </div>;
}

function SpendCharts({ buckets, unit, totals }) {
  const [ref, width] = useWidth(720);
  const { tip, show, hide } = useChartTip();
  const [view, setView] = useState("chart");
  const plotWidth = Math.max(240, width - PAD.left - PAD.right);
  const band = plotWidth / buckets.length;
  const barWidth = Math.min(24, band * 0.62);
  const x = index => PAD.left + band * index + band / 2;
  const columnMax = niceMax(Math.max(...buckets.map(bucket => bucket.costs.total.amount || 0)));
  const unitMax = niceMax(Math.max(...buckets.map(bucket => bucket.unit || 0)));
  const columnHeight = 170;
  const lineHeight = 90;
  const changeIndex = unit === "day" ? buckets.findIndex(bucket => bucket.date >= MODEL_CHANGE.date) : -1;
  const label = bucket => bucketLabel(bucket, unit);
  const tipFor = bucket => <>
    <StageTipRows costs={bucket.costs} title={unit === "hour" ? `${shortDate(bucket.date)}, ${label(bucket)}` : label(bucket)} meta={plural(bucket.documents.length, "document")} />
    {bucket.unit !== null ? <p className="cp-tip-foot">Average {usd(bucket.unit)} per document</p> : null}
    {bucket.partial ? <p className="cp-tip-foot">Includes calls without a reported cost.</p> : null}
  </>;
  const bands = (height) => buckets.map((bucket, index) => <rect key={bucket.key} className="cp-band" x={PAD.left + band * index} y={0} width={band} height={height} tabIndex={0}
    aria-label={`${label(bucket)}: ${costLabel(bucket.costs.total, "no spend")}, ${plural(bucket.documents.length, "document")}`}
    onMouseMove={event => show(event, tipFor(bucket))} onMouseLeave={hide} onFocus={event => show(event, tipFor(bucket))} onBlur={hide} />);
  const tickEvery = Math.ceil(buckets.length / Math.max(2, Math.floor(plotWidth / 64)));
  const xTicks = y => buckets.map((bucket, index) => index % tickEvery === 0 ? <text key={bucket.key} x={x(index)} y={y} textAnchor="middle" className="cp-axis-text">{label(bucket)}</text> : null);
  const grid = (height, max, steps) => steps.map(step => <g key={step}>
    <line className="cp-grid" x1={PAD.left} x2={width - PAD.right} y1={height - height * step + 0.5} y2={height - height * step + 0.5} />
    <text className="cp-axis-text" x={PAD.left - 8} y={height - height * step + 4} textAnchor="end">{usd(max * step)}</text>
  </g>);
  const modelRule = (height, withLabel) => changeIndex > 0 ? <g className="cp-annotation" aria-hidden="true">
    <line x1={PAD.left + band * changeIndex} x2={PAD.left + band * changeIndex} y1={0} y2={height} />
    {withLabel ? <text x={PAD.left + band * changeIndex + 6} y={10}>Model → {MODEL_CHANGE.to}</text> : null}
  </g> : null;

  return <section className="cp-section" aria-label="Spend over time">
    <div className="studio-section-heading">
      <div><h2>Spend over time</h2><p>{unit === "hour" ? "Hourly" : "Daily"} model cost, stacked by processing stage.</p></div>
      <Segmented label="Display" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />
    </div>
    <StageLegend costs={totals} />
    {view === "chart" ? <div ref={ref} className="cp-chart">
      <svg width={width} height={columnHeight + 28} role="group" aria-label="Spend by stage">
        {grid(columnHeight, columnMax, [0, 0.5, 1])}
        {modelRule(columnHeight, true)}
        {buckets.map((bucket, index) => {
          let top = columnHeight;
          const segments = STACK.filter(stage => bucket.costs[stage].amount > 0);
          return <g key={bucket.key} aria-hidden="true">
            {segments.map((stage, segmentIndex) => {
              const height = (bucket.costs[stage].amount / columnMax) * columnHeight;
              top -= height;
              const drawn = Math.max(0, height - (segmentIndex ? 2 : 0));
              return segmentIndex === segments.length - 1
                ? <path key={stage} className={`cp-stage-${stage}`} d={topRounded(x(index) - barWidth / 2, top, barWidth, drawn, 4)} />
                : <rect key={stage} className={`cp-stage-${stage}`} x={x(index) - barWidth / 2} y={top} width={barWidth} height={drawn} />;
            })}
            {bucket.partial ? <circle className="cp-partial-dot" cx={x(index)} cy={columnHeight + 7} r={2.5} /> : null}
          </g>;
        })}
        {xTicks(columnHeight + 24)}
        {bands(columnHeight + 12)}
      </svg>
      <div className="cp-subchart-head"><h3>Average cost per document</h3><span>Own scale, so changes in model or template mix show without a second axis.</span></div>
      <svg width={width} height={lineHeight + 8} role="group" aria-label="Average cost per document">
        {grid(lineHeight, unitMax, [0, 1])}
        {modelRule(lineHeight)}
        <path className="cp-line" d={buckets.reduce((path, bucket, index) => bucket.unit === null ? path : `${path}${path && buckets[index - 1]?.unit != null ? "L" : "M"}${x(index)},${lineHeight - (bucket.unit / unitMax) * lineHeight}`, "")} />
        {buckets.map((bucket, index) => bucket.unit === null ? null : <circle key={bucket.key} className="cp-dot" cx={x(index)} cy={lineHeight - (bucket.unit / unitMax) * lineHeight} r={4} aria-hidden="true" />)}
        {bands(lineHeight + 8)}
      </svg>
      {changeIndex > 0 ? <p className="cp-footnote">The vertical rule marks the Workspace model change.</p> : null}
    </div> : <div className="cp-table-scroll" ref={ref}>
      <table className="studio-table cp-table">
        <thead><tr><th>{unit === "hour" ? "Hour" : "Date"}</th><th className="cp-num">Documents</th><th className="cp-num">Smart split</th><th className="cp-num">Auto template</th><th className="cp-num">Extraction</th><th className="cp-num">Total</th><th className="cp-num">Per document</th></tr></thead>
        <tbody>{[...buckets].reverse().map(bucket => <tr key={bucket.key}>
          <td>{unit === "hour" ? `${shortDate(bucket.date)}, ${label(bucket)}` : label(bucket)}</td><td className="cp-num">{bucket.documents.length}</td>
          {STACK.map(stage => <td key={stage} className="cp-num">{costLabel(bucket.costs[stage], "—")}</td>)}
          <td className="cp-num cp-strong">{costLabel(bucket.costs.total, "—")}</td><td className="cp-num">{usd(bucket.unit)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    <ChartTip tip={tip} />
  </section>;
}

const ROW = 46;
const SPREAD_PAD = { left: 118, right: 16, top: 8, bottom: 26 };
const OUTLIER = 2.5;

function jitter(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return ((hash >>> 0) % 1000) / 1000 - 0.5;
}

function CostSpread({ documents }) {
  const [ref, width] = useWidth(720);
  const { tip, show, hide } = useChartTip();
  const [metric, setMetric] = useState("document");
  const [groupBy, setGroupBy] = useState("template");
  const value = item => metric === "page" ? item.costs.total.amount / item.pages : item.costs.total.amount;
  const priced = documents.filter(item => item.costs.total.amount !== null);
  const groups = useMemo(() => {
    const keys = groupBy === "template" ? TEMPLATES : [...new Set(priced.map(item => item.model))];
    const measure = item => metric === "page" ? item.costs.total.amount / item.pages : item.costs.total.amount;
    return keys.map(key => {
      const members = priced.filter(item => item[groupBy] === key);
      const values = members.map(measure);
      return { key, members, middle: median(values), low: quantile(values, 0.25), high: quantile(values, 0.75), p90: quantile(values, 0.9), total: members.reduce((sum, item) => sum + item.costs.total.amount, 0), unpriced: documents.filter(item => item[groupBy] === key && item.costs.total.amount === null).length };
    }).filter(group => group.members.length);
  }, [priced, documents, groupBy, metric]);
  const max = niceMax(Math.max(...priced.map(value), 0));
  const plotWidth = Math.max(200, width - SPREAD_PAD.left - SPREAD_PAD.right);
  const x = amount => SPREAD_PAD.left + (amount / max) * plotWidth;
  const height = SPREAD_PAD.top + groups.length * ROW + SPREAD_PAD.bottom;
  const tipFor = item => <>
    <StageTipRows costs={item.costs} title={item.name} meta={`${item.template} · ${plural(item.pages, "page")} · ${item.model}`} />
    {metric === "page" ? <p className="cp-tip-foot">{usd(value(item))} per page</p> : null}
    {item.retried ? <p className="cp-tip-foot">Extraction was reassessed. The retries are included.</p> : null}
  </>;

  return <section className="cp-section" aria-label="Cost per document">
    <div className="studio-section-heading">
      <div><h2>Cost per {metric === "page" ? "page" : "document"}</h2><p>Each dot is one document. The band is the middle half and the tick is the median.</p></div>
      <div className="cp-controls">
        <Segmented label="Measure" value={metric} onChange={setMetric} options={[{ value: "document", label: "Per document" }, { value: "page", label: "Per page" }]} />
        <Segmented label="Group by" value={groupBy} onChange={setGroupBy} options={[{ value: "template", label: "Template" }, { value: "model", label: "Model" }]} />
      </div>
    </div>
    {groups.length ? <>
      <div ref={ref} className="cp-chart">
        <svg width={width} height={height} role="group" aria-label={`Cost per ${metric} by ${groupBy}`}>
          {[0, 0.25, 0.5, 0.75, 1].map(step => <g key={step}>
            <line className="cp-grid" x1={x(max * step) + 0.5} x2={x(max * step) + 0.5} y1={SPREAD_PAD.top} y2={height - SPREAD_PAD.bottom} />
            <text className="cp-axis-text" x={x(max * step)} y={height - 8} textAnchor={step === 1 ? "end" : "middle"}>{usd(max * step)}</text>
          </g>)}
          {groups.map((group, index) => {
            const middleY = SPREAD_PAD.top + index * ROW + ROW / 2;
            const flagged = group.members.filter(item => value(item) > group.middle * OUTLIER).sort((a, b) => value(b) - value(a))[0];
            return <g key={group.key}>
              <text className="cp-row-label" x={SPREAD_PAD.left - 12} y={middleY + 4} textAnchor="end">{group.key}</text>
              <rect className="cp-iqr" x={x(group.low)} y={middleY - 13} width={Math.max(2, x(group.high) - x(group.low))} height={26} rx={3} />
              <line className="cp-median" x1={x(group.middle)} x2={x(group.middle)} y1={middleY - 15} y2={middleY + 15} />
              {group.members.map(item => <circle key={item.id} className={`cp-spread-dot${value(item) > group.middle * OUTLIER ? " cp-spread-outlier" : ""}`}
                cx={x(value(item))} cy={middleY + jitter(item.id) * 20} r={4} tabIndex={0}
                aria-label={`${item.name}: ${usd(value(item))}`}
                onMouseMove={event => show(event, tipFor(item))} onMouseLeave={hide} onFocus={event => show(event, tipFor(item))} onBlur={hide} />)}
              {flagged ? <text className="cp-dot-label" x={x(value(flagged)) + (x(value(flagged)) + 130 > SPREAD_PAD.left + plotWidth ? -10 : 10)} y={middleY + jitter(flagged.id) * 20 + 3.5} textAnchor={x(value(flagged)) + 130 > SPREAD_PAD.left + plotWidth ? "end" : "start"}>{flagged.retried ? "Reassessed" : "Outlier"} · {usd(value(flagged))}</text> : null}
            </g>;
          })}
        </svg>
      </div>
      <table className="studio-table cp-table cp-spread-table">
        <thead><tr><th>{groupBy === "template" ? "Template" : "Model"}</th><th className="cp-num">Documents</th><th className="cp-num">Median</th><th className="cp-num">90th percentile</th><th className="cp-num">Spend</th><th className="cp-num">Share</th></tr></thead>
        <tbody>{groups.map(group => <tr key={group.key}>
          <td>{group.key}</td>
          <td className="cp-num">{group.members.length}{group.unpriced ? <span className="cp-muted"> +{group.unpriced} unpriced</span> : null}</td>
          <td className="cp-num">{usd(group.middle)}</td><td className="cp-num">{usd(group.p90)}</td>
          <td className="cp-num cp-strong">{usd(group.total)}</td>
          <td className="cp-num">{percent(group.total / (groups.reduce((sum, entry) => sum + entry.total, 0) || 1))}</td>
        </tr>)}</tbody>
      </table>
    </> : <p className="cp-muted">No priced documents in this range.</p>}
    <ChartTip tip={tip} />
  </section>;
}
