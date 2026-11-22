import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_INPUT_BYTES } from "@/features/media/domain/limits";
import { MediaProcessingError } from "@/features/media/domain/processing-error";
import {
  defaultWorkerPath,
  ogFromMainBytes,
  parseOgReply,
  processImageBytes,
  runImageWorker,
} from "@/features/media/infrastructure/image-processor";
import { buildGrayPng, jpegWithMetadata, noiseImage, pngChunk } from "../../support/photo-fixtures";

const worker = (name: string) => resolve("tests/support/media-workers", name);

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilDead(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!isAlive(pid)) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MediaProcessingError) return error.code;
    throw error;
  }
  return "no-error";
}

describe("proces potomny obróbki zdjęć", () => {
  let tmpDirectory: string;

  beforeEach(async () => {
    tmpDirectory = await mkdtemp(join(tmpdir(), "krajozbior-media-"));
  });

  afterEach(async () => {
    await rm(tmpDirectory, { recursive: true, force: true });
  });

  it("liczy ścieżkę procesu od process.cwd(), nie od import.meta.url", () => {
    expect(defaultWorkerPath()).toBe(
      join(process.cwd(), "src", "features", "media", "worker", "process-image.mjs"),
    );
  });

  it("przetwarza zdjęcie w procesie potomnym i sprząta plik wejściowy", async () => {
    const input = await jpegWithMetadata({ width: 1200, height: 800, orientation: 6 });
    const result = await processImageBytes(input, { tmpDirectory, ogJpeg: true });
    expect(result.main.length).toBeLessThanOrEqual(300 * 1024);
    expect([result.width, result.height]).toEqual([800, 1200]);
    expect((await sharp(result.main).metadata()).exif).toBeUndefined();
    expect(result.og).toBeDefined();
    expect(await readdir(tmpDirectory)).toEqual([]);
  }, 60_000);

  it("robi JPEG do og z istniejącego main.webp w procesie potomnym i sprząta plik wejściowy (E4-3)", async () => {
    const main = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: { r: 40, g: 90, b: 140 } },
    })
      .webp()
      .toBuffer();
    const og = await ogFromMainBytes(main, { tmpDirectory });
    const meta = await sharp(og).metadata();

    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(1200);
    expect(og.length).toBeLessThanOrEqual(200 * 1024);
    expect(await readdir(tmpDirectory)).toEqual([]);
  }, 60_000);

  it("og z main.webp odrzuca wejście, które nie jest pojedynczym WebP w budżecie (JPEG, śmieci, pusty, za duży)", async () => {
    const jpeg = await jpegWithMetadata({ width: 400, height: 300 });

    expect(await codeOf(ogFromMainBytes(jpeg, { tmpDirectory }))).toBe("processing_failed");
    expect(await codeOf(ogFromMainBytes(Buffer.from("to nie obraz"), { tmpDirectory }))).toBe(
      "processing_failed",
    );
    expect(await codeOf(ogFromMainBytes(new Uint8Array(0), { tmpDirectory }))).toBe(
      "processing_failed",
    );
    expect(await codeOf(ogFromMainBytes(Buffer.alloc(400 * 1024), { tmpDirectory }))).toBe(
      "processing_failed",
    );
    expect(await readdir(tmpDirectory)).toEqual([]);
  }, 60_000);

  it("odpowiedź trybu og: tylko { ok, og } w budżecie, reszta to processing_failed", () => {
    expect(parseOgReply({ ok: true, og: new Uint8Array([1]) })).toEqual({
      ok: true,
      result: new Uint8Array([1]),
    });
    expect(parseOgReply({ ok: false, code: "too_complex" })).toEqual({
      ok: false,
      code: "too_complex",
    });

    for (const reply of [
      null,
      [],
      { ok: true },
      { ok: true, og: new Uint8Array(0) },
      { ok: true, og: new Uint8Array(201 * 1024) },
      { ok: true, og: new Uint8Array([1]), extra: 1 },
      { ok: false, code: "x", extra: 1 },
    ]) {
      expect(parseOgReply(reply)).toMatchObject({ ok: false, code: "processing_failed" });
    }
  });

  it("zwraca kody błędów z procesu potomnego (za małe zdjęcie, próg wyłączony)", async () => {
    const small = await noiseImage(500, 400, 8).jpeg().toBuffer();
    expect(await codeOf(processImageBytes(small, { tmpDirectory }))).toBe("too_small");
    const accepted = await processImageBytes(small, { tmpDirectory, minShortSide: 0 });
    expect(accepted.width).toBe(500);
    expect(await readdir(tmpDirectory)).toEqual([]);
  }, 60_000);

  it("odrzuca typ i APNG bez uruchamiania procesu potomnego", async () => {
    let spawned = false;
    const onSpawn = () => {
      spawned = true;
    };
    const apng = buildGrayPng(700, 700, [pngChunk("acTL", Buffer.alloc(8))]);
    expect(await codeOf(processImageBytes(apng, { tmpDirectory, onSpawn }))).toBe("animated_png");
    expect(await codeOf(processImageBytes(Buffer.from("GIF89a"), { tmpDirectory, onSpawn }))).toBe(
      "unsupported_type",
    );
    expect(spawned).toBe(false);
  });

  it("PNG-bomba kończy się odrzuceniem w procesie potomnym", async () => {
    const bomb = buildGrayPng(8000, 8000);
    expect(await codeOf(processImageBytes(bomb, { tmpDirectory, minShortSide: 0 }))).toBe(
      "processing_failed",
    );
    expect(await readdir(tmpDirectory)).toEqual([]);
  }, 60_000);

  it("po przekroczeniu limitu czasu zabija proces (SIGKILL) i zwraca processing_failed", async () => {
    let pid: number | undefined;
    const outcome = await codeOf(
      runImageWorker({
        inputPath: "nieistotne",
        workerPath: worker("hang.mjs"),
        timeoutMs: 400,
        onSpawn: (spawnedPid) => {
          pid = spawnedPid;
        },
      }),
    );
    expect(outcome).toBe("processing_failed");
    expect(pid).toBeTypeOf("number");
    expect(await waitUntilDead(pid as number)).toBe(true);
  });

  it("proces, który padł bez odpowiedzi, daje processing_failed", async () => {
    expect(await codeOf(runImageWorker({ inputPath: "x", workerPath: worker("crash.mjs") }))).toBe(
      "processing_failed",
    );
  });

  it("nieistniejący plik procesu daje processing_failed", async () => {
    expect(
      await codeOf(runImageWorker({ inputPath: "x", workerPath: worker("brak-takiego.mjs") })),
    ).toBe("processing_failed");
  });

  it("nieznany kod błędu z procesu zamienia na processing_failed", async () => {
    expect(
      await codeOf(runImageWorker({ inputPath: "x", workerPath: worker("bad-code.mjs") })),
    ).toBe("processing_failed");
  });

  it("przyjmuje poprawną odpowiedź procesu potomnego (kontrola kształtu przepuszcza dobre dane)", async () => {
    const result = await runImageWorker({
      inputPath: "x",
      workerPath: worker("fake-result.mjs"),
      env: { FAKE_MODE: "good" },
    });
    expect([result.width, result.height, result.quality]).toEqual([100, 80, 80]);
    expect(result.main.length).toBe(10);
  });

  it.each([
    "extra-field",
    "extra-top",
    "oversize",
    "og-oversize",
    "text-main",
    "bad-width",
    "huge-width",
    "bad-quality",
    "no-result",
    "array",
  ])("odrzuca odpowiedź procesu potomnego łamiącą kontrakt (%s)", async (mode) => {
    expect(
      await codeOf(
        runImageWorker({
          inputPath: "x",
          workerPath: worker("fake-result.mjs"),
          env: { FAKE_MODE: mode },
        }),
      ),
    ).toBe("processing_failed");
  });

  it("odrzuca za duże wejście po stronie rodzica, bez zapisu na dysk i bez procesu", async () => {
    const huge = new Uint8Array(MAX_INPUT_BYTES + 1);
    huge.set([0xff, 0xd8, 0xff]);
    let spawned = false;
    expect(
      await codeOf(
        processImageBytes(huge, {
          tmpDirectory,
          onSpawn: () => {
            spawned = true;
          },
        }),
      ),
    ).toBe("processing_failed");
    expect(spawned).toBe(false);
    expect(await readdir(tmpDirectory)).toEqual([]);
  });

  it("proces potomny nie dziedziczy środowiska rodzica (brak sekretów)", async () => {
    const names = ["FAKE_ENV_VALUE", "DATABASE_URL", "SESSION_PASSPHRASE", "NODE_OPTIONS"];
    const saved = names.map((name) => process.env[name]);
    process.env.FAKE_ENV_VALUE = "fikcyjna-wartosc";
    process.env.DATABASE_URL = "postgres://fikcyjny";
    process.env.SESSION_PASSPHRASE = "fikcyjne";
    process.env.NODE_OPTIONS = "--max-old-space-size=512";
    try {
      const dumpPath = join(tmpDirectory, "env.json");
      await runImageWorker({ inputPath: dumpPath, workerPath: worker("env-dump.mjs") });
      const result = JSON.parse(await readFile(dumpPath, "utf8")) as {
        envKeys: string[];
        execArgv: string[];
      };
      for (const name of names) expect(result.envKeys).not.toContain(name);
      // Dozwolone jest tylko to, co dopisuje sam system Windows (ścieżki profilu, nie sekrety).
      const systemOwned = new Set(
        process.platform === "win32"
          ? [
              "SystemRoot",
              "HOMEDRIVE",
              "HOMEPATH",
              "LOGONSERVER",
              "PATH",
              "SYSTEMDRIVE",
              "TEMP",
              "USERDOMAIN",
              "USERNAME",
              "USERPROFILE",
              "WINDIR",
            ]
          : [],
      );
      expect(result.envKeys.filter((key) => !systemOwned.has(key))).toEqual([]);
      expect(result.execArgv).toEqual([]);
    } finally {
      names.forEach((name, index) => {
        const value = saved[index];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      });
    }
  });

  it("przekazuje tylko jawnie podane zmienne środowiska", async () => {
    const dumpPath = join(tmpDirectory, "env.json");
    await runImageWorker({
      inputPath: dumpPath,
      workerPath: worker("env-dump.mjs"),
      env: { FAKE_ENV_VALUE: "jawnie" },
    });
    const result = JSON.parse(await readFile(dumpPath, "utf8")) as { envKeys: string[] };
    expect(result.envKeys).toContain("FAKE_ENV_VALUE");
  });
});
