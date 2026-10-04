import { isString } from "../../../shared/json";

/** Preserve omitted bodies and headers in HTTP fixtures, including multipart payloads. */
export function fixtureRequestInit(
  method: string,
  body: import("../../../shared/json").JsonValue | FormData | undefined,
  headers: HeadersInit = {},
): RequestInit {
  const init: RequestInit = { method, headers: new Headers(headers) };

  if (body !== undefined) {
    if (body instanceof FormData) {
      init.body = body;
    } else {
      const requestHeaders = new Headers(headers);

      if (!requestHeaders.has("content-type")) requestHeaders.set("content-type", "application/json");
      init.headers = requestHeaders;
      init.body = JSON.stringify(body);
    }
  }

  return init;
}

/** Assert the gateway seam received the serialized body promised by its request contract. */
export function textRequestBody(value: BodyInit | null | undefined): string {
  if (!isString(value)) throw new Error("Expected a serialized text request body");

  return value;
}

/** Bun accepts a streaming request body with the Fetch duplex extension. */
export function streamingRequest(url: string, init: RequestInit & { duplex: "half" }): Request {
  return new Request(url, init);
}
