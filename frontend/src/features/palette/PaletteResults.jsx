import React from "react";
import { describeError } from "../../lib/describeError";
import { statusLabel, statusTone } from "../../lib/status";
import { pluralize } from "../../lib/text";
import {
  AssistantIcon,
  DocumentIcon,
  ExternalIcon,
  PlayIcon,
  TemplateIcon,
  WorkspaceIcon,
} from "../layout/Icons.jsx";
import { Button } from "../ui/Button.jsx";
import { Callout } from "../ui/Callout.jsx";
import { LoadMore } from "../ui/Pager.jsx";
import { EmptyState, ErrorState, Skeleton } from "../ui/States.jsx";
import { StatusDot } from "../ui/Status.jsx";
import { canUseAlternative, formatUploadDay, highlightParts, optionId, templateName } from "./paletteState.js";
import { failedTargetIds, searchErrorMessage } from "./paletteSearch.js";

const ROW_ICONS = {
  action: PlayIcon,
  ask: AssistantIcon,
  example: AssistantIcon,
  document: DocumentIcon,
  template: TemplateIcon,
  page: ExternalIcon,
  workspace: WorkspaceIcon,
  start: PlayIcon,
};

const VALUE_STATE_LABELS = { missing: "Not found", invalid: "Invalid", empty: "Empty" };

function Highlighted({ parts }) {
  return parts.map((part, index) => (part.match ? <mark key={index}>{part.text}</mark> : <React.Fragment key={index}>{part.text}</React.Fragment>));
}

// The document's processing cost, shown when the search compared it, as the Costs page writes it.
function MatchedCost({ job }) {
  const match = Array.isArray(job.matches) ? job.matches.find((candidate) => candidate.kind === "cost") : null;

  if (!match) return null;

  return ` · Cost ${match.display ?? "unavailable"}`;
}

// The field value that matched, with the matched part marked.
function MatchedValue({ job, filter }) {
  const match = Array.isArray(job.matches) ? job.matches.find((candidate) => candidate.kind !== "cost") : null;

  if (!match) return null;

  const condition = filter?.conditions?.find(
    (candidate) => candidate.template_id === match.template_id && candidate.field_id === match.field_id,
  );

  const value =
    match.value_state === "value" ? (
      <Highlighted parts={highlightParts(match.display, condition ? { condition } : { text: filter?.text })} />
    ) : (
      VALUE_STATE_LABELS[match.value_state] || ""
    );

  return (
    <>
      {" · "}
      {match.field_name} {value}
    </>
  );
}

function RowDetail({ item, filter }) {
  if (item.kind === "document") {
    const { job } = item;

    return (
      <span className="palette-row-sub">
        {item.templateName || "No template"}
        {" · "}
        <StatusDot tone={statusTone(job.status)} label={statusLabel(job.status)} />
        {job.created_at ? ` · ${formatUploadDay(job.created_at)}` : ""}
        <MatchedValue job={job} filter={filter} />
        <MatchedCost job={job} />
      </span>
    );
  }

  return item.sub ? <span className="palette-row-sub">{item.sub}</span> : null;
}

