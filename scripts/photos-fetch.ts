// Pobiera zdjęcia z Wikimedia Commons dla wierszy `place_photos` w stanie `pending_fetch`
// (E4-2a, spec 5.5 i 5.11.5): tylko `https://upload.wikimedia.org`, miniatura ze standardowej
// listy szerokości (najwyżej 1920 px), obróbka biblioteką zdjęć (budżet 300 KB), na dysku zostaje
// wyłącznie przetworzona kopia. Działa jako `krajozbior_ops` (DATABASE_OPS_URL) i wymaga
// MEDIA_ROOT (wolumen zdjęć). Wpis `photos_fetch` w dzienniku operacji z samymi liczbami.
// Kody wyjścia: 0 gotowe, 1 awaria, 2 błąd argumentów, 3 poprzednie pobieranie jeszcze trwa.
//
// Uruchomienie (na serwerze przez kontener `ops`):
//   npm run photos:fetch -- --operator <etykieta> --reason <powód> [--limit <n>]
//     [--org-slug <slug>] [--retry-failed] [--refetch-missing] [--backfill-og]
import { isAbsolute } from "node:path";

import { Client } from "pg";

import { writeAuditEntry } from "../src/lib/db/operations-audit";
import { DiskMediaStorage } from "../src/features/media/infrastructure/disk-media-storage";
import {
  ogFromMainBytes,
  processImageBytes,
} from "../src/features/media/infrastructure/image-processor";
import { checkFreeSpace, parseMinFreePercent } from "../src/features/media/domain/free-space";
import { runPhotosFetch } from "../src/features/photos/application/photos-fetch-command";
import { createCommonsClient } from "../src/features/photos/infrastructure/commons-http";
import {
  createPostgresPhotoFetchRepository,
  releaseMediaLock,
  tryMediaLock,
} from "../src/features/photos/infrastructure/postgres-photo-fetch-repository";
import { getOpsEnv } from "../src/lib/config/env";

function userAgent(): string {
  // Ogólna nazwa klienta i strona „Źródła danych” jako kontakt, bez danych właściciela.
  const base = process.env.BETTER_AUTH_URL;

  try {
    const url = new URL("/zrodla", base);

    return `Krajozbior-photo-import/1.0 (${url.toString()})`;
  } catch {
    return "Krajozbior-photo-import/1.0";
  }
}

async function main() {
  const output = await runPhotosFetch(process.argv.slice(2), {
    openSession: async () => {
      const mediaRoot = process.env.MEDIA_ROOT;

      if (mediaRoot === undefined || mediaRoot === "" || !isAbsolute(mediaRoot)) {
        throw new Error("MEDIA_ROOT");
      }

      const client = new Client({ connectionString: getOpsEnv().DATABASE_OPS_URL });

      await client.connect();

      const storage = new DiskMediaStorage(mediaRoot);
      const minFree = parseMinFreePercent(process.env.MEDIA_MIN_FREE_PERCENT);
      const commons = createCommonsClient({ userAgent: userAgent() });

      return {
        session: {
          tryLock: () => tryMediaLock(client),
          writeAudit: async (entry) => {
            await writeAuditEntry(client, entry);
          },
          close: async () => {
            await releaseMediaLock(client).catch(() => undefined);
            await client.end();
          },
        },
        fetch: {
          repository: createPostgresPhotoFetchRepository(client),
          download: (address) => commons.download(address),
          lookupVersion: (commonsFile) => commons.lookupVersion(commonsFile),
          process: (bytes) =>
            processImageBytes(bytes, {
              tmpDirectory: storage.tmpDirectory,
              minShortSide: 0,
              ogJpeg: true,
            }),
          makeOg: (main) => ogFromMainBytes(main, { tmpDirectory: storage.tmpDirectory }),
          storage,
          checkSpace: () => checkFreeSpace(() => storage.diskSpace(), minFree),
          sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
        },
      };
    },
  });

  for (const line of output.stdout) console.log(line);
  for (const line of output.stderr) console.error(line);

  process.exitCode = output.exitCode;
}

main().catch(() => {
  console.error("photos:fetch przerwany nieoczekiwanym błędem.");
  process.exitCode = 1;
});
