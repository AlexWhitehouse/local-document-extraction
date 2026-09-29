import { describe, expect, it } from "bun:test";

import { renderAccountEmailVerificationEmail, renderAccountPasswordResetEmail } from "./accountEmails";

describe("Account emails", () => {
  it("renders the agreed sender, subject, verification URL, and unexpected-recipient guidance", () => {
    const verificationUrl = "https://app.example.org/api/auth/verify-email?token=abc123";

    const email = renderAccountEmailVerificationEmail({ verificationUrl });

    expect(email.from).toEqual({ name: "Document Extraction", email: "no-reply@example.com" });
    expect(email.subject).toBe("Verify your Document Extraction account");
    expect(email.html).toContain(verificationUrl);
    expect(email.text).toContain(verificationUrl);
    expect(email.html).toContain("ignore this email");
    expect(email.text).toContain("ignore this email");
  });

  it("renders the agreed sender, subject, reset URL, and unexpected-recipient guidance", () => {
    const resetUrl = "https://app.example.org/reset-password?token=abc123";

    const email = renderAccountPasswordResetEmail({ resetUrl });

    expect(email.from).toEqual({ name: "Document Extraction", email: "no-reply@example.com" });
    expect(email.subject).toBe("Reset your Document Extraction password");
    expect(email.html).toContain(resetUrl);
    expect(email.text).toContain(resetUrl);
    expect(email.html).toContain("ignore this email");
    expect(email.text).toContain("ignore this email");
  });
});
