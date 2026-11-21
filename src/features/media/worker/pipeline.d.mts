export type PipelineErrorCode =
  "unsupported_type" | "animated_png" | "too_small" | "too_complex" | "processing_failed";

export class PipelineError extends Error {
  constructor(code: PipelineErrorCode);
  readonly code: PipelineErrorCode;
}

export type ProcessImageOptions = {
  /** Najmniejszy krótszy bok; 0 wyłącza próg. */
  minShortSide?: number;
  /** Dodaje JPEG 1200 px do `og:image`. */
  ogJpeg?: boolean;
};

export type ProcessedImage = {
  main: Buffer;
  thumb: Buffer;
  og?: Buffer;
  width: number;
  height: number;
  quality: number;
};

/** Licznik dekodowań wejścia (testy pilnują ograniczenia). */
export const decodeStats: { decodes: number };

/** Potwierdza format (jpeg/png) i liczbę stron (najwyżej 1) według libvips. */
export function assertSupportedMetadata(metadata: { format?: string; pages?: number }): void;

/** JPEG 1200 px do `og:image` z pliku głównego (WebP własnego wytworu); `too_complex` ponad budżet. */
export function encodeOgJpeg(main: Buffer): Promise<Buffer>;

export function processImage(
  input: Buffer | Uint8Array,
  options?: ProcessImageOptions,
): Promise<ProcessedImage>;
