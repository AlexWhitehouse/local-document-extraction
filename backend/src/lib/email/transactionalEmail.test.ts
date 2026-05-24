import { describe, expect, it, vi } from "vitest";

import { scheduleTransactionalEmailSend, sendTransactionalEmail } from "./transactionalEmail";

describe("Transactional email scheduling", () => {
  it("sends a caller-provided transactional email through the Worker EMAIL binding", async () => {
    const send = vi.fn().mockResolvedValue({});
    const message = {
      from: { name: "Document Extraction", email: "no-reply@extract.t3m.uk" },
      to: "ada@example.com",
      subject: "Verify your Document Extraction account",
      text: "Verify your account",
      html: "<p>Verify your account</p>",
    };

    await sendTransactionalEmail({ send } as unknown as Env["EMAIL"], message);

    expect(send).toHaveBeenCalledWith(message);
  });

  it("disposes the Worker EMAIL binding result when the runtime exposes disposal", async () => {
    const dispose = vi.fn();
    const send = vi.fn().mockResolvedValue({ messageId: "email-message-id", dispose });

    await sendTransactionalEmail(
      { send } as unknown as Env["EMAIL"],
      {
        from: { name: "Document Extraction", email: "no-reply@extract.t3m.uk" },
        to: "ada@example.com",
        subject: "Verify your Document Extraction account",
        text: "Verify your account",
      },
    );

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("schedules email delivery with Worker waitUntil when scheduling context is provided", async () => {
    const send = vi.fn().mockResolvedValue({});
    const waitUntil = vi.fn();

    scheduleTransactionalEmailSend({
      email: { send } as unknown as Env["EMAIL"],
      ctx: { waitUntil } as unknown as ExecutionContext,
      message: {
        from: { name: "Document Extraction", email: "no-reply@extract.t3m.uk" },
        to: "ada@example.com",
        subject: "Verify your Document Extraction account",
        text: "Verify your account",
        html: "<p>Verify your account</p>",
      },
    });

    expect(waitUntil).toHaveBeenCalledOnce();
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith({
      from: { name: "Document Extraction", email: "no-reply@extract.t3m.uk" },
      to: "ada@example.com",
      subject: "Verify your Document Extraction account",
      text: "Verify your account",
      html: "<p>Verify your account</p>",
    });
  });

  it("logs scheduled send failures without throwing synchronously", async () => {
    const error = new Error("Email service unavailable");
    const send = vi.fn().mockRejectedValue(error);
    const waitUntil = vi.fn();
    const logger = { error: vi.fn() };

    expect(() => {
      scheduleTransactionalEmailSend({
        email: { send } as unknown as Env["EMAIL"],
        ctx: { waitUntil } as unknown as ExecutionContext,
        logger,
        message: {
          from: { name: "Document Extraction", email: "no-reply@extract.t3m.uk" },
          to: "ada@example.com",
          subject: "Verify your Document Extraction account",
          text: "Verify your account",
        },
      });
    }).not.toThrow();

    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith("Transactional email send failed", error);
  });
});
