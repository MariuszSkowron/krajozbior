import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { detectImageType } from "../domain/image-type";
import {
  MAIN_LONG_SIDE,
  MAX_INPUT_BYTES,
  MAX_MAIN_BYTES,
  MAX_OG_BYTES,
  MIN_QUALITY,
  PROCESS_TIMEOUT_MS,
  START_QUALITY,
} from "../domain/limits";
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

const OK_KEYS = ["ok", "result"];
const FAIL_KEYS = ["ok", "code"];
const RESULT_KEYS = ["main", "thumb", "og", "width", "height", "quality"];

function hasOnlyKeys(value: object, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isBytesWithin(value: unknown, maxBytes: number): value is Uint8Array {
  return value instanceof Uint8Array && value.length > 0 && value.length <= maxBytes;
}

function isDimension(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAIN_LONG_SIDE;
}

/**
 * Odpowiedź procesu potomnego jest daną niezaufaną (proces mógł zostać przejęty): przyjmujemy
 * tylko dokładnie oczekiwany kształt, typy i rozmiary; wszystko inne to `processing_failed`.
 */
export function parseWorkerReply(
  reply: unknown,
): { ok: true; result: ProcessedImage } | { ok: false; code: ProcessingErrorCode } {
  const invalid = { ok: false, code: "processing_failed" } as const;
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return invalid;
  const message = reply as Record<string, unknown>;
  if (message.ok !== true) {
    if (!hasOnlyKeys(message, FAIL_KEYS)) return invalid;
    return {
      ok: false,
      code: isProcessingErrorCode(message.code) ? message.code : "processing_failed",
    };
  }
  const result = message.result;
  if (!hasOnlyKeys(message, OK_KEYS)) return invalid;
  if (typeof result !== "object" || result === null || Array.isArray(result)) return invalid;
  const candidate = result as Record<string, unknown>;
  if (!hasOnlyKeys(candidate, RESULT_KEYS)) return invalid;
  if (!isBytesWithin(candidate.main, MAX_MAIN_BYTES)) return invalid;
  if (!isBytesWithin(candidate.thumb, MAX_MAIN_BYTES)) return invalid;
  if (candidate.og !== undefined && !isBytesWithin(candidate.og, MAX_OG_BYTES)) return invalid;
  if (!isDimension(candidate.width) || !isDimension(candidate.height)) return invalid;
  if (!Number.isInteger(candidate.quality) || (candidate.quality as number) < MIN_QUALITY) {
    return invalid;
  }
  if ((candidate.quality as number) > START_QUALITY) return invalid;
  return {
    ok: true,
    result: {
      main: candidate.main,
      thumb: candidate.thumb,
      ...(candidate.og ? { og: candidate.og } : {}),
      width: candidate.width,
      height: candidate.height,
      quality: candidate.quality as number,
    },
  };
}

/**
 * Uruchamia obróbkę pliku w procesie potomnym: bez połączenia z bazą i bez zmiennych środowiska
 * poza jawnie podanymi, ze stderr odciętym od logów, z limitem czasu i `SIGKILL` (D-E4-4, 5.3 krok 5).
 */
export function runImageWorker(options: RunWorkerOptions): Promise<ProcessedImage> {
  return runWorker(
    options,
    {
      inputPath: options.inputPath,
      options: { minShortSide: options.minShortSide, ogJpeg: options.ogJpeg },
    },
    parseWorkerReply,
  );
}

type WorkerParse<T> = (
  reply: unknown,
) => { ok: true; result: T } | { ok: false; code: ProcessingErrorCode };

function runWorker<T>(
  options: Pick<RunWorkerOptions, "timeoutMs" | "workerPath" | "env" | "onSpawn">,
  message: object,
  parse: WorkerParse<T>,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? PROCESS_TIMEOUT_MS;
  return new Promise<T>((resolve, reject) => {
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
      const parsed = parse(reply);
      if (parsed.ok) {
        finish(() => {
          child.kill("SIGKILL");
          resolve(parsed.result);
        });
      } else {
        fail(parsed.code);
      }
    });
    child.once("error", () => fail("processing_failed"));
    child.once("exit", () => fail("processing_failed"));
    child.send(message);
  });
}

/** Odpowiedź trybu `og`: dokładnie `{ ok: true, og }` z JPEG w budżecie; inaczej `processing_failed`. */
export function parseOgReply(
  reply: unknown,
): { ok: true; result: Uint8Array } | { ok: false; code: ProcessingErrorCode } {
  const invalid = { ok: false, code: "processing_failed" } as const;
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return invalid;
  const message = reply as Record<string, unknown>;
  if (message.ok !== true) {
    if (!hasOnlyKeys(message, FAIL_KEYS)) return invalid;
    return {
      ok: false,
      code: isProcessingErrorCode(message.code) ? message.code : "processing_failed",
    };
  }
  if (!hasOnlyKeys(message, ["ok", "og"])) return invalid;
  if (!isBytesWithin(message.og, MAX_OG_BYTES)) return invalid;
  return { ok: true, result: message.og };
}

/**
 * JPEG do `og:image` z zawartości istniejącego `main.webp` (uzupełnienie zdjęć pobranych przed E4-3):
 * ten sam proces potomny i te same ograniczenia co zwykła obróbka (bez sekretów, limit czasu).
 */
export async function ogFromMainBytes(
  bytes: Uint8Array,
  options: Pick<RunWorkerOptions, "timeoutMs" | "workerPath" | "env" | "onSpawn"> & {
    tmpDirectory: string;
  },
): Promise<Uint8Array> {
  if (bytes.length === 0 || bytes.length > MAX_MAIN_BYTES) {
    throw new MediaProcessingError("processing_failed");
  }
  await mkdir(options.tmpDirectory, { recursive: true, mode: 0o700 });
  const inputPath = join(options.tmpDirectory, `${randomUUID()}.in`);
  await writeFile(inputPath, bytes, { mode: 0o600, flag: "wx" });
  try {
    return await runWorker(options, { inputPath, options: { mode: "og" } }, parseOgReply);
  } finally {
    await unlink(inputPath).catch(() => undefined);
  }
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
  // Obrona niezależna od trasy: za duże wejście nie trafia na dysk ani do procesu potomnego.
  if (bytes.length > MAX_INPUT_BYTES) throw new MediaProcessingError("processing_failed");
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
