export type MediaKind = "place" | "explorer";
export type MediaVariant = "main" | "w400" | "og";

const KIND_DIRECTORY: Record<MediaKind, string> = { place: "p", explorer: "e" };
const VARIANT_FILE: Record<MediaVariant, string> = {
  main: "main.webp",
  w400: "w400.webp",
  og: "og.jpg",
};

// Klucz pliku jest generowany przez serwer; dopuszczamy tylko znaki bezpieczne w ścieżce,
// żeby żaden klucz nie mógł wyjść poza katalog zdjęć.
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$/;

export function isMediaKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** Katalog zdjęcia względem `MEDIA_ROOT`: `{p|e}/{2 pierwsze znaki}/{klucz}` (5.3 krok 7). */
export function mediaDirectory(kind: MediaKind, key: string): string {
  if (!isMediaKey(key)) throw new Error("Nieprawidłowy klucz pliku zdjęcia.");
  return `${KIND_DIRECTORY[kind]}/${key.slice(0, 2)}/${key}`;
}

/** Ścieżka pliku wariantu względem `MEDIA_ROOT`. */
export function mediaFilePath(kind: MediaKind, key: string, variant: MediaVariant): string {
  return `${mediaDirectory(kind, key)}/${VARIANT_FILE[variant]}`;
}
