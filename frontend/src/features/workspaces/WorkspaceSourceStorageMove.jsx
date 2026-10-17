import React from "react";
import { pluralize } from "../../lib/text";
import { confirmDialog } from "../ui/confirm.jsx";
import { Button } from "../ui/Button.jsx";
import { Callout } from "../ui/Callout.jsx";
import { ErrorState } from "../ui/States.jsx";
import { Badge, StatusDot } from "../ui/Status.jsx";
import { formatSize } from "./useWorkspaceSourceStorageMove.js";

const formatTime = (value) =>
  new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const formatDateTime = (value) =>
  new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function locationName(location) {
  if (location.kind === "local") return "Local data folder";

  if (location.kind === "installation_bucket") return "Default bucket";

  return location.retired ? "Earlier workspace bucket" : "This workspace's bucket";
}

const FAILURE_KINDS = { document: "Document", packet: "Packet", library_document: "Library document" };

const FINISHED = {
  completed: { label: "Move finished", tone: "success" },
  cancelled: { label: "Move cancelled", tone: "neutral" },
  stopped: { label: "Move stopped", tone: "warning" },
};

/** "12 originals · 4.4 MB", noting originals saved before sizes were recorded. */
function describeAmount(originals, bytes, unknown) {
  const size = unknown >= originals ? "size unknown" : formatSize(bytes);
  const extra = unknown > 0 && unknown < originals ? ` (${unknown} of unknown size)` : "";

  return `${pluralize(originals, "original")} · ${size}${extra}`;
}

// What a move would copy: everything outside the target.
function movingAmount(locations) {
  let bytes = 0;
  let unknown = 0;

  for (const location of locations) {
    if (location.is_target) continue;
    bytes += location.bytes || 0;
    unknown += location.unknown_size || 0;
  }

  return { bytes, unknown };
}

function unavailableMessage(summary) {
  if (summary.unavailable_reason === "no_remote_storage")
    return "Originals can only be moved into a bucket, not into the local data folder. Add a bucket to move them.";

  if (summary.unavailable_reason === "credentials_unavailable")
    return summary.target?.kind === "installation_bucket"
      ? "Originals can't be moved because the default bucket's access keys can't be read. Ask your administrator to check them."
      : "Originals can't be moved because this workspace's bucket keys can't be read. Edit the settings and enter the access keys again.";

  return "";
}

/** Where this workspace's originals are now, and moving them into its current location. */
export function WorkspaceSourceStorageMove({ controller }) {
  const { summary, error, running } = controller;

  if (!summary) return error ? <ErrorState message={error} onRetry={() => controller.reload()} /> : null;

  const locations = summary.locations ?? [];
  const move = summary.move ?? null;
  const elsewhere = locations.some((location) => !location.is_target && location.originals > 0);

  // Nothing to report when every original is already in the current location.
  if (!elsewhere && !move) return null;

  const canStart = summary.movable > 0 && !summary.unavailable_reason && !running;
  const unavailable = elsewhere && !running ? unavailableMessage(summary) : "";

  const start = async () => {
    const { bytes, unknown } = movingAmount(locations);
    const size = unknown ? `${formatSize(bytes)} plus ${unknown} of unknown size` : formatSize(bytes);
    const destination = summary.target?.bucket ? `"${summary.target.bucket}"` : "the current location";

    await confirmDialog({
      title: `Move ${pluralize(summary.movable, "original")} to ${destination}?`,
      body: `About ${size} is copied through Studio, so the old storage provider may charge for data leaving it. Uploads and downloads keep working, and each old copy is deleted only after its new copy is checked.`,
      confirmLabel: "Move originals",
      pendingLabel: "Starting…",
      tone: "default",
      action: controller.start,
    });
  };

  const cancel = () =>
    confirmDialog({
      title: "Cancel the move?",
      body: "Originals already moved stay in the new location. The rest stay where they are.",
      confirmLabel: "Cancel move",
      cancelLabel: "Keep moving",
      pendingLabel: "Cancelling…",
      tone: "default",
      action: controller.cancel,
    });

  return (
    <div className="workspace-storage-move">
      <div className="workspace-storage-move-heading">
        <h3>Where originals are stored</h3>
        {canStart ? (
          <Button variant="secondary" size="sm" onClick={start}>
            Move to current location…
          </Button>
        ) : null}
        {running ? (
          <Button variant="secondary" size="sm" onClick={cancel}>
            Cancel move…
          </Button>
        ) : null}
      </div>
      <ul className="workspace-storage-locations">
        {locations.map((location) => (
          <li key={location.id}>
            <div className="workspace-storage-location-name">
              <span>{locationName(location)}</span>
              {location.bucket ? <code>{location.bucket}</code> : null}
              {location.is_target ? <Badge tone="info">Current location</Badge> : null}
            </div>
            <span className="workspace-storage-location-amount">
              {describeAmount(location.originals, location.bytes, location.unknown_size)}
            </span>
          </li>
        ))}
      </ul>
      {unavailable ? <Callout tone="warning">{unavailable}</Callout> : null}
      {move ? <MoveReport move={move} /> : null}
    </div>
  );
}

