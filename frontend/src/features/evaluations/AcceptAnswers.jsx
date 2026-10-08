import React, { useId, useState } from "react";
import { ModalDialog, ModalFooter, ModalHeader } from "../layout/ModalDialog.jsx";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { Button } from "../ui/Button.jsx";
import { CheckboxField } from "../ui/Field.jsx";
import { pluralize } from "../../lib/text.js";
import { refText } from "./evaluationLibrary.js";
import { planChanges } from "./acceptAnswers.js";

const total = (plans, key) => plans.reduce((sum, { plan }) => sum + plan[key].length, 0);

// Confirms "Accept all answers" for one document or for every document. `plans` are
// { document, plan } from planAcceptAnswers. Differing verified answers are kept unless the user
// opts in to overwrite them. Confirming hands the chosen changes to `onAccept`.
export function AcceptAnswersDialog({ candidateLabel, plans, everyDocument = false, onAccept, onClose }) {
  const titleId = useId();
  const [overwrite, setOverwrite] = useState(false);

  const set = total(plans, "set"),
    matching = total(plans, "matching"),
    conflicts = total(plans, "conflicts"),
    review = total(plans, "review");

  const count = set + (overwrite ? conflicts : 0);
  const named = (document, name) => (everyDocument ? `${document.name} · ${name}` : name);

  const target = everyDocument ? pluralize(plans.length, "document") : `“${plans[0]?.document.name}”`;

  return (
    <ModalDialog labelledBy={titleId} className="evaluation-accept-modal" onClose={onClose}>
      <ModalHeader
        titleId={titleId}
        title={`Accept answers from “${candidateLabel}”?`}
        description={`Sets expected answers for ${target} from this candidate and marks them verified.`}
        onClose={onClose}
      />
      <ul className="evaluation-accept-summary">
        <li>
          <strong>{pluralize(set, "answer")}</strong> to set
        </li>
        {matching > 0 && (
          <li>
            <strong>{pluralize(matching, "verified answer")}</strong> already {matching === 1 ? "matches" : "match"}
          </li>
        )}
        {conflicts > 0 && (
          <li>
            <strong>{pluralize(conflicts, "verified answer")}</strong> {conflicts === 1 ? "differs" : "differ"} ·{" "}
            {overwrite ? "overwritten" : "kept"}
          </li>
        )}
        {review > 0 && (
          <li>
            <strong>{pluralize(review, "field")}</strong> to review yourself: tables with rows and answers that
            can’t be used
          </li>
        )}
      </ul>
      {conflicts > 0 && (
        <section className="evaluation-accept-conflicts" aria-labelledby={`${titleId}-conflicts`}>
          <h3 id={`${titleId}-conflicts`}>Verified answers that differ</h3>
          <ScrollArea className="evaluation-accept-scroll" role="region" aria-label="Verified answers that differ" tabIndex={0}>
            <ul>
              {plans.flatMap(({ document, plan }) =>
                plan.conflicts.map((item) => (
                  <li key={`${document.key}:${item.identity}`}>
                    <strong>{named(document, item.name)}</strong>
                    <span>
                      {refText(item.current, item.currentDefinition)} → {refText(item.value, item.definition)}
                    </span>
                  </li>
                )),
              )}
            </ul>
          </ScrollArea>
          <CheckboxField
            label={`Overwrite ${conflicts === 1 ? "this answer" : `these ${conflicts} answers`} too`}
            checked={overwrite}
            onChange={setOverwrite}
          />
        </section>
      )}
      {review > 0 && (
        <p className="evaluation-muted">
          Needs review:{" "}
          {plans
            .flatMap(({ document, plan }) => plan.review.map((item) => named(document, item.name)))
            .join(", ")}
        </p>
      )}
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!count}
          onClick={() => {
            onAccept(plans.flatMap(({ document, plan }) => planChanges(plan, overwrite).map((item) => ({ ...item, docKey: document.key }))));
            onClose();
          }}
        >
          {count ? `Accept ${pluralize(count, "answer")}` : "No answers to accept"}
        </Button>
      </ModalFooter>
    </ModalDialog>
  );
}
