import { createHash } from "node:crypto";

// Reguły wejścia trasy `/media/{kind}/{photoId}/{size}` (spec E4, 5.4 z uzupełnieniem S5) i
// nagłówki odpowiedzi (5.4, 5.11.7). Czysta domena: bez Next.js i bazy.

/** Rozmiary serwowane od E4-2b; `og` dojdzie z E4-3. */
export const MEDIA_SIZES = ["main", "w400"] as const;
export type MediaSize = (typeof MEDIA_SIZES)[number];

export type MediaRequest = Readonly<{ photoId: string; size: MediaSize }>;

// Tylko postać kanoniczna: małe litery, 36 znaków. Wielkie litery, `..`, `%2f` i wszystko
// dłuższe nie przechodzą, więc nie dochodzi do zapytania do bazy.
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCanonicalUuid(value: string): boolean {
  return CANONICAL_UUID.test(value);
}

function isMediaSize(value: string): value is MediaSize {
  return (MEDIA_SIZES as readonly string[]).includes(value);
}

/**
 * Sprawdza trzy części adresu. `kind` to tylko `p` (zdjęcie oficjalne miejsca); `e` (zdjęcie
 * odkrywcy) daje to samo `null` do czasu E4-4. Zwraca `null` dla każdej innej wartości.
 */
export function parseMediaRequest(
  kind: string,
  photoId: string,
  size: string,
): MediaRequest | null {
  if (kind !== "p" || !isCanonicalUuid(photoId) || !isMediaSize(size)) {
    return null;
  }

  return { photoId, size };
}

/** Kto może zobaczyć zdjęcie: każdy (odczyt gościa trafił) albo tylko kurator (odczyt użytkownika). */
export type PhotoVisibility = "public" | "private";

export const PUBLIC_CACHE_CONTROL = "public, max-age=86400";
export const PRIVATE_CACHE_CONTROL = "private, no-store";

/** `ETag`: pierwsze 16 znaków SHA-256 z klucza pliku i rozmiaru, nigdy sam klucz (5.4, S5). */
export function photoEtag(storageKey: string, size: MediaSize): string {
  const digest = createHash("sha256").update(`${storageKey}:${size}`).digest("hex");

  return `"${digest.slice(0, 16)}"`;
}

/** `If-None-Match`: lista wartości, `*` albo wartość słaba (`W/"…"`); porównanie słabe (RFC 9110). */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) {
    return false;
  }

  return ifNoneMatch
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || candidate.replace(/^W\//, "") === etag);
}

/** Nagłówki odpowiedzi ze zdjęciem (albo `304`); `Cache-Control` zależy od widoczności. */
export function photoHeaders(visibility: PhotoVisibility, etag: string): Record<string, string> {
  return {
    "Content-Type": "image/webp",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    ETag: etag,
    "Cache-Control": visibility === "public" ? PUBLIC_CACHE_CONTROL : PRIVATE_CACHE_CONTROL,
    // Zdjęcie publiczne może pokazać podgląd linku w innym serwisie; widoczne tylko dla zespołu — nie.
    "Cross-Origin-Resource-Policy": visibility === "public" ? "cross-origin" : "same-origin",
  };
}

/** Nagłówki każdej odpowiedzi „nie ma”: ten sam adres daje różne odpowiedzi różnym osobom. */
export function notFoundHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": PRIVATE_CACHE_CONTROL,
  };
}
