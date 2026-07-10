import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type LocalMailAddress = string | { email: string; name?: string };

export type LocalMailMessage = {
  type: "account_email_verification" | "account_password_reset";
  to: string;
  from: LocalMailAddress;
  subject: string;
  text: string;
  html?: string;
};

export type LocalMailSink = {
  capture(message: LocalMailMessage): Promise<void>;
};

export type LocalMailLogger = {
  info(...args: unknown[]): void;
};

export function createLocalMailSink({
  directory,
  logger = console,
  now = () => new Date(),
}: {
  directory: string;
  logger?: LocalMailLogger;
  now?: () => Date;
}): LocalMailSink {
  return {
    async capture(message) {
      const occurredAt = now();
      const actionUrl = extractActionUrl(message.text);
      const record = {
        occurred_at: occurredAt.toISOString(),
        type: message.type,
        to: message.to,
        from: message.from,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(actionUrl ? { action_url: actionUrl } : {}),
      };

      await mkdir(directory, { recursive: true });
      await appendFile(join(directory, `${localDay(occurredAt)}.jsonl`), `${JSON.stringify(record)}\n`, "utf8");

      if (actionUrl) {
        logger.info(`Local mail ${message.type} for ${message.to}: ${actionUrl}`);
      } else {
        logger.info(`Local mail ${message.type} captured for ${message.to}`);
      }
    },
  };
}

function localDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function extractActionUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>'"]+/);
  return match?.[0] || null;
}
