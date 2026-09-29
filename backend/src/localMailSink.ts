import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { assertRegularStateFile, ensurePrivateStateDirectory } from "./localStatePaths";

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
      const actionUrl = message.text.match(/https?:\/\/[^\s<>'"]+/)?.[0];
      const record = {
        occurred_at: now().toISOString(),
        type: message.type,
        to: message.to,
        from: message.from,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(actionUrl ? { action_url: actionUrl } : {}),
      };

      await ensurePrivateStateDirectory(directory, { recursive: true });
      const path = join(directory, `${record.occurred_at.slice(0, 10)}.jsonl`);
      await assertRegularStateFile(path);
      const file = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      try {
        await file.chmod(0o600);
        await file.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      } finally { await file.close(); }

      logger.info(actionUrl
        ? `Local mail ${message.type} for ${message.to}: ${actionUrl}`
        : `Local mail ${message.type} captured for ${message.to}`);
    },
  };
}
