export function encodeModelPayloadBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}
