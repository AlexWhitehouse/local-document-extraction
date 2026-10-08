import React, { useEffect, useRef, useState } from "react";

// Lifecycle states worth telling a screen reader about, with the words used to say them.
const ANNOUNCED_STATUSES = {
  completed: "completed",
  failed: "failed",
  error: "failed",
  awaiting_template: "needs a template",
};

// One polite live region for the visible documents. The first snapshot is the baseline, so opening
// the page announces nothing, and each document's status change is announced once.
export function DocumentLifecycleAnnouncer({ documents = [] }) {
  const previous = useRef(null);
  const announced = useRef(new Set());
  const [message, setMessage] = useState("");

  useEffect(() => {
    const before = previous.current;
    const current = new Map(documents.map((job) => [String(job.job_id), String(job.status || "")]));

    previous.current = current;

    if (!before) return;

    const lines = [];

    for (const job of documents) {
      const id = String(job.job_id);
      const status = String(job.status || "");
      const verb = ANNOUNCED_STATUSES[status];
      const changed = before.has(id) && before.get(id) !== status;
      const key = `${id}:${status}`;

      if (!verb || !changed || announced.current.has(key)) continue;

      announced.current.add(key);
      lines.push(`${job.source_name || id} ${verb}`);
    }

    if (lines.length) setMessage(lines.join(". "));
  }, [documents]);

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
