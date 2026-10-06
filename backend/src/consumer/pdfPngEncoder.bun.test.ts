import { createCanvas, loadImage } from "@napi-rs/canvas";
import { expect, test } from "bun:test";
import { encodePdfPng } from "./pdfPngEncoder";

test("fast PNG preserves native encoder dimensions and decoded RGBA pixels", async () => {
  for (const [width, height] of [[1, 1], [137, 91], [2048, 12]]) {
    const canvas = createCanvas(width!, height!);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(13, 87, 191, 0.43)";
    context.fillRect(0, 0, canvas.width / 2, canvas.height);
    context.fillStyle = "black";
    context.font = "12px sans-serif";
    context.fillText("Invoice £123.45 — café", 1, 15);
    context.clearRect(0, 0, 1, 1);

    const decode = async (png: Buffer) => {
      const image = await loadImage(png);
      expect([image.width, image.height]).toEqual([canvas.width, canvas.height]);
      const decoded = createCanvas(image.width, image.height);
      decoded.getContext("2d").drawImage(image, 0, 0);

      return Buffer.from(decoded.getContext("2d").getImageData(0, 0, image.width, image.height).data);
    };

    expect(await decode(await encodePdfPng(canvas))).toEqual(await decode(await canvas.encode("png")));
  }
});


test("opaque grayscale pages use exact 8-bit grayscale without quantization", async () => {
  const canvas = createCanvas(256, 32);
  const context = canvas.getContext("2d");

  for (let shade = 0; shade < 256; shade++) {
    context.fillStyle = `rgb(${shade},${shade},${shade})`;
    context.fillRect(shade, 0, 1, 32);
  }

  const png = await encodePdfPng(canvas);
  expect(png[25]).toBe(0);
  const decoded = createCanvas(256, 32);
  decoded.getContext("2d").drawImage(await loadImage(png), 0, 0);
  expect(Buffer.from(decoded.getContext("2d").getImageData(0, 0, 256, 32).data)).toEqual(Buffer.from(context.getImageData(0, 0, 256, 32).data));
  context.clearRect(0, 0, 1, 1);
  expect((await encodePdfPng(canvas))[25]).toBe(6);
});
