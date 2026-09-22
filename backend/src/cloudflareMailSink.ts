import type { LocalMailSink } from "./localMailSink";

const MAX_EMAIL_REQUEST_BYTES = 128 * 1024;
const MAX_EMAIL_RESPONSE_BYTES = 64 * 1024;
const EMAIL_TIMEOUT_MS = 10000;

/** Cloudflare REST delivery; never persists or logs message contents or remote error bodies. */
export function createCloudflareMailSink({
  accountId,
  apiToken,
  fetcher = fetch,
}: {
  accountId: string;
  apiToken: string;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}): LocalMailSink {
  if (!/^[a-fA-F0-9]{32}$/.test(accountId) || !apiToken.trim() || /[\r\n\0]/.test(apiToken)) throw new Error("Cloudflare email credentials are invalid.");
  return {
    async capture(message) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
      try {
        const body = JSON.stringify({
          to: message.to,
          from: typeof message.from === "string" ? message.from : { address: message.from.email, name: message.from.name },
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        });
        if (Buffer.byteLength(body) > MAX_EMAIL_REQUEST_BYTES) throw new Error();
        const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`, {
          method: "POST",
          redirect: "error",
          headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
          body,
          signal: controller.signal,
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error(); }
        const reader = response.body?.getReader();
        if (!reader) throw new Error();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > MAX_EMAIL_RESPONSE_BYTES) { await reader.cancel(); throw new Error(); }
            chunks.push(chunk.value);
          }
        } finally { reader.releaseLock(); }
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          success?: boolean;
          result?: { delivered?: string[]; queued?: string[]; permanent_bounces?: string[] };
        };
        const delivery = result.result;
        if (result.success !== true || !delivery || !Array.isArray(delivery.delivered) || !Array.isArray(delivery.queued)
          || !Array.isArray(delivery.permanent_bounces) || delivery.permanent_bounces.length
          || ![...delivery.delivered, ...delivery.queued].includes(message.to)) throw new Error();
      } catch {
        throw new Error("Cloudflare email delivery failed. Check the account, sender domain and API token permissions.");
      } finally { clearTimeout(timer); }
    },
  };
}
