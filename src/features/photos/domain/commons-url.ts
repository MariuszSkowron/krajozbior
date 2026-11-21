import { createHash } from "node:crypto";

// Adres miniatury zdjęcia z Wikimedia Commons (E4-2a, spec 5.5 i 5.11.5). Polecenie pobierania
// buduje go samo z nazwy pliku w Commons; adresu z pliku kolekcji nie bierze (plik jest daną
// zewnętrzną, a host i schemat sprawdza klient HTTP osobno).

export const COMMONS_UPLOAD_HOST = "upload.wikimedia.org";

/** Standardowe szerokości miniatur Wikimedia (kroki, które serwer chętnie podaje z pamięci podręcznej). */
export const STANDARD_THUMB_WIDTHS: readonly number[] = [
  20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920,
];

/** Największa pobierana szerokość miniatury (spec: nigdy oryginał ani miniatura powyżej 1920 px). */
export const MAX_THUMB_WIDTH = 1920;

/**
 * Największy standardowy krok nie większy niż `min(1920, szerokość oryginału)`. Wikimedia odmawia
 * miniatury szerszej niż oryginał, więc krok nigdy nie przekracza szerokości źródła. `null`, gdy
 * oryginał jest węższy niż najmniejszy krok.
 */
export function pickThumbWidth(sourceWidth: number): number | null {
  if (!Number.isInteger(sourceWidth) || sourceWidth < 1) {
    return null;
  }

  const limit = Math.min(MAX_THUMB_WIDTH, sourceWidth);
  const fitting = STANDARD_THUMB_WIDTHS.filter((width) => width <= limit);

  return fitting.length === 0 ? null : fitting[fitting.length - 1]!;
}

/** Nazwa pliku jak w adresie: bez przedrostka `File:`, spacje jako `_`. */
export function commonsFileName(commonsFile: string): string {
  return commonsFile
    .trim()
    .replace(/^(?:File|Plik):/i, "")
    .replace(/ /g, "_");
}

// `encodeURIComponent` zostawia `!'()*`; Wikimedia koduje je w adresach plików, więc kodujemy też.
function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * `https://upload.wikimedia.org/wikipedia/commons/thumb/{a}/{ab}/{nazwa}/{szerokość}px-{nazwa}`;
 * katalog z pierwszych znaków skrótu MD5 nazwy (z podkreślnikami), każdy segment zakodowany
 * procentowo. `null`, gdy nie da się wybrać szerokości albo nazwa jest pusta lub zawiera `/`.
 */
export function buildCommonsThumbUrl(commonsFile: string, sourceWidth: number): string | null {
  const name = commonsFileName(commonsFile);
  const width = pickThumbWidth(sourceWidth);

  if (name === "" || name.includes("/") || width === null) {
    return null;
  }

  const hash = createHash("md5").update(name, "utf8").digest("hex");
  const encoded = encodeSegment(name);

  return `https://${COMMONS_UPLOAD_HOST}/wikipedia/commons/thumb/${hash[0]}/${hash.slice(0, 2)}/${encoded}/${width}px-${encoded}`;
}
