import React, { useEffect, useRef, useState } from "react";
import { TourSpotlight } from "./TourSpotlight.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import { CloseIcon } from "../layout/Icons.jsx";
import { TOUR_STEPS, canContinueTour } from "./tourSteps.js";
import "./onboarding.css";

export function OnboardingTour({
  userId,
  ready,
  workspaceId,
  workspace,
  template,
  model,
  upload,
  busy,
  onStart,
  onActiveChange,
  renderProfile,
  returnFocusRef,
}) {
  const storageKey = `document-extraction.tour.v1:${userId}`;

  const [offered, setOffered] = useState(() => {
    try {
      return !localStorage.getItem(storageKey);
    } catch {
      return true;
    }
  });

  const [index, setIndex] = useState(null);
  const initialWorkspaceId = useRef("");
  const activeChangeRef = useRef(onActiveChange);
  activeChangeRef.current = onActiveChange;
  useEffect(() => () => activeChangeRef.current(false), []);
  const step = index === null ? null : TOUR_STEPS[index];

  function remember(status) {
    setOffered(false);

    try {
      localStorage.setItem(storageKey, status);
    } catch {
      /* The tour also works without browser storage. */
    }
  }

  function start() {
    initialWorkspaceId.current = workspaceId;
    remember("started");
    onStart();
    onActiveChange(true);
    setIndex(0);
  }

  function exit() {
    remember(step?.id === "complete" ? "completed" : "dismissed");

    if (step?.id === "complete") upload.onClose();
    setIndex(null);
    onActiveChange(false);
    requestAnimationFrame(() => returnFocusRef?.current?.querySelector("button")?.focus());
  }

  useEffect(() => {
    const succeeded =
      (step?.action === "workspace" && workspaceId && workspaceId !== initialWorkspaceId.current && !busy && ready) ||
      (step?.action === "template" && template.isEditingTemplate && !template.isSavingTemplate) ||
      (step?.action === "upload" &&
        !upload.isUploadingDocuments &&
        upload.sourceFiles.length > 0 &&
        upload.sourceFiles.every((entry) => entry.queueStatus === "success"));

    if (succeeded) setIndex((current) => current + 1);
  }, [
    step,
    workspaceId,
    ready,
    busy,
    template.isEditingTemplate,
    template.isSavingTemplate,
    upload.isUploadingDocuments,
    upload.sourceFiles,
  ]);

  return (
    <>
      {ready && offered && index === null ? (
        <aside className="tour-invitation" aria-label="Welcome tour">
          <Button variant="secondary" size="sm" onClick={start} disabled={busy}>
            Take the tour
          </Button>
          <IconButton label="Dismiss tour" icon={CloseIcon} size="sm" onClick={() => remember("dismissed")} />
        </aside>
      ) : null}
      {renderProfile?.(
        <Button variant="secondary" disabled={!ready || busy || index !== null} onClick={start}>
          Take a tour
        </Button>,
      )}
      {step ? (
        <TourSpotlight
          step={step}
          index={index}
          total={TOUR_STEPS.length}
          canContinue={canContinueTour(step.check, { workspace, template, model, upload, busy })}
          onNext={() => setIndex((current) => current + 1)}
          onExit={exit}
          onTargetClick={step.click ? () => setIndex((current) => current + 1) : undefined}
        />
      ) : null}
    </>
  );
}
