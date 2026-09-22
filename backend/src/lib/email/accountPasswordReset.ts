export type AccountPasswordResetEmail = {
  from: {
    name: string;
    email: string;
  };
  subject: string;
  html: string;
  text: string;
};

export function renderAccountPasswordResetEmail({
  resetUrl,
  from = { name: "Document Extraction", email: "no-reply@example.com" },
}: {
  resetUrl: string;
  from?: { name: string; email: string };
}): AccountPasswordResetEmail {
  return {
    from,
    subject: "Reset your Document Extraction password",
    html: `<p>Reset your Document Extraction password by opening this link:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request a Document Extraction password reset, you can ignore this email.</p>`,
    text: `Reset your Document Extraction password by opening this link:\n\n${resetUrl}\n\nIf you did not request a Document Extraction password reset, you can ignore this email.`,
  };
}
