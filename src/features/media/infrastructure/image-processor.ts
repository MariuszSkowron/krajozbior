import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { detectImageType } from "../domain/image-type";
import { PROCESS_TIMEOUT_MS } from "../domain/limits";
import {
  isProcessingErrorCode,
  MediaProcessingError,
  type ProcessingErrorCode,
} from "../domain/processing-error";

export type ProcessImageOptions = {
  /** Najmniejszy krótszy bok; 0 wyłącza próg (np. `commons_import`, A-S1). */
  minShortSide?: number;
  /** Dodaje JPEG 1200 px do `og:image`. */
  ogJpeg?: boolean;
};

export type ProcessedImage = {
  main: Uint8Array;
  thumb: Uint8Array;
  og?: Uint8Array;
  width: number;
  height: number;
  quality: number;
};

export type RunWorkerOptions = ProcessImageOptions & {
  inputPath: string;
  timeoutMs?: number;
  /** Plik procesu potomnego; domyślnie liczony od `process.cwd()` (kod trasy jest pakowany). */
  workerPath?: string;
  /** Jawne środowisko procesu potomnego; domyślnie puste (bez sekretów). */
  env?: Record<string, string>;
  /** Wywoływane po uruchomieniu procesu (testy sprawdzają, że po limicie czasu nie żyje). */
  onSpawn?: (pid: number | undefined) => void;
};

/** Ścieżka pliku procesu potomnego od `process.cwd()` (w obrazie: `/app`), nie od `import.meta.url`. */
export function defaultWorkerPath(): string {
  return join(process.cwd(), "src", "features", "media", "worker", "process-image.mjs");
}

/** Na Windows proces Node potrzebuje `SystemRoot` (to nie sekret); gdzie indziej środowisko jest puste. */
function baseEnvironment(): Record<string, string> {
  const systemRoot = process.platform === "win32" ? process.env.SystemRoot : undefined;
  return systemRoot ? { SystemRoot: systemRoot } : {};
}

/**
 * Uruchamia obróbkę pliku w procesie potomnym: bez połączenia z bazą i bez zmiennych środowiska
 * poza jawnie podanymi, ze stderr odciętym od logów, z limitem czasu i `SIGKILL` (D-E4-4, 5.3 krok 5).
 */
export function runImageWorker(options: RunWorkerOptions): Promise<ProcessedImage> {
  const timeoutMs = options.timeoutMs ?? PROCESS_TIMEOUT_MS;
  return new Promise<ProcessedImage>((resolve, reject) => {
    const child = fork(options.workerPath ?? defaultWorkerPath(), [], {
      env: { ...baseEnvironment(), ...options.env } as NodeJS.ProcessEnv,
      execArgv: [],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    options.onSpawn?.(child.pid);
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const fail = (code: ProcessingErrorCode) =>
      finish(() => {
        child.kill("SIGKILL");
        reject(new MediaProcessingError(code));
      });
    const timer = setTimeout(() => fail("processing_failed"), timeoutMs);

    child.once("message", (reply) => {
      const message = reply as { ok?: boolean; code?: unknown; result?: ProcessedImage };
      if (message.ok && message.result) {
        const result = message.result;
        finish(() => {
          child.kill("SIGKILL");
          resolve(result);
        });
      } else {
        fail(isProcessingErrorCode(message.code) ? message.code : "processing_failed");
      }
    });
    child.once("error", () => fail("processing_failed"));
    child.once("exit", () => fail("processing_failed"));
    child.send({
      inputPath: options.inputPath,
      options: { minShortSide: options.minShortSide, ogJpeg: options.ogJpeg },
    });
  });
}

/**
 * Obróbka zawartości pliku: typ po zawartości (415 bez uruchamiania procesu), zapis do
 * `${tmpDirectory}/{uuid}.in`, proces potomny, usunięcie pliku wejściowego po wyniku albo błędzie.
 */
export async function processImageBytes(
  bytes: Uint8Array,
  options: ProcessImageOptions &
    Pick<RunWorkerOptions, "timeoutMs" | "workerPath" | "env" | "onSpawn"> & {
      tmpDirectory: string;
    },
): Promise<ProcessedImage> {
  const detected = detectImageType(bytes);
  if (!detected.ok) throw new MediaProcessingError(detected.code);
  await mkdir(options.tmpDirectory, { recursive: true, mode: 0o700 });
  const inputPath = join(options.tmpDirectory, `${randomUUID()}.in`);
  await writeFile(inputPath, bytes, { mode: 0o600, flag: "wx" });
  try {
    return await runImageWorker({ ...options, inputPath });
  } finally {
    await unlink(inputPath).catch(() => undefined);
  }
}
