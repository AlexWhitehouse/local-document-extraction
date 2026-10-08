import { describe, expect, it } from "vitest";
import { ACCEPTED_FILE_TYPES, validateSourceFiles } from "./sourceFileValidation.js";

const MB = 1024 * 1024;

const file = (name, type, size = 1024) => ({ name, type, size });

describe("validateSourceFiles", () => {
  it("accepts the extraction types the backend reads", () => {
    expect(ACCEPTED_FILE_TYPES).toEqual(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
  });

  it("names each refused file and its reason, and keeps the valid ones", () => {
    const good = file("invoice.pdf", "application/pdf");

    const result = validateSourceFiles(
      [good, file("invoice.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), file("scan.pdf", "application/pdf", 11 * MB)],
      10 * MB,
    );

    expect(result.accepted).toEqual([good]);
    expect(result.rejections).toEqual([
      "invoice.docx isn't a PDF, PNG, JPG or WEBP file",
      "scan.pdf is larger than 10 MB",
    ]);
  });

  it("accepts a file exactly at the limit", () => {
    const atLimit = file("exact.png", "image/png", 10 * MB);

    expect(validateSourceFiles([atLimit], 10 * MB)).toEqual({ accepted: [atLimit], rejections: [] });
  });
});
