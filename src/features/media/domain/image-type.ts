import { sniffImageType } from "../worker/sniff.mjs";

import type { ProcessingErrorCode } from "./processing-error";

export type DetectedImageType =
  | { ok: true; type: "jpeg" | "png" }
  | { ok: false; code: Extract<ProcessingErrorCode, "unsupported_type" | "animated_png"> };

/** Typ po zawartości pliku (JPEG, PNG); animowany PNG jest odrzucany (5.3 krok 4). */
export function detectImageType(bytes: Uint8Array): DetectedImageType {
  const sniffed = sniffImageType(bytes);
  if (sniffed === "jpeg" || sniffed === "png") return { ok: true, type: sniffed };
  return { ok: false, code: sniffed === "apng" ? "animated_png" : "unsupported_type" };
}
