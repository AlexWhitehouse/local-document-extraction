export type TransactionalEmailMessage = {
  from: string | EmailAddress;
  to: string | EmailAddress | (string | EmailAddress)[];
  subject: string;
  text: string;
  html?: string;
};

export type TransactionalEmailLogger = {
  error(message: string, error: unknown): void;
};

export async function sendTransactionalEmail(
  email: Env["EMAIL"],
  message: TransactionalEmailMessage,
): Promise<void> {
  const result = await email.send(message);
  disposeEmailSendResult(result);
}

function disposeEmailSendResult(result: EmailSendResult): void {
  const maybeDisposable = result as EmailSendResult & { dispose?: () => void };
  maybeDisposable.dispose?.();
}

export function scheduleTransactionalEmailSend({
  email,
  message,
  ctx,
  logger = console,
}: {
  email: Env["EMAIL"];
  message: TransactionalEmailMessage;
  ctx?: ExecutionContext;
  logger?: TransactionalEmailLogger;
}): void {
  const sendPromise = sendTransactionalEmail(email, message).catch((error) => {
    logger.error("Transactional email send failed", error);
  });

  if (ctx) {
    ctx.waitUntil(sendPromise);
  }
}
