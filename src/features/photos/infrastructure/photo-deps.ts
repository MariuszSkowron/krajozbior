import "server-only";

import { getIdentityProvider } from "@/features/identity/infrastructure";
import { withGuestContext, withUserContext } from "@/lib/db/user-context";

import type { PhotoDeps } from "../application/serve-photo";
import { createDiskPhotoReader } from "./disk-photo-reader";
import { postgresPhotoReadRepository } from "./postgres-photo-read-repository";

// Prawdziwe zależności trasy `/media`. Sesja pochodzi z nagłówków żądania. Brak `MEDIA_ROOT` (np.
// serwer bez wolumenu zdjęć) nie wyłącza strony: każde zdjęcie jest wtedy zwykłym 404.
export function getPhotoDeps(requestHeaders: Headers): PhotoDeps {
  const mediaRoot = process.env.MEDIA_ROOT?.trim();

  return {
    withGuestContext,
    withUserContext,
    getActor: () => getIdentityProvider().getActor(requestHeaders),
    repository: postgresPhotoReadRepository,
    files: mediaRoot ? createDiskPhotoReader(mediaRoot) : null,
  };
}
