import { open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";

import { MAX_MAIN_BYTES } from "@/features/media/domain/limits";
import { mediaFilePath } from "@/features/media/domain/media-key";
import { encodeOgJpeg } from "@/features/media/worker/pipeline.mjs";
import { logFailure } from "@/lib/log-failure";

import type { PhotoFile, PhotoFileReader } from "../application/serve-photo";
import { isCanonicalUuid } from "../domain/media-request";

// Odczyt pliku zdjęcia oficjalnego z `MEDIA_ROOT` do strumieniowania (5.4). Ścieżka powstaje
// wyłącznie z klucza z bazy, sprawdzonego tu drugi raz jako kanoniczny UUID; nic z adresu żądania
// nie trafia do systemu plików. Każdy błąd otwarcia (brak pliku, brak katalogu, uprawnienia) to
// `null`, czyli 404: awaria dysku nie może dać 500 ani zdradzić ścieżki.
//
// Rozmiar `og` (JPEG 1200 px, E4-3) powstaje przy pierwszym żądaniu z pliku `main` (WebP, który
// sami wytworzyliśmy przy pobraniu albo wgraniu), więc działa też dla zdjęć pobranych przed E4-3.
// Wynik jest zapisywany obok (zapis przez plik tymczasowy i `rename`); gdy zapis się nie uda
// (wolumen tylko do odczytu), odpowiedź i tak wychodzi, a plik powstanie przy następnym żądaniu.
export function createDiskPhotoReader(mediaRoot: string): PhotoFileReader {
  const root = resolve(mediaRoot);

  async function openPath(path: string): Promise<PhotoFile | null> {
    try {
      const handle = await open(path, "r");
      let streaming = false;

      try {
        const info = await handle.stat();

        if (!info.isFile()) {
          return null;
        }

        // `createReadStream` zamyka uchwyt po końcu albo błędzie strumienia.
        const body = Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>;

        streaming = true;

        return { body, length: info.size };
      } finally {
        // Każda ścieżka poza oddaniem strumienia (nie plik, wyjątek ze `stat`) zamyka uchwyt.
        if (!streaming) {
          await handle.close().catch(() => undefined);
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code !== "ENOENT" && code !== "ENOTDIR") {
        logFailure("Photo file read", error);
      }

      return null;
    }
  }

  // JPEG do `og:image` z pliku `main`; `null`, gdy `main` nie istnieje albo nie da się go przerobić.
  async function generateOg(mainPath: string, ogPath: string): Promise<PhotoFile | null> {
    let main: Buffer;

    try {
      const info = await stat(mainPath);

      // Plik główny mieści się w budżecie 300 KB; większy to nie nasz plik, więc go nie dekodujemy.
      if (!info.isFile() || info.size > MAX_MAIN_BYTES) {
        return null;
      }

      main = await readFile(mainPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code !== "ENOENT" && code !== "ENOTDIR") {
        logFailure("Photo og source read", error);
      }

      return null;
    }

    let jpeg: Buffer;

    try {
      jpeg = await encodeOgJpeg(main);
    } catch (error) {
      logFailure("Photo og encode", error);

      return null;
    }

    const temporary = `${ogPath}.${process.pid}.${Date.now()}.tmp`;

    try {
      await writeFile(temporary, jpeg, { flag: "wx" });
      await rename(temporary, ogPath);
    } catch {
      // Wolumen tylko do odczytu albo brak miejsca: odpowiedź wychodzi bez zapisu.
    }

    return { body: new Response(new Uint8Array(jpeg)).body!, length: jpeg.length };
  }

  return {
    async open(storageKey, size): Promise<PhotoFile | null> {
      if (!isCanonicalUuid(storageKey)) {
        return null;
      }

      const path = resolve(root, mediaFilePath("place", storageKey, size));

      if (!path.startsWith(root + sep)) {
        return null;
      }

      const file = await openPath(path);

      if (file !== null || size !== "og") {
        return file;
      }

      const mainPath = resolve(root, mediaFilePath("place", storageKey, "main"));

      return generateOg(mainPath, path);
    },
  };
}
