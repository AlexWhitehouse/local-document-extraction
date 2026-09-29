type EmailSender = { name: string; email: string };

export type AccountEmail = {
  from: EmailSender;
  subject: string;
  html: string;
  text: string;
};

const DEFAULT_SENDER: EmailSender = { name: "Document Extraction", email: "no-reply@example.com" };

function renderAccountLinkEmail(from: EmailSender, subject: string, instruction: string, url: string, disclaimer: string): AccountEmail {
  return {
    from,
    subject,
    html: `<p>${instruction}</p><p><a href="${url}">${url}</a></p><p>${disclaimer}</p>`,
    text: `${instruction}\n\n${url}\n\n${disclaimer}`,
  };
}

export function renderAccountEmailVerificationEmail({ verificationUrl, from = DEFAULT_SENDER }: {
  verificationUrl: string;
  from?: EmailSender;
}): AccountEmail {
  return renderAccountLinkEmail(
    from,
    "Verify your Document Extraction account",
    "Verify your Document Extraction account by opening this link:",
    verificationUrl,
    "If you did not create a Document Extraction account, you can ignore this email.",
  );
}

export function renderAccountPasswordResetEmail({ resetUrl, from = DEFAULT_SENDER }: {
  resetUrl: string;
  from?: EmailSender;
}): AccountEmail {
  return renderAccountLinkEmail(
    from,
    "Reset your Document Extraction password",
    "Reset your Document Extraction password by opening this link:",
    resetUrl,
    "If you did not request a Document Extraction password reset, you can ignore this email.",
  );
}
