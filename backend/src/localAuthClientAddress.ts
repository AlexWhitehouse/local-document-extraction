import { isIP } from "node:net";

const peerAddresses = new WeakMap<Request, string>();

export const LOCAL_AUTH_CLIENT_ADDRESS_HEADER = "x-document-extraction-client-address";

/** The Bun listener records transport metadata; no inbound header can set it. */
export function setLocalAuthRequestPeerAddress(request: Request, address: string | null | undefined): void {
  if (address && isIP(address)) peerAddresses.set(request, address);
  else peerAddresses.delete(request);
}

/** Preserve transport identity when the bounded body reader replaces a Request. */
export function copyLocalAuthRequestPeerAddress(source: Request, destination: Request): Request {
  const address = peerAddresses.get(source);

  if (address) peerAddresses.set(destination, address);

  return destination;
}

/** Only configured, single-address proxy headers may override the socket peer. */
export function localAuthRequestHeaders(request: Request, trustedIpHeaders: string[]): Headers {
  const headers = new Headers(request.headers);
  headers.delete(LOCAL_AUTH_CLIENT_ADDRESS_HEADER);
  let address: string | undefined;

  for (const name of trustedIpHeaders) {
    if (name.toLowerCase() === LOCAL_AUTH_CLIENT_ADDRESS_HEADER) continue;
    const value = request.headers.get(name)?.trim();

    // An appending forwarding proxy leaves its leftmost token client-controlled.
    // Operators must configure a proxy that overwrites a single-address header.
    if (value && !value.includes(",") && isIP(value)) {
      address = value;
      break;
    }
  }

  address ??= peerAddresses.get(request);

  if (address) headers.set(LOCAL_AUTH_CLIENT_ADDRESS_HEADER, address);

  return headers;
}
