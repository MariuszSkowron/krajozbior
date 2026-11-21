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
  license: Readonly<{ label: string; url: string | null }>;
  /** Zdania po linii z danymi: informacja o zmianach i o licencji kopii. */
  notices: readonly string[];
}>;

export const CHANGES_NOTICE = "Zdjęcie zmniejszone i skompresowane, zapisane w formacie WebP.";

export function buildPhotoCredit(photo: PhotoCreditInput): PhotoCredit {
  const notices: string[] = [];

  // Wszystkie licencje CC (także CC0) dostają zdanie o zmianach; CC BY-SA także o licencji kopii
  // (Q5 A). Znak domeny publicznej nie jest licencją i niczego nie wymaga.
  if (photo.licenseCode.startsWith("cc")) {
    notices.push(CHANGES_NOTICE);
  }

  if (photo.licenseCode.startsWith("cc-by-sa")) {
    notices.push(`Ta kopia jest dostępna na licencji ${photo.licenseLabel}.`);
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
    license: { label: photo.licenseLabel, url: photo.licenseUrl },
    notices,
  };
}
