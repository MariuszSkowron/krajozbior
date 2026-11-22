import { createHash } from "node:crypto";

import type { ImportImage } from "./import-file";
import type { ImportKeyState } from "./import-diff";

// Zdjęcia z Commons przy wgrywaniu kolekcji (E4-2a): czyste decyzje, bez bazy. Jak przy miejscach:
// ręczna zmiana kuratora zostaje, a zdjęcie usunięte przez kuratora nie wraca.

/** Kolumny wiersza `place_photos`, które ustawia plik kolekcji (bez pliku i stanu pobrania). */
export type PhotoContent = Readonly<{
  commonsFile: string;
  altText: string;
  title: string;
  authorText: string;
  authorUrl: string | null;
  sourceUrl: string;
  licenseCode: string;
  licenseUrl: string;
  licenseLabel: string;
  sourceWidth: number;
}>;

/**
 * Zapisane zdjęcie: aplikacja nie czyta `commons_file` (bez grantu), a klucz importu już go
 * zawiera, więc porównanie pomija nazwę pliku.
 */
export type StoredPhoto = Readonly<{
  version: number;
  content: Omit<PhotoContent, "commonsFile">;
}>;

export type PhotoDecision =
  "create" | "noop" | "update" | "kept_manual_edit" | "kept_manual_delete";

export type PhotoResult =
  | "created"
  | "updated"
  | "noop"
  | "removed"
  | "kept_manual_edit"
  | "kept_manual_delete"
  | "skipped_unknown_license";

/** Najdłuższy tekst alternatywny w bazie (`CHECK`, 5.1). */
export const PHOTO_ALT_MAX_LENGTH = 200;

// Białe i sterujące znaki zamieniamy na jedną spację: `CHECK` w bazie odrzuca znaki sterujące.
const WHITE_OR_CONTROL = /[\s\u0000-\u001f\u007f-\u009f]+/g;

function cleanAlt(text: string): string {
  return text.replace(WHITE_OR_CONTROL, " ").slice(0, PHOTO_ALT_MAX_LENGTH).trim();
}

/** Tytuł z Commons oczyszczony i obcięty; gdy nic nie zostaje, nazwa pliku bez rozszerzenia. */
function altTextOf(image: ImportImage): string {
  const fromTitle = cleanAlt(image.title);

  if (fromTitle !== "") {
    return fromTitle;
  }

  return cleanAlt(
    image.commonsFile
      .replace(/^(?:File|Plik):/i, "")
      .replace(/\.[A-Za-z0-9]{1,5}$/, "")
      .replace(/_/g, " "),
  );
}

/** Treść wiersza z bloku `image`; tekst alternatywny to tytuł z Commons (obcięty do limitu). */
export function photoContentOf(image: ImportImage): PhotoContent {
  return {
    commonsFile: image.commonsFile,
    altText: altTextOf(image),
    title: image.title,
    authorText: image.authorText,
    authorUrl: image.authorUrl,
    sourceUrl: image.pageUrl,
    licenseCode: image.license.code,
    licenseUrl: image.license.url,
    licenseLabel: image.license.label,
    sourceWidth: image.sourceWidth,
  };
}

/**
 * Klucz zdjęcia w `catalog_import_keys`: wzór klucza bazy nie mieści nazwy pliku, więc to skrót
 * SHA-256 z klucza miejsca i nazwy pliku (40 znaków szesnastkowych).
 */
export function photoImportKey(placeKey: string, commonsFile: string): string {
  const digest = createHash("sha256").update(`${placeKey}\n${commonsFile}`, "utf8").digest("hex");

  return `img:${digest.slice(0, 40)}`;
}

function samePhotoContent(a: StoredPhoto["content"], b: PhotoContent): boolean {
  return (
    a.altText === b.altText &&
    a.title === b.title &&
    a.authorText === b.authorText &&
    a.authorUrl === b.authorUrl &&
    a.sourceUrl === b.sourceUrl &&
    a.licenseCode === b.licenseCode &&
    a.licenseUrl === b.licenseUrl &&
    a.licenseLabel === b.licenseLabel &&
    a.sourceWidth === b.sourceWidth
  );
}

/**
 * `key` brak: nigdy nie wgrane (utworzenie). `stored` null przy istniejącym kluczu: kurator usunął
 * zdjęcie, więc nie wraca. Inna wersja niż wgrana: zmienione ręcznie.
 */
export function decidePhoto(
  key: ImportKeyState | undefined,
  stored: StoredPhoto | null,
  wanted: PhotoContent,
): PhotoDecision {
  if (key === undefined) {
    return "create";
  }
  if (stored === null) {
    return "kept_manual_delete";
  }
  if (stored.version !== key.importedVersion) {
    return "kept_manual_edit";
  }

  return samePhotoContent(stored.content, wanted) ? "noop" : "update";
}
