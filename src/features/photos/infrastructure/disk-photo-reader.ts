import { open } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";

import { mediaFilePath } from "@/features/media/domain/media-key";
import { logFailure } from "@/lib/log-failure";

import type { PhotoFile, PhotoFileReader } from "../application/serve-photo";
import { isCanonicalUuid } from "../domain/media-request";

// Odczyt pliku zdjęcia oficjalnego z `MEDIA_ROOT` do strumieniowania (5.4). Ścieżka powstaje
// wyłącznie z klucza z bazy, sprawdzonego tu drugi raz jako kanoniczny UUID; nic z adresu żądania
// nie trafia do systemu plików. Każdy błąd otwarcia (brak pliku, brak katalogu, uprawnienia) to
// `null`, czyli 404: awaria dysku nie może dać 500 ani zdradzić ścieżki.
export function createDiskPhotoReader(mediaRoot: string): PhotoFileReader {
  const root = resolve(mediaRoot);

  return {
    async open(storageKey, size): Promise<PhotoFile | null> {
      if (!isCanonicalUuid(storageKey)) {
        return null;
      }

      const path = resolve(root, mediaFilePath("place", storageKey, size));

      if (!path.startsWith(root + sep)) {
        return null;
      }

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
    },
  };
}
