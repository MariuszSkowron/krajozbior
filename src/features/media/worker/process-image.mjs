// @ts-check
// Punkt wejścia procesu potomnego (D-E4-4): dostaje przez IPC ścieżkę pliku i opcje, odpowiada
// wynikiem albo kodem błędu. Nie ma połączenia z bazą ani sekretów w środowisku; limit czasu
// i `SIGKILL` egzekwuje proces nadrzędny.

import { readFile } from "node:fs/promises";

import sharp from "sharp";

import { MAX_INPUT_BYTES } from "./budget.mjs";
import { ogFromMain, PipelineError, processImage } from "./pipeline.mjs";

sharp.cache(false);
sharp.concurrency(1);

/** @param {unknown} message */
async function handle(message) {
  try {
    const { inputPath, options } = /** @type {{ inputPath: string, options?: object }} */ (message);
    const input = await readFile(inputPath);
    if (input.length > MAX_INPUT_BYTES) throw new PipelineError("processing_failed");
    // Tryb `og`: tylko JPEG do podglądu linku z istniejącego `main.webp` (uzupełnienie zdjęć).
    if (/** @type {{ mode?: string } | undefined} */ (options)?.mode === "og") {
      return { ok: true, og: await ogFromMain(input) };
    }
    return { ok: true, result: await processImage(input, options) };
  } catch (error) {
    const code = error instanceof PipelineError ? error.code : "processing_failed";
    return { ok: false, code };
  }
}

process.once("message", async (message) => {
  const reply = await handle(message);
  process.send?.(reply, undefined, undefined, () => process.exit(0));
});
