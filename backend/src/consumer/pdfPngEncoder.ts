import type { Canvas } from "@napi-rs/canvas";
import { deflate, crc32 } from "node:zlib";

/** Lossless grayscale or RGBA PNG. Fast DEFLATE avoids Skia's expensive per-row filter search.
 * Keep the exact raster dimensions and pixels, including transparency.
 */
export async function encodePdfPng(canvas: Canvas): Promise<Buffer> {
  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let grayscale = true;

  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset] !== pixels[offset + 1] || pixels[offset] !== pixels[offset + 2] || pixels[offset + 3] !== 255) {
      grayscale = false;
      break;
    }
  }

  const stride = canvas.width * (grayscale ? 1 : 4);
  const rows = Buffer.alloc((stride + 1) * canvas.height);

  for (let y = 0; y < canvas.height; y++) {
    if (grayscale) {
      const source = y * canvas.width * 4;
      const destination = y * (stride + 1) + 1;

      for (let x = 0; x < canvas.width; x++) rows[destination + x] = pixels[source + x * 4]!;
    } else rows.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const compressed = await new Promise<Buffer>((resolve, reject) => {
    deflate(rows, { level: 3 }, (error, result) => error ? reject(error) : resolve(result));
  });

  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.width);
  header.writeUInt32BE(canvas.height, 4);
  header[8] = 8;
  header[9] = grayscale ? 0 : 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length);
  output.write(type, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(output.subarray(4, -4)), output.length - 4);

  return output;
}
