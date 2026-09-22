export type AccountEmailVerificationEmail = {
  from: {
    name: string;
    email: string;
  };
  subject: string;
  html: string;
  text: string;
};

export function renderAccountEmailVerificationEmail({
  verificationUrl,
  from = { name: "Document Extraction", email: "no-reply@example.com" },
}: {
  verificationUrl: string;
  from?: { name: string; email: string };
}): AccountEmailVerificationEmail {
  return {
    from,
    subject: "Verify your Document Extraction account",
    html: `<p>Verify your Document Extraction account by opening this link:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>If you did not create a Document Extraction account, you can ignore this email.</p>`,
    text: `Verify your Document Extraction account by opening this link:\n\n${verificationUrl}\n\nIf you did not create a Document Extraction account, you can ignore this email.`,
  };
}