function reportStatus(move) {
  if (move.status === "running")
    return move.next_attempt_at
      ? { label: "Move paused", tone: "warning" }
      : { label: "Moving originals…", tone: "info", pulse: true };

  const finished = FINISHED[move.status] ?? FINISHED.stopped;

  // A finished move that left originals behind needs a look.
  if (move.status === "completed" && (move.failed > 0 || move.waiting > 0)) return { ...finished, tone: "warning" };

  return finished;
}

function MoveReport({ move }) {
  const isRunning = move.status === "running";
  const paused = isRunning && Boolean(move.next_attempt_at);
  const status = reportStatus(move);

  return (
    <div className="workspace-storage-move-report">
      <div role={isRunning ? "status" : undefined} className="workspace-storage-move-progress">
        <StatusDot tone={status.tone} label={status.label} pulse={status.pulse === true} />
        <span>
          {move.moved} of {pluralize(move.total, "original")} moved
          {move.bytes_moved ? ` (${formatSize(move.bytes_moved)})` : ""}
        </span>
      </div>
      {isRunning ? <progress max={Math.max(move.total, 1)} value={move.moved} aria-label="Move progress" /> : null}
      {move.message ? <p className="workspace-storage-note">{move.message}</p> : null}
      {paused ? <p className="workspace-storage-note">Resumes at {formatTime(move.next_attempt_at)}.</p> : null}
      {move.failed > 0 ? (
        <p className="workspace-storage-note">
          Couldn't move {pluralize(move.failed, "original")}.{" "}
          {move.failed === 1 ? "It stays where it was" : "They stay where they were"} and can still be opened.
        </p>
      ) : null}
      {move.waiting > 0 ? (
        <p className="workspace-storage-note">
          {isRunning
            ? `${pluralize(move.waiting, "original")} still processing or out of reach. Studio tries again automatically.`
            : `Skipped ${pluralize(move.waiting, "original")} still processing or out of reach. Start another move to include them.`}
        </p>
      ) : null}
      {!isRunning && move.finished_at ? (
        <p className="workspace-storage-note">Ended {formatDateTime(move.finished_at)}.</p>
      ) : null}
      {move.failures?.length ? (
        <ul className="workspace-storage-move-failures" aria-label="Originals that couldn't be moved">
          {/* The server writes these reasons for people, like `message`. */}
          {move.failures.map((entry) => (
            <li key={`${entry.kind}:${entry.id}`}>
              <span>
                {FAILURE_KINDS[entry.kind] ?? "Document"}: <strong>{entry.name || entry.id}</strong>
              </span>
              <span>{entry.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
