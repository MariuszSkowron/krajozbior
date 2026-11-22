import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import {
  etagMatches,
  photoEtag,
  type MediaRequest,
  type MediaSize,
  type PhotoVisibility,
} from "../domain/media-request";

// Odczyt pliku zdjęcia dla trasy `/media` (spec E4, 5.4 i 5.11.7). O dostępie rozstrzyga baza
// (RLS): najpierw odczyt w kontekście gościa, a dopiero przy braku wiersza i obecnej sesji odczyt w
// kontekście użytkownika. Trafienie gościa oznacza zdjęcie publiczne (`public`, bez sprawdzania
// sesji), trafienie użytkownika — zdjęcie widoczne tylko dla zespołu organizacji (`private`).

export type PhotoFile = Readonly<{ body: ReadableStream<Uint8Array>; length: number }>;

export interface PhotoReadRepository {
  /** Klucz pliku zdjęcia gotowego do pokazania, które widzi bieżący kontekst; inaczej `null`. */
  findReadyPhotoKey(tx: TransactionContext, photoId: string): Promise<string | null>;
}

export interface PhotoFileReader {
  /** Otwiera plik do strumieniowania; brak pliku albo błąd odczytu to `null`, nigdy wyjątek. */
  open(storageKey: string, size: MediaSize): Promise<PhotoFile | null>;
}

export type PhotoDeps = Readonly<{
  withGuestContext: <T>(work: (tx: TransactionContext) => Promise<T>) => Promise<T>;
  withUserContext: <T>(
    actor: Pick<Actor, "id">,
    work: (tx: TransactionContext) => Promise<T>,
  ) => Promise<T>;
  /** Sesja żądania; `null` dla gościa. */
  getActor: () => Promise<Actor | null>;
  repository: PhotoReadRepository;
  /** `null`, gdy serwer nie ma `MEDIA_ROOT`: każde zdjęcie to wtedy zwykłe 404. */
  files: PhotoFileReader | null;
}>;

export type ServePhotoResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{
      status: "not_modified";
      visibility: PhotoVisibility;
      etag: string;
      size: MediaSize;
    }>
  | Readonly<{
      status: "ok";
      visibility: PhotoVisibility;
      etag: string;
      size: MediaSize;
      file: PhotoFile;
    }>;

const NOT_FOUND: ServePhotoResult = { status: "not_found" };

export async function servePhoto(
  request: MediaRequest,
  ifNoneMatch: string | null,
  deps: PhotoDeps,
): Promise<ServePhotoResult> {
  const found = await findPhotoKey(request.photoId, deps);

  if (found === null) {
    return NOT_FOUND;
  }

  const etag = photoEtag(found.storageKey, request.size);

  // 304 dopiero po decyzji o dostępie: odpowiedź bez sprawdzenia widoczności zdradzałaby, że
  // zdjęcie istnieje.
  if (etagMatches(ifNoneMatch, etag)) {
    return { status: "not_modified", visibility: found.visibility, etag, size: request.size };
  }

  const file = deps.files === null ? null : await deps.files.open(found.storageKey, request.size);

  if (file === null) {
    return NOT_FOUND;
  }

  return { status: "ok", visibility: found.visibility, etag, size: request.size, file };
}

async function findPhotoKey(
  photoId: string,
  deps: PhotoDeps,
): Promise<{ storageKey: string; visibility: PhotoVisibility } | null> {
  const publicKey = await deps.withGuestContext((tx) =>
    deps.repository.findReadyPhotoKey(tx, photoId),
  );

  if (publicKey !== null) {
    return { storageKey: publicKey, visibility: "public" };
  }

  const actor = await deps.getActor();

  if (actor === null) {
    return null;
  }

  const privateKey = await deps.withUserContext(actor, (tx) =>
    deps.repository.findReadyPhotoKey(tx, photoId),
  );

  return privateKey === null ? null : { storageKey: privateKey, visibility: "private" };
}
