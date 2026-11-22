// Fikstury zdjęć budowane w teście: wyłącznie dane fikcyjne i wygenerowane (bez zdjęć z sieci
// i bez prawdziwych osób).
import { randomBytes } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

import sharp from "sharp";

export const FAKE_AUTHOR = "Fikcyjny Autor Testowy";
export const FAKE_XMP_MARKER = "fikcyjny-znacznik-xmp";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngChunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const body = Buffer.concat([head.subarray(4), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, data, tail]);
}

/** PNG w skali szarości z samych zer; bloki dodatkowe trafiają przed pierwszy `IDAT`. */
export function buildGrayPng(
  width: number,
  height: number,
  extraChunks: Buffer[] = [],
  trailing: Buffer = Buffer.alloc(0),
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // głębia bitowa
  ihdr[9] = 0; // skala szarości
  const raw = Buffer.alloc((width + 1) * height);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    ...extraChunks,
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND"),
    trailing,
  ]);
}

/** Obraz o dużej entropii (szum), żeby plik WebP trudno było zmieścić w budżecie. */
export function noiseImage(width: number, height: number, sigma: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
      noise: { type: "gaussian", mean: 128, sigma },
    },
  });
}

/** Obraz z jednostajnie losowych pikseli: nie da się go zmieścić w budżecie (`too_complex`). */
export function randomImage(width: number, height: number) {
  return sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } });
}

/** JPEG z metadanymi, których obróbka ma nie przepuścić: autor, GPS, XMP i znacznik orientacji. */
export async function jpegWithMetadata(options: {
  width: number;
  height: number;
  orientation?: number;
  sigma?: number;
}): Promise<Buffer> {
  return noiseImage(options.width, options.height, options.sigma ?? 8)
    .withExif({
      IFD0: { Copyright: FAKE_AUTHOR, Make: "FikcyjnyAparat" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "52/1 13/1 5/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "21/1 0/1 30/1",
      },
    })
    .withMetadata({ orientation: options.orientation ?? 1 })
    .withXmp(
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>${FAKE_XMP_MARKER}</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>`,
    )
    .jpeg({ quality: 85 })
    .toBuffer();
}
