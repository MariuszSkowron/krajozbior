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
//
// Trasa tylko serwuje gotowe pliki. Rozmiar `og` (JPEG 1200 px, E4-3) powstaje poza procesem
// serwera WWW: `photos:fetch` robi go przy pobraniu (proces potomny biblioteki obróbki), a dla
// zdjęć pobranych wcześniej uzupełnia go `photos:fetch --backfill-og`. Brak pliku to 404.
// Plik o długości 0 (przerwany zapis) też nie jest serwowany.
export function createDiskPhotoReader(mediaRoot: string): PhotoFileReader {
  const root = resolve(mediaRoot);

  async function openPath(path: string): Promise<PhotoFile | null> {
    try {
      const handle = await open(path, "r");
      let streaming = false;

      try {
        const info = await handle.stat();

        if (!info.isFile() || info.size === 0) {
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

  return {
    async open(storageKey, size): Promise<PhotoFile | null> {
      if (!isCanonicalUuid(storageKey)) {
        return null;
      }

      const path = resolve(root, mediaFilePath("place", storageKey, size));

      if (!path.startsWith(root + sep)) {
        return null;
      }

      return openPath(path);
    },
  };
}
