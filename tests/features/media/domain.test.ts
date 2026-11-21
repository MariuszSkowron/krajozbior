import { describe, expect, it } from "vitest";

import {
  checkFreeSpace,
  evaluateFreeSpace,
  parseMinFreePercent,
} from "@/features/media/domain/free-space";
import { detectImageType } from "@/features/media/domain/image-type";
import {
  DEFAULT_MIN_FREE_PERCENT,
  MAX_MAIN_BYTES,
  MAX_OG_BYTES,
  PROCESS_TIMEOUT_MS,
} from "@/features/media/domain/limits";
import { isMediaKey, mediaDirectory, mediaFilePath } from "@/features/media/domain/media-key";
import {
  httpStatusForProcessingError,
  isProcessingErrorCode,
  MediaProcessingError,
} from "@/features/media/domain/processing-error";
import { buildGrayPng, pngChunk } from "../../support/photo-fixtures";

describe("limity", () => {
  it("budżet pliku głównego to 300 KB, og 200 KB, proces 20 s, strażnik 15%", () => {
    expect(MAX_MAIN_BYTES).toBe(300 * 1024);
    expect(MAX_OG_BYTES).toBe(200 * 1024);
    expect(PROCESS_TIMEOUT_MS).toBe(20_000);
    expect(DEFAULT_MIN_FREE_PERCENT).toBe(15);
  });
});

describe("detectImageType", () => {
  it("rozpoznaje JPEG i PNG po zawartości", () => {
    expect(detectImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      ok: true,
      type: "jpeg",
    });
    expect(detectImageType(buildGrayPng(2, 2))).toEqual({ ok: true, type: "png" });
  });

  it("odrzuca animowany PNG (blok acTL przed IDAT)", () => {
    const apng = buildGrayPng(2, 2, [pngChunk("acTL", Buffer.alloc(8))]);
    expect(detectImageType(apng)).toEqual({ ok: false, code: "animated_png" });
  });

  it("nie szuka acTL po IDAT i znosi uciętego PNG", () => {
    const late = Buffer.concat([buildGrayPng(2, 2), pngChunk("acTL", Buffer.alloc(8))]);
    expect(detectImageType(late)).toEqual({ ok: true, type: "png" });
    const truncated = buildGrayPng(2, 2).subarray(0, 20);
    expect(detectImageType(truncated)).toEqual({ ok: true, type: "png" });
  });

  it("odrzuca WebP, GIF, tekst i pusty plik", () => {
    const webp = Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1");
    for (const bytes of [webp, Buffer.from("GIF89a"), Buffer.from("<?php"), new Uint8Array()]) {
      expect(detectImageType(bytes)).toEqual({ ok: false, code: "unsupported_type" });
    }
  });

  it("odrzuca PNG ze zbyt krótką sygnaturą", () => {
    expect(detectImageType(Uint8Array.from([0x89, 0x50, 0x4e]))).toEqual({
      ok: false,
      code: "unsupported_type",
    });
  });
});

describe("błędy obróbki", () => {
  it("mapuje kody na statusy HTTP", () => {
    expect(httpStatusForProcessingError("unsupported_type")).toBe(415);
    expect(httpStatusForProcessingError("animated_png")).toBe(415);
    expect(httpStatusForProcessingError("too_small")).toBe(422);
    expect(httpStatusForProcessingError("too_complex")).toBe(422);
    expect(httpStatusForProcessingError("processing_failed")).toBe(422);
  });

  it("rozpoznaje poprawne kody", () => {
    expect(isProcessingErrorCode("too_small")).toBe(true);
    expect(isProcessingErrorCode("nope")).toBe(false);
    expect(isProcessingErrorCode(undefined)).toBe(false);
  });

  it("MediaProcessingError niesie kod", () => {
    const error = new MediaProcessingError("too_complex");
    expect(error.code).toBe("too_complex");
    expect(error.name).toBe("MediaProcessingError");
    expect(error.message).toBe("too_complex");
  });
});

describe("klucze i ścieżki plików", () => {
  const key = "a1b2c3d4-e5f6-4789-8abc-0123456789ab";

  it("buduje ścieżkę {p|e}/{2 znaki}/{klucz}/{wariant}", () => {
    expect(mediaDirectory("place", key)).toBe(`p/a1/${key}`);
    expect(mediaDirectory("explorer", key)).toBe(`e/a1/${key}`);
    expect(mediaFilePath("place", key, "main")).toBe(`p/a1/${key}/main.webp`);
    expect(mediaFilePath("place", key, "w400")).toBe(`p/a1/${key}/w400.webp`);
    expect(mediaFilePath("explorer", key, "og")).toBe(`e/a1/${key}/og.jpg`);
  });

  it("odrzuca klucze mogące wyjść ze ścieżki", () => {
    for (const bad of [
      "",
      "../etc/passwd",
      "a/b/cdefgh",
      "ab",
      "..\\x\\yzabc",
      "a b c d e f",
      `${"a".repeat(65)}`,
    ]) {
      expect(isMediaKey(bad)).toBe(false);
      expect(() => mediaDirectory("place", bad)).toThrow("Nieprawidłowy klucz");
    }
    expect(isMediaKey(key)).toBe(true);
  });
});

describe("strażnik wolnego miejsca", () => {
  it("przepuszcza przy wolnym miejscu równym lub większym od progu", () => {
    expect(evaluateFreeSpace({ freeBytes: 15, totalBytes: 100 }, 15)).toEqual({
      ok: true,
      freePercent: 15,
    });
    expect(evaluateFreeSpace({ freeBytes: 50, totalBytes: 100 }, 15).ok).toBe(true);
  });

  it("wstrzymuje wgrywanie poniżej progu (uploads_paused)", () => {
    const verdict = evaluateFreeSpace({ freeBytes: 14, totalBytes: 100 }, 15);
    expect(verdict).toMatchObject({ ok: false, reason: "uploads_paused" });
    expect(verdict.freePercent).toBeCloseTo(14);
  });

  it("zerowy rozmiar wolumenu traktuje jak brak miejsca", () => {
    expect(evaluateFreeSpace({ freeBytes: 0, totalBytes: 0 }, 15)).toMatchObject({
      ok: false,
      freePercent: 0,
    });
  });

  it("awaria odczytu miejsca (statfs) wstrzymuje wgrywanie zamiast je przepuścić", async () => {
    const failing = async () => {
      throw new Error("statfs padł");
    };
    expect(await checkFreeSpace(failing, 15)).toEqual({ ok: false, reason: "space_unreadable" });
    const healthy = async () => ({ freeBytes: 50, totalBytes: 100 });
    expect(await checkFreeSpace(healthy, 15)).toEqual({ ok: true, freePercent: 50 });
  });

  it("parsuje MEDIA_MIN_FREE_PERCENT z wartością domyślną 15", () => {
    expect(parseMinFreePercent(undefined)).toBe(15);
    expect(parseMinFreePercent("  ")).toBe(15);
    expect(parseMinFreePercent("abc")).toBe(15);
    expect(parseMinFreePercent("-1")).toBe(15);
    expect(parseMinFreePercent("101")).toBe(15);
    expect(parseMinFreePercent("20")).toBe(20);
    expect(parseMinFreePercent("0")).toBe(0);
  });
});
