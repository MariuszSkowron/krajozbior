// @ts-check
// Potok obróbki zdjęcia (5.3 kroki 4–6, E4-S7): typ po zawartości, limity, obrót według EXIF,
// sRGB, ponowne kodowanie do WebP w budżecie 300 KB. Ponowne kodowanie bez `withMetadata`
// usuwa EXIF, GPS, XMP, IPTC i profile ICC. Wywoływany w procesie potomnym (D-E4-4).

import sharp from "sharp";

import {
  MAIN_LONG_SIDE,
  MAX_INPUT_PIXELS,
  MAX_MAIN_BYTES,
  MAX_OG_BYTES,
  MIN_LONG_SIDE,
  MIN_QUALITY,
  MIN_SHORT_SIDE,
  OG_LONG_SIDE,
  QUALITY_STEP,
  RESHRINK_QUALITY,
  SHRINK_FACTOR,
  START_QUALITY,
  THUMB_QUALITY,
  THUMB_WIDTH,
} from "./budget.mjs";
import { sniffImageType } from "./sniff.mjs";

/** Błąd obróbki z kodem, który trasa mapuje na odpowiedź (415/422). */
export class PipelineError extends Error {
  /**
   * @param {"unsupported_type" | "animated_png" | "too_small" | "too_complex" | "processing_failed"} code
   */
  constructor(code) {
    super(code);
    this.name = "PipelineError";
    this.code = code;
  }
}

/** Licznik dekodowań wejścia (test pilnuje, że strategia budżetu nie dekoduje w pętli). */
export const decodeStats = { decodes: 0 };

/** @param {Buffer | Uint8Array} input */
const decoder = (input) => {
  decodeStats.decodes += 1;
  return sharp(input, {
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: "error",
    sequentialRead: true,
  });
};

/**
 * Potwierdza format i liczbę stron według libvips (obrona na wypadek rozjazdu z własnym
 * rozpoznaniem typu po zawartości).
 * @param {{ format?: string, pages?: number }} metadata
 */
export function assertSupportedMetadata(metadata) {
  if (metadata.format !== "jpeg" && metadata.format !== "png") {
    throw new PipelineError("unsupported_type");
  }
  if ((metadata.pages ?? 1) > 1) throw new PipelineError("processing_failed");
}

/**
 * Dekoduje wejście jeden raz: obrót według EXIF, sRGB i zmniejszenie do dłuższego boku
 * `MAIN_LONG_SIDE`; wynik to surowe piksele, z których pętla budżetu tylko koduje WebP.
 * @param {Buffer | Uint8Array} input
 */
async function decodeOnce(input) {
  const { data, info } = await decoder(input)
    .rotate()
    .toColourspace("srgb")
    .resize({
      width: MAIN_LONG_SIDE,
      height: MAIN_LONG_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, raw: { width: info.width, height: info.height, channels: info.channels } };
}

/**
 * @param {{ data: Buffer, raw: { width: number, height: number, channels: import("sharp").Channels } }} decoded
 * @param {number} longSide
 * @param {number} quality
 */
async function encodeMain(decoded, longSide, quality) {
  return sharp(decoded.data, { raw: decoded.raw })
    .resize({ width: longSide, height: longSide, fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });
}

/**
 * @param {Parameters<typeof encodeMain>[0]} decoded
 * @param {number} startQuality
 * @param {number} longSide
 */
async function encodeWithinBudget(decoded, startQuality, longSide) {
  for (let quality = startQuality; quality >= MIN_QUALITY; quality -= QUALITY_STEP) {
    const result = await encodeMain(decoded, longSide, quality);
    if (result.data.length <= MAX_MAIN_BYTES) return { ...result, quality };
  }
  return null;
}

/**
 * Strategia E4-S7: jakość 80 w dół do 45; potem dłuższy bok mniejszy o 15% na krok (najmniej
 * 1000 px) z jakością od 70 w dół do 45; inaczej `too_complex`.
 * @param {Buffer | Uint8Array} input
 * @param {number} longestSide dłuższy bok wejścia
 */
async function encodeMainFile(input, longestSide) {
  const decoded = await decodeOnce(input);
  let current = Math.min(MAIN_LONG_SIDE, longestSide);
  const first = await encodeWithinBudget(decoded, START_QUALITY, MAIN_LONG_SIDE);
  if (first) return first;
  for (;;) {
    const next = Math.max(MIN_LONG_SIDE, Math.floor(current * SHRINK_FACTOR));
    if (next >= current) throw new PipelineError("too_complex");
    current = next;
    const result = await encodeWithinBudget(decoded, RESHRINK_QUALITY, current);
    if (result) return result;
  }
}

/**
 * @param {Buffer} main
 */
async function encodeOgJpeg(main) {
  for (let quality = START_QUALITY; quality >= MIN_QUALITY; quality -= QUALITY_STEP) {
    const data = await sharp(main)
      .resize({
        width: OG_LONG_SIDE,
        height: OG_LONG_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (data.length <= MAX_OG_BYTES) return data;
  }
  throw new PipelineError("too_complex");
}

/**
 * @param {Buffer | Uint8Array} input zawartość pliku wejściowego
 * @param {{ minShortSide?: number, ogJpeg?: boolean }} [options] `minShortSide: 0` wyłącza próg
 *   (np. `commons_import`, A-S1); `ogJpeg` dodaje JPEG 1200 px do `og:image`
 * @returns {Promise<{ main: Buffer, thumb: Buffer, og?: Buffer, width: number, height: number, quality: number }>}
 */
export async function processImage(input, options = {}) {
  const minShortSide = options.minShortSide ?? MIN_SHORT_SIDE;
  const type = sniffImageType(input);
  if (type === "unsupported") throw new PipelineError("unsupported_type");
  if (type === "apng") throw new PipelineError("animated_png");
  try {
    const metadata = await decoder(input).metadata();
    assertSupportedMetadata(metadata);
    const rawWidth = metadata.width ?? 0;
    const rawHeight = metadata.height ?? 0;
    const swapped = (metadata.orientation ?? 1) >= 5;
    const width = swapped ? rawHeight : rawWidth;
    const height = swapped ? rawWidth : rawHeight;
    if (width * height === 0) throw new PipelineError("processing_failed");
    if (Math.min(width, height) < minShortSide) throw new PipelineError("too_small");
    const encoded = await encodeMainFile(input, Math.max(width, height));
    const thumb = await sharp(encoded.data)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
    const og = options.ogJpeg ? await encodeOgJpeg(encoded.data) : undefined;
    return {
      main: encoded.data,
      thumb,
      ...(og ? { og } : {}),
      width: encoded.info.width,
      height: encoded.info.height,
      quality: encoded.quality,
    };
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError("processing_failed");
  }
}
