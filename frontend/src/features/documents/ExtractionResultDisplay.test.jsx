import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ExtractionJobStatusDisplay,
  ExtractionResultDisplay,
} from "./ExtractionResultDisplay.jsx";

describe("Extraction job status display", () => {
  it("shows queued, processing, completed, and failed Extraction job states", () => {
    const { rerender } = render(
      <ExtractionJobStatusDisplay job={{ status: "queued" }} />,
    );

    expect(screen.getByText("The document is processing")).toBeTruthy();
    expect(screen.getByText("Attempt: pending")).toBeTruthy();

    rerender(
      <ExtractionJobStatusDisplay job={{ status: "processing", current_attempt: 2 }} />,
    );

    expect(screen.getByText("The document is processing")).toBeTruthy();
    expect(screen.getByText("Current attempt: 2")).toBeTruthy();

    rerender(
      <ExtractionJobStatusDisplay job={{ status: "completed", completed_attempt: 3 }} />,
    );

    expect(screen.getByText("This extraction completed successfully.")).toBeTruthy();
    expect(screen.getByText("Completed on attempt: 3")).toBeTruthy();

    rerender(
      <ExtractionJobStatusDisplay job={{ status: "failed", last_failed_attempt: 4 }} />,
    );

    expect(screen.getByText("This extraction finished with a failure status.")).toBeTruthy();
    expect(screen.getByText("Last failed attempt: 4")).toBeTruthy();
  });
});

describe("Extraction result display", () => {
  it("shows scalar Extraction results with confidence cues and hides ok status", () => {
    render(
      <ExtractionResultDisplay
        job={{
          status: "completed",
          results: [
            {
              field_id: "patient_name",
              name: "Patient Name",
              status: "completed",
              confidence: 0.932,
              answer: "Ada Lovelace",
              evidence: "Patient: Ada Lovelace",
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("rowheader", { name: "Patient Name" })).toBeTruthy();
    expect(screen.queryByText("ok")).toBeNull();
    expect(screen.queryByText("completed")).toBeNull();
    expect(screen.getByLabelText("Confidence 93.2%")).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Patient: Ada Lovelace" })).toBeTruthy();
  });

  it("shows a Not Found status cue only when extraction data was missing", () => {
    render(
      <ExtractionResultDisplay
        job={{
          status: "completed",
          results: [
            {
              field_id: "delivery_interval",
              name: "Delivery instruction every x weeks",
              status: "not_found",
              answer: null,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Not Found")).toBeTruthy();
    expect(screen.getByText("No value extracted.")).toBeTruthy();
  });

  it("shows empty Extraction result values without inventing answers", () => {
    render(
      <ExtractionResultDisplay
        job={{
          status: "completed",
          results: [
            {
              field_id: "patient_name",
              name: "Patient Name",
              status: "completed",
              answer: null,
            },
            {
              field_id: "prescription_lines",
              name: "Prescription Lines",
              status: "completed",
              answer: [],
            },
            {
              field_id: "metadata",
              name: "Metadata",
              status: "completed",
              answer: {},
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("No value extracted.")).toBeTruthy();
    expect(screen.getByText("No rows returned.")).toBeTruthy();
    expect(screen.getByText("No values returned.")).toBeTruthy();
  });

  it("shows object and primitive array Extraction results as key-value rows", () => {
    render(
      <ExtractionResultDisplay
        job={{
          status: "completed",
          results: [
            {
              field_id: "patient_details",
              name: "Patient Details",
              status: "completed",
              answer: { name: "Ada Lovelace", age: 36, active: true },
            },
            {
              field_id: "warnings",
              name: "Warnings",
              status: "completed",
              answer: ["Check dosage", "Confirm prescriber"],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("name")).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("age")).toBeTruthy();
    expect(screen.getByText("36")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("Check dosage")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("Confirm prescriber")).toBeTruthy();
  });

  it("shows table-shaped Extraction results with headings and missing cells", () => {
    render(
      <ExtractionResultDisplay
        job={{
          status: "completed",
          results: [
            {
              field_id: "prescription_lines",
              name: "Prescription Lines",
              status: "completed",
              data_type: "array<object>",
              answer: [
                { medication: "Atorvastatin", dose: "20 mg" },
                { medication: "Metformin" },
              ],
            },
            {
              field_id: "dispensing_table",
              name: "Dispensing Table",
              status: "completed",
              answer: {
                columns: [
                  { key: "line", heading: "Line" },
                  { key: "quantity", heading: "Quantity" },
                ],
                rows: [{ line: "A", quantity: 30 }],
              },
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "medication" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "dose" })).toBeTruthy();
    expect(screen.getByText("Atorvastatin")).toBeTruthy();
    expect(screen.getByText("20 mg")).toBeTruthy();
    expect(screen.getByText("Metformin")).toBeTruthy();
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Line" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Quantity" })).toBeTruthy();
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("30")).toBeTruthy();
  });
});
