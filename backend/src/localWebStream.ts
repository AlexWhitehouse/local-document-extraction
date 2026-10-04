import { Readable } from "node:stream";
import { ReadableStream as NodeReadableStream } from "node:stream/web";

/** Check the Bun stream instance before entering the Node stream adapter. */
export function readableFromWeb(stream: ReadableStream<Uint8Array>): Readable {
  if (!(stream instanceof NodeReadableStream)) throw new TypeError("Expected a Web ReadableStream");

  return Readable.fromWeb(stream);
}
