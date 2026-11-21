export type ProcessingErrorCode =
  "unsupported_type" | "animated_png" | "too_small" | "too_complex" | "processing_failed";

const CODES: readonly ProcessingErrorCode[] = [
  "unsupported_type",
  "animated_png",
  "too_small",
  "too_complex",
  "processing_failed",
];

export function isProcessingErrorCode(value: unknown): value is ProcessingErrorCode {
  return CODES.includes(value as ProcessingErrorCode);
}

/** Błąd obróbki pliku; kod mapuje trasa na odpowiedź (5.3: 415 albo 422). */
export class MediaProcessingError extends Error {
  readonly code: ProcessingErrorCode;

  constructor(code: ProcessingErrorCode) {
    super(code);
    this.name = "MediaProcessingError";
    this.code = code;
  }
}

/** Status HTTP odpowiadający kodowi (typ pliku → 415, reszta → 422). */
export function httpStatusForProcessingError(code: ProcessingErrorCode): 415 | 422 {
  return code === "unsupported_type" || code === "animated_png" ? 415 : 422;
}
