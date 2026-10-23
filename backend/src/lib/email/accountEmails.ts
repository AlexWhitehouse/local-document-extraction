type EmailSender = { name: string; email: string };

export type AccountEmail = {
  from: EmailSender;
  subject: string;
  html: string;
  text: string;
};

type AccountLinkEmailContent = {
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  actionLabel: string;
  url: string;
  expiry: string;
  disclaimer: string;
};

const DEFAULT_SENDER: EmailSender = { name: "Document Extraction", email: "no-reply@example.com" };

const PRODUCT_NAME = "Document Extraction";

// Email clients ignore stylesheets and custom properties, so colours mirror the app's
// accent and text tokens inline.
const EMAIL_COLOURS = {
  page: "#f3f5f8",
  card: "#ffffff",
  rule: "#e3e8ef",
  heading: "#0b1220",
  body: "#3d4a5c",
  muted: "#6b778a",
  accent: "#11877f",
  onAccent: "#ffffff",
};

const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderAccountLinkHtml(content: AccountLinkEmailContent): string {
  const c = EMAIL_COLOURS;
  const url = escapeHtml(content.url);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${c.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${c.page};">
<tr>
<td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr>
<td style="padding:0 4px 20px;font-family:${FONT_STACK};font-size:15px;font-weight:600;color:${c.heading};">
<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background-color:${c.accent};margin-right:8px;vertical-align:middle;"></span><span style="vertical-align:middle;">${PRODUCT_NAME}</span>
</td>
</tr>
<tr>
<td style="background-color:${c.card};border:1px solid ${c.rule};border-radius:12px;padding:36px 32px;font-family:${FONT_STACK};">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:600;color:${c.heading};">${escapeHtml(content.heading)}</h1>
<p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:${c.body};">${escapeHtml(content.body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td align="center" bgcolor="${c.accent}" style="border-radius:8px;">
<a href="${url}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:${FONT_STACK};font-size:15px;font-weight:600;line-height:1;color:${c.onAccent};text-decoration:none;border-radius:8px;">${escapeHtml(content.actionLabel)}</a>
</td>
</tr>
</table>
<p style="margin:28px 0 0;font-size:13px;line-height:1.6;color:${c.muted};">${escapeHtml(content.expiry)}</p>
<p style="margin:24px 0 6px;padding-top:24px;border-top:1px solid ${c.rule};font-size:13px;line-height:1.6;color:${c.muted};">If the button doesn't work, copy and paste this link into your browser:</p>
<p style="margin:0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${url}" target="_blank" style="color:${c.accent};text-decoration:underline;">${url}</a></p>
</td>
</tr>
<tr>
<td style="padding:20px 4px 0;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${c.muted};">
${escapeHtml(content.disclaimer)}
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

function renderAccountLinkText(content: AccountLinkEmailContent): string {
  return `${content.heading}\n\n${content.body}\n\n${content.actionLabel}:\n${content.url}\n\n${content.expiry}\n\n${content.disclaimer}\n\n— ${PRODUCT_NAME}`;
}

function renderAccountLinkEmail(from: EmailSender, content: AccountLinkEmailContent): AccountEmail {
  return {
    from,
    subject: content.subject,
    html: renderAccountLinkHtml(content),
    text: renderAccountLinkText(content),
  };
}

export function renderAccountEmailVerificationEmail({ verificationUrl, from = DEFAULT_SENDER }: {
  verificationUrl: string;
  from?: EmailSender;
}): AccountEmail {
  return renderAccountLinkEmail(from, {
    subject: "Verify your Document Extraction account",
    preheader: "Confirm your email address to finish setting up your account.",
    heading: "Confirm your email address",
    body: "Thanks for signing up for Document Extraction. Confirm this is your email address to finish setting up your account.",
    actionLabel: "Verify email address",
    url: verificationUrl,
    expiry: "This link expires in 1 hour.",
    disclaimer: "If you did not create a Document Extraction account, you can ignore this email.",
  });
}

export function renderAccountPasswordResetEmail({ resetUrl, from = DEFAULT_SENDER }: {
  resetUrl: string;
  from?: EmailSender;
}): AccountEmail {
  return renderAccountLinkEmail(from, {
    subject: "Reset your Document Extraction password",
    preheader: "Use this link to choose a new password.",
    heading: "Reset your password",
    body: "We received a request to reset the password for your Document Extraction account. Choose a new password using the button below.",
    actionLabel: "Reset password",
    url: resetUrl,
    expiry: "This link expires in 1 hour.",
    disclaimer: "If you did not request a Document Extraction password reset, you can ignore this email. Your password will not change.",
  });
}

export function renderWorkspaceInvitationEmail(input: {
  workspaceName: string; inviterName: string; inviterEmail: string; email: string;
  role: "member" | "admin"; expiresAt: string; url: string; existingAccount: boolean; from?: EmailSender;
}): AccountEmail {
  const truncate = (value: string) => value.length > 80 ? value.slice(0, 80) + "…" : value;
  const expiry = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(input.expiresAt));

  const content: AccountLinkEmailContent = {
    subject: "You've been invited to a Workspace on Document Extraction",
    preheader: "You have a Workspace invitation.",
    heading: "Workspace invitation",
    body: `${truncate(input.inviterName)} (${input.inviterEmail}) invited you to ${truncate(input.workspaceName)} as ${input.role === "admin" ? "Admin" : "Member"}. ${input.existingAccount ? "Sign in and accept" : "Create an account with this address"}: ${input.email}.`,
    actionLabel: "Accept invitation",
    url: input.url,
    expiry: `This invitation expires on ${expiry} UTC.`,
    disclaimer: `Access requires an account or sign-in with this exact address: ${input.email}. You can ignore this email.`,
  };

  const rendered = renderAccountLinkEmail(input.from ?? DEFAULT_SENDER, content);

  return { ...rendered, text: `${content.actionLabel}:\n${input.url}\n\n${content.heading}\n\n${content.body}\n\n${content.expiry}\n\n${content.disclaimer}\n\n— ${PRODUCT_NAME}` };
}
