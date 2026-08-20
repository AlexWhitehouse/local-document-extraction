import { describe, expect, it } from "bun:test";

import { encodeModelPayloadBase64 } from "./modelPayloadBase64";

describe("encodeModelPayloadBase64", () => {
  it.each([
    0,
    1,
    2,
    3,
    32_767,
    32_768,
    32_769,
    (2 * 1024 * 1024) + 1,
  ])("matches the legacy gateway encoder for %i bytes", (size) => {
    const bytes = deterministicBytes(size);

    expect(encodeModelPayloadBase64(bytes.buffer as ArrayBuffer)).toBe(legacyBase64(bytes));
  });
});

function deterministicBytes(size: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_value, index) =>
    (index * 31 + 17) % 256
  );
}

function legacyBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
