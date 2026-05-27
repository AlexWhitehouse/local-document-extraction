import { describe, expect, it } from "vitest";

import { renderAccountPasswordResetEmail } from "./accountPasswordReset";

describe("Account password reset email", () => {
  it("renders the agreed sender, subject, reset URL, and unexpected-recipient guidance", () => {
    const resetUrl = "https://extract.t3m.uk/reset-password?token=abc123";

    const email = renderAccountPasswordResetEmail({ resetUrl });

    expect(email.from).toEqual({ name: "Document Extraction", email: "no-reply@extract.t3m.uk" });
    expect(email.subject).toBe("Reset your Document Extraction password");
    expect(email.html).toContain(resetUrl);
    expect(email.text).toContain(resetUrl);
    expect(email.html).toContain("ignore this email");
    expect(email.text).toContain("ignore this email");
  });
});
