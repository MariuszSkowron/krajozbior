import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MediaProcessingError } from "@/features/media/domain/processing-error";
import {
  defaultWorkerPath,
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

  it("proces potomny nie dziedziczy środowiska rodzica (brak sekretów)", async () => {
    const names = ["FAKE_ENV_VALUE", "DATABASE_URL", "SESSION_PASSPHRASE", "NODE_OPTIONS"];
    const saved = names.map((name) => process.env[name]);
    process.env.FAKE_ENV_VALUE = "fikcyjna-wartosc";
    process.env.DATABASE_URL = "postgres://fikcyjny";
    process.env.SESSION_PASSPHRASE = "fikcyjne";
    process.env.NODE_OPTIONS = "--max-old-space-size=512";
    try {
      const result = (await runImageWorker({
        inputPath: "x",
        workerPath: worker("env-dump.mjs"),
      })) as unknown as { envKeys: string[]; execArgv: string[] };
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
    const result = (await runImageWorker({
      inputPath: "x",
      workerPath: worker("env-dump.mjs"),
      env: { FAKE_ENV_VALUE: "jawnie" },
    })) as unknown as { envKeys: string[] };
    expect(result.envKeys).toContain("FAKE_ENV_VALUE");
  });
});
