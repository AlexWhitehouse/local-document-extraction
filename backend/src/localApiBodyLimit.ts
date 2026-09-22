import { HttpError } from "./lib/http";

/** Buffer small API bodies once, before auth middleware or routes clone them. */
export async function boundLocalApiBody(request: Request, maximumBytes: number): Promise<Request> {
  if (!request.body) return request;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > maximumBytes) {
    void request.body.cancel().catch(() => {});
    throw tooLarge(maximumBytes);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        void reader.cancel().catch(() => {});
        throw tooLarge(maximumBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body });
}

function tooLarge(maximumBytes: number): HttpError {
  return new HttpError(413, "request_body_too_large", `API request body exceeds ${maximumBytes} bytes`);
}