export function PaletteOption({ item, listboxId, highlighted, filter, onActivate, onHighlight }) {
  const RowIcon = ROW_ICONS[item.kind] || PlayIcon;
  const hint = item.kind === "ask" ? null : ["document", "template"].includes(item.kind) ? "Open" : null;

  return (
    <div
      id={optionId(listboxId, item)}
      role="option"
      aria-selected={highlighted}
      aria-disabled={item.disabled || undefined}
      className={[
        "palette-row",
        highlighted && "is-highlighted",
        item.danger && "is-danger",
        item.disabled && "is-disabled",
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerMove={onHighlight}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => onActivate(item)}
    >
      <span className={`palette-row-icon palette-row-icon-${item.kind}`} aria-hidden="true">
        <RowIcon size={13} />
      </span>
      <span className="palette-row-text">
        <strong>{item.label}</strong>
        <RowDetail item={item} filter={filter} />
      </span>
      {item.shortcut ? (
        <span className="palette-row-hint" aria-hidden="true">
          {item.shortcut.map((key) => (
            <kbd key={key}>{key}</kbd>
          ))}
        </span>
      ) : hint ? (
        <span className="palette-row-hint" aria-hidden="true">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

// Options grouped under small headings. The listbox itself belongs to the palette.
export function OptionGroups({ items, listboxId, highlightIndex, filter, onActivate, onHighlight }) {
  const groups = [];

  items.forEach((item, index) => {
    const last = groups.at(-1);

    if (last && last.name === item.group) last.entries.push({ item, index });
    else groups.push({ name: item.group, entries: [{ item, index }] });
  });

  return groups.map((group, groupIndex) => {
    const headingId = `${listboxId}-group-${groupIndex}`;

    const options = group.entries.map(({ item, index }) => (
      <PaletteOption
        key={item.id}
        item={item}
        listboxId={listboxId}
        highlighted={index === highlightIndex}
        filter={filter}
        onActivate={onActivate}
        onHighlight={() => onHighlight(index)}
      />
    ));

    if (!group.name) return <React.Fragment key={groupIndex}>{options}</React.Fragment>;

    return (
      <div key={groupIndex} role="group" aria-labelledby={headingId}>
        <div id={headingId} className="palette-group" role="presentation">
          {group.name}
        </div>
        {options}
      </div>
    );
  });
}

/** The palette's listbox: the combobox in the bar points here with aria-controls and aria-activedescendant. */
export function OptionList(props) {
  return (
    <div id={props.listboxId} role="listbox" aria-label="Results" className="command-palette-list">
      <OptionGroups {...props} />
    </div>
  );
}

// Notes from the interpretation: ambiguous fields offer their alternatives in one click.
export function InterpretationNotes({ interpretation, catalog, onUseAlternative }) {
  const notes = interpretation?.notes || [];

  if (!notes.length) return null;

  return (
    <div className="palette-notes">
      {notes.map((note, index) => {
        const alternatives =
          note.kind === "ambiguous_field"
            ? note.alternatives.filter((alternative) => canUseAlternative(interpretation, alternative, catalog))
            : [];

        return (
          <Callout
            key={`${note.kind}-${index}`}
            tone={note.kind === "unrecognised" ? "warning" : "info"}
            action={
              alternatives.length ? (
                <span className="palette-note-actions">
                  {alternatives.map((alternative) => (
                    <Button
                      key={`${alternative.template_id}:${alternative.field_id}`}
                      variant="text"
                      size="sm"
                      onClick={() => onUseAlternative(alternative)}
                    >
                      Use {templateName(catalog, alternative.template_id) || "this template"}
                    </Button>
                  ))}
                </span>
              ) : null
            }
          >
            {note.text}
          </Callout>
        );
      })}
    </div>
  );
}

function BulkActions({ targets, total, onBulk }) {
  const ready = Boolean(targets);
  const exportCount = targets ? targets.jobIds.length : Math.min(total, 500);
  const failed = targets ? failedTargetIds(targets).length : 0;

  return (
    <div className="palette-bulk" role="group" aria-label="Actions for these documents">
      <Button variant="secondary" size="sm" disabled={!ready || !exportCount} onClick={() => onBulk("export")}>
        Export {exportCount}
      </Button>
      {failed ? (
        <Button variant="secondary" size="sm" onClick={() => onBulk("retry")}>
          Try {failed} failed again
        </Button>
      ) : null}
      <Button variant="secondary" size="sm" disabled={!ready} onClick={() => onBulk("delete")}>
        Delete…
      </Button>
      <Button variant="secondary" size="sm" onClick={() => onBulk("open")}>
        Open in Documents
      </Button>
    </div>
  );
}

/** find_documents: a summary of the criteria, the matching documents and actions for all of them. */
export function DocumentResults({ results, summary, limit, items, listboxId, highlightIndex, filter, onActivate, onHighlight, onBulk }) {
  if (results.status === "loading") return <Skeleton rows={4} height={40} label="Searching…" />;

  if (results.status === "error")
    return <ErrorState message={searchErrorMessage(results.error, describeError)} onRetry={results.retry} />;

  const shown = limit ? Math.min(results.total, limit) : results.total;
  const count = `${pluralize(shown, "document")}${results.totalCapped && !limit ? "+" : ""}`;

  return (
    <>
      <div className="palette-summary">
        <span>
          <strong>{count}</strong>
          {limit ? ` · latest ${limit}` : ""}
          {` · ${summary || "All documents"}`}
        </span>
        <span>Newest first</span>
      </div>
      {results.jobs.length ? (
        <OptionList
          items={items}
          listboxId={listboxId}
          highlightIndex={highlightIndex}
          filter={filter}
          onActivate={onActivate}
          onHighlight={onHighlight}
        />
      ) : (
        <EmptyState message="No documents match. Try removing a condition." />
      )}
      {/* The search stops offering more once "the latest N" are shown. */}
      {results.hasMore ? (
        <LoadMore
          onLoadMore={results.loadMore}
          pending={results.loadingMore}
          error={results.loadMoreError ? describeError(results.loadMoreError, "Couldn't load more documents.") : ""}
        />
      ) : null}
      {results.jobs.length ? <BulkActions targets={results.targets} total={results.total} onBulk={onBulk} /> : null}
    </>
  );
}

/** find_templates: matching Templates, newest list order. */
export function TemplateResults({ items, listboxId, highlightIndex, onActivate, onHighlight }) {
  return (
    <>
      <div className="palette-summary">
        <span>
          <strong>{pluralize(items.length, "template")}</strong>
        </span>
      </div>
      {items.length ? (
        <OptionList
          items={items}
          listboxId={listboxId}
          highlightIndex={highlightIndex}
          onActivate={onActivate}
          onHighlight={onHighlight}
        />
      ) : (
        <EmptyState message="No templates match. Try another name." />
      )}
    </>
  );
}
