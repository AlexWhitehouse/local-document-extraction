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
}: {
  resetUrl: string;
}): AccountPasswordResetEmail {
  return {
    from: { name: "Document Extraction", email: "no-reply@extract.t3m.uk" },
    subject: "Reset your Document Extraction password",
    html: `<p>Reset your Document Extraction password by opening this link:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request a Document Extraction password reset, you can ignore this email.</p>`,
    text: `Reset your Document Extraction password by opening this link:\n\n${resetUrl}\n\nIf you did not request a Document Extraction password reset, you can ignore this email.`,
  };
}
