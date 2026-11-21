import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { MAX_MAIN_BYTES, MAX_OG_BYTES } from "@/features/media/domain/limits";
import { PipelineError, processImage } from "@/features/media/worker/pipeline.mjs";
import {
  buildGrayPng,
  FAKE_AUTHOR,
  FAKE_XMP_MARKER,
  jpegWithMetadata,
  noiseImage,
  pngChunk,
  randomImage,
} from "../../support/photo-fixtures";

// Potok korzysta z prawdziwego `sharp`; generowanie dużych obrazów chwilę trwa.
const SLOW = 60_000;

async function failureOf(input: Buffer, options?: Parameters<typeof processImage>[1]) {
  try {
    await processImage(input, options);
  } catch (error) {
    if (error instanceof PipelineError) return error.code;
    throw error;
  }
  return "no-error";
}

describe("potok obróbki zdjęć (prawdziwy sharp)", () => {
  it(
    "usuwa EXIF, GPS, XMP i dane autora z pliku głównego i miniatury",
    async () => {
      const input = await jpegWithMetadata({ width: 1200, height: 800 });
      const before = await sharp(input).metadata();
      expect(before.exif).toBeDefined();
      expect(before.xmp).toBeDefined();
      expect(input.includes(FAKE_AUTHOR)).toBe(true);
      expect(input.includes(FAKE_XMP_MARKER)).toBe(true);

      const result = await processImage(input);
      for (const file of [result.main, result.thumb]) {
        const metadata = await sharp(file).metadata();
        expect(metadata.format).toBe("webp");
        expect(metadata.exif).toBeUndefined();
        expect(metadata.xmp).toBeUndefined();
        expect(metadata.icc).toBeUndefined();
        expect(file.includes(FAKE_AUTHOR)).toBe(false);
        expect(file.includes(FAKE_XMP_MARKER)).toBe(false);
        expect(file.includes("Exif")).toBe(false);
        expect(file.includes("XMP")).toBe(false);
      }
    },
    SLOW,
  );

  it(
    "obraca zdjęcie według znacznika orientacji i zdejmuje znacznik",
    async () => {
      const input = await jpegWithMetadata({ width: 1200, height: 800, orientation: 6 });
      expect((await sharp(input).metadata()).orientation).toBe(6);
      const result = await processImage(input);
      expect(result.width).toBe(800);
      expect(result.height).toBe(1200);
      const metadata = await sharp(result.main).metadata();
      expect(metadata.orientation).toBeUndefined();
      expect([metadata.width, metadata.height]).toEqual([800, 1200]);
    },
    SLOW,
  );

  it(
    "tworzy miniaturę 400 px szerokości wywiedzioną z pliku głównego",
    async () => {
      const result = await processImage(await jpegWithMetadata({ width: 1200, height: 800 }));
      const thumb = await sharp(result.thumb).metadata();
      expect(thumb.width).toBe(400);
      expect(result.thumb.length).toBeLessThan(result.main.length);
      expect(result.og).toBeUndefined();
    },
    SLOW,
  );

  it("nie powiększa mniejszych zdjęć i przyjmuje PNG z przezroczystością", async () => {
    const png = await sharp({
      create: {
        width: 700,
        height: 650,
        channels: 4,
        background: { r: 10, g: 200, b: 10, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const result = await processImage(png);
    expect([result.width, result.height]).toEqual([700, 650]);
  });

  it(
    "mieści w budżecie 300 KB, obniżając jakość od 80",
    async () => {
      const input = await noiseImage(2400, 1600, 20).jpeg({ quality: 90 }).toBuffer();
      const result = await processImage(input);
      expect(result.main.length).toBeLessThanOrEqual(MAX_MAIN_BYTES);
      expect(result.quality).toBeLessThan(80);
      expect(result.quality).toBeGreaterThanOrEqual(45);
      expect(Math.max(result.width, result.height)).toBe(1600);
    },
    SLOW,
  );

  it(
    "nie pogarsza zdjęcia mieszczącego się w budżecie przy jakości 80",
    async () => {
      const input = await noiseImage(2400, 1600, 8).jpeg({ quality: 90 }).toBuffer();
      const result = await processImage(input);
      expect(result.quality).toBe(80);
      expect(result.main.length).toBeLessThanOrEqual(MAX_MAIN_BYTES);
    },
    SLOW,
  );

  it(
    "zmniejsza dłuższy bok, gdy sama jakość nie wystarcza (nie poniżej 1000 px)",
    async () => {
      const input = await noiseImage(4000, 3000, 60).jpeg({ quality: 90 }).toBuffer();
      const result = await processImage(input);
      expect(result.main.length).toBeLessThanOrEqual(MAX_MAIN_BYTES);
      const longSide = Math.max(result.width, result.height);
      expect(longSide).toBeLessThan(1600);
      expect(longSide).toBeGreaterThanOrEqual(1000);
    },
    SLOW,
  );

  it(
    "odrzuca zdjęcie, którego nie da się zmieścić w budżecie (too_complex)",
    async () => {
      // 1000 x 750 to już najmniejszy dłuższy bok strategii, więc dalszego zmniejszania nie ma.
      const input = await randomImage(1000, 750).png().toBuffer();
      expect(await failureOf(input)).toBe("too_complex");
    },
    SLOW,
  );

  it(
    "odrzuca małe zdjęcie, które nie mieści się w budżecie, bez dalszego zmniejszania",
    async () => {
      const input = await randomImage(900, 700).png().toBuffer();
      expect(await failureOf(input, { minShortSide: 0 })).toBe("too_complex");
    },
    SLOW,
  );

  it("odrzuca krótszy bok poniżej progu, a próg 0 go wyłącza (commons_import)", async () => {
    const small = await noiseImage(500, 400, 8).jpeg().toBuffer();
    expect(await failureOf(small)).toBe("too_small");
    const rotated = await jpegWithMetadata({ width: 900, height: 500, orientation: 6 });
    expect(await failureOf(rotated)).toBe("too_small");
    const accepted = await processImage(small, { minShortSide: 0 });
    expect([accepted.width, accepted.height]).toEqual([500, 400]);
  });

  it(
    "do og:image dokłada JPEG 1200 px w budżecie 200 KB",
    async () => {
      const input = await noiseImage(2400, 1600, 20).jpeg({ quality: 90 }).toBuffer();
      const result = await processImage(input, { ogJpeg: true });
      expect(result.og).toBeDefined();
      const og = await sharp(result.og).metadata();
      expect(og.format).toBe("jpeg");
      expect(Math.max(og.width ?? 0, og.height ?? 0)).toBe(1200);
      expect(result.og?.length).toBeLessThanOrEqual(MAX_OG_BYTES);
    },
    SLOW,
  );

  describe("pliki podejrzane", () => {
    it("poliglota JPEG z doklejonym kodem i archiwum nie przenosi dopisanych bajtów", async () => {
      const jpeg = await noiseImage(800, 700, 8).jpeg().toBuffer();
      const payload = Buffer.from(
        "<?php echo 'fikcyjny-ladunek'; ?>PK\x03\x04fikcyjne-archiwum",
        "latin1",
      );
      const polyglot = Buffer.concat([jpeg, payload]);
      const result = await processImage(polyglot);
      for (const file of [result.main, result.thumb]) {
        expect(file.includes("<?php")).toBe(false);
        expect(file.includes("fikcyjny-ladunek")).toBe(false);
        expect(file.includes("PK\x03\x04")).toBe(false);
        expect((await sharp(file).metadata()).format).toBe("webp");
      }
    });

    it("PNG z blokiem tekstowym z HTML nie przenosi go do wyniku", async () => {
      const text = pngChunk("tEXt", Buffer.from("Comment\0<script>fikcyjny()</script>", "latin1"));
      const base = await noiseImage(800, 700, 8).png().toBuffer();
      // Wstawiamy blok tekstowy tuż po sygnaturze i IHDR (33 bajty).
      const png = Buffer.concat([base.subarray(0, 33), text, base.subarray(33)]);
      const result = await processImage(png);
      expect(result.main.includes("<script>")).toBe(false);
    });

    it(
      "PNG-bomba (64 Mpx, kilka KB) przekracza limit pikseli i jest odrzucona",
      async () => {
        const bomb = buildGrayPng(8000, 8000);
        expect(bomb.length).toBeLessThan(200 * 1024);
        const started = Date.now();
        expect(await failureOf(bomb, { minShortSide: 0 })).toBe("processing_failed");
        expect(Date.now() - started).toBeLessThan(10_000);
      },
      SLOW,
    );

    it("odrzuca animowany PNG (APNG) przed `sharp`", async () => {
      const apng = buildGrayPng(700, 700, [pngChunk("acTL", Buffer.alloc(8))]);
      expect(await failureOf(apng)).toBe("animated_png");
    });

    it("odrzuca typy inne niż JPEG i PNG, także z podrobionym rozszerzeniem", async () => {
      const webp = await noiseImage(700, 700, 8).webp().toBuffer();
      const gif = await noiseImage(700, 700, 8).gif().toBuffer();
      for (const bytes of [webp, gif, Buffer.from("<html></html>"), Buffer.alloc(0)]) {
        expect(await failureOf(bytes)).toBe("unsupported_type");
      }
    });

    it("odrzuca uszkodzony (ucięty) JPEG jako processing_failed (failOn: error)", async () => {
      const jpeg = await noiseImage(1000, 800, 20).jpeg().toBuffer();
      expect(await failureOf(jpeg.subarray(0, Math.floor(jpeg.length / 2)))).toBe(
        "processing_failed",
      );
    });

    it("odrzuca PNG z nagłówkiem bez treści jako processing_failed", async () => {
      const png = buildGrayPng(700, 700).subarray(0, 40);
      expect(await failureOf(png)).toBe("processing_failed");
    });
  });
});
