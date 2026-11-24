// Podpis zdjęcia (spec E4, 5.11.7, decyzje D-46 pkt 5 i 9): autor (z linkiem, gdy jest adres),
// tytuł, źródło z linkiem, licencja z linkiem w dokładnej wersji (`license_label`) i zdania o
// zmianach, których wymagają licencje CC. Czysta domena: komponent tylko to wyświetla.

export type PhotoSourceKind = "own" | "third_party" | "commons_import";

export type PhotoCreditInput = Readonly<{
  sourceKind: PhotoSourceKind;
  title: string | null;
  authorText: string;
  authorUrl: string | null;
  sourceUrl: string | null;
  licenseCode: string;
  licenseUrl: string | null;
  licenseLabel: string;
}>;

export type PhotoCredit = Readonly<{
  title: string | null;
  author: Readonly<{ text: string; url: string | null }>;
  source: Readonly<{ label: string; url: string }> | null;
  /** `heading`: „Licencja” albo, dla znaku domeny publicznej (to nie licencja), „Status”. */
  license: Readonly<{ heading: "Licencja" | "Status"; label: string; url: string | null }>;
  /** Zdania po linii z danymi: informacja o zmianach i o licencji kopii. */
  notices: readonly string[];
}>;

export const CHANGES_NOTICE = "Zdjęcie zmniejszyliśmy i zapisaliśmy w formacie WebP.";
export const SAME_LICENCE_NOTICE = "Tę kopię udostępniamy na tej samej licencji.";

export function buildPhotoCredit(photo: PhotoCreditInput): PhotoCredit {
  const notices: string[] = [];

  // Wszystkie licencje CC (także CC0) dostają zdanie o zmianach; CC BY-SA także o licencji kopii
  // (Q5 A). Znak domeny publicznej nie jest licencją i niczego nie wymaga.
  if (photo.licenseCode.startsWith("cc")) {
    notices.push(CHANGES_NOTICE);
  }

  if (photo.licenseCode.startsWith("cc-by-sa")) {
    notices.push(SAME_LICENCE_NOTICE);
  }

  return {
    title: photo.title,
    author: { text: photo.authorText, url: photo.authorUrl },
    source:
      photo.sourceUrl === null
        ? null
        : {
            label: photo.sourceKind === "commons_import" ? "Wikimedia Commons" : "Źródło",
            url: photo.sourceUrl,
          },
    license: {
      heading: photo.licenseCode === "public-domain" ? "Status" : "Licencja",
      label: photo.licenseLabel,
      url: photo.licenseUrl,
    },
    notices,
  };
}

// Krótki podpis (D-58): jedna linia pod zdjęciem poza stroną miejsca (baner, okładka kolekcji).
// Pełny podpis (`buildPhotoCredit`) zostaje na stronie miejsca. Krótki nadal wymienia autora,
// źródło, licencję z linkiem i fakt zmiany pliku, których wymagają licencje CC.
export const SHORT_CHANGES_NOTICE = "zdjęcie zmniejszone";

export type ShortPhotoCredit = Readonly<{
  author: Readonly<{ text: string; url: string | null }>;
  source: Readonly<{ label: string; url: string }> | null;
  license: Readonly<{ label: string; url: string | null }>;
  /** Zdanie o zmianie pliku (licencje CC), `null` dla domeny publicznej. */
  notice: string | null;
}>;

export function buildShortPhotoCredit(photo: PhotoCreditInput): ShortPhotoCredit {
  const full = buildPhotoCredit(photo);

  return {
    author: full.author,
    source: full.source,
    license: { label: full.license.label, url: full.license.url },
    notice: full.notices.length === 0 ? null : SHORT_CHANGES_NOTICE,
  };
}

/** Tekst krótkiego podpisu bez linków: „Miejsce · fot. Autor, Źródło · Licencja · zdjęcie zmniejszone”. */
export function shortPhotoCreditText(placeName: string | null, credit: ShortPhotoCredit): string {
  const photographer = [`fot. ${credit.author.text}`, credit.source?.label]
    .filter((part) => part !== undefined)
    .join(", ");

  return [placeName, photographer, credit.license.label, credit.notice]
    .filter((part) => part !== null)
    .join(" · ");
}
