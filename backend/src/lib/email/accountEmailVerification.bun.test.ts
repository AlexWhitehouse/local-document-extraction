import { describe, expect, it } from "bun:test";

import { renderAccountEmailVerificationEmail } from "./accountEmailVerification";

describe("Account email verification email", () => {
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
});
