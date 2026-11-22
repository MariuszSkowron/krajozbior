// Okładka kolekcji na karcie i w podglądzie linku (E4-3). Czysta domena: adresy trasy `/media`
// i wymiary obrazu; kto może zdjęcie zobaczyć, rozstrzyga trasa (RLS), nie ta funkcja.

/** Szerokość miniatury `w400` (D-E4-5); miniatura nie jest większa niż plik główny. */
const CARD_WIDTH = 400;

export type CardCoverInput = Readonly<{
  photoId: string;
  width: number;
  height: number;
  altText: string;
}>;

export type CardCoverImage = Readonly<{
  src: string;
  width: number;
  height: number;
  alt: string;
}>;

/**
 * Obraz okładki na karcie: miniatura `w400`, z wymiarami miniatury (rezerwują miejsce, strona nie
 * skacze). Zdjęcie węższe niż 400 px nie jest powiększane, więc miniatura ma jego wymiary.
 */
export function cardCoverImage(cover: CardCoverInput | null): CardCoverImage | null {
  if (cover === null) {
    return null;
  }

  const width = Math.min(cover.width, CARD_WIDTH);

  return {
    src: `/media/p/${cover.photoId}/w400`,
    width,
    height: Math.max(1, Math.round((cover.height * width) / cover.width)),
    alt: cover.altText,
  };
}

export type CoverCreditInput = Readonly<{
  authorText: string;
  licenseLabel: string;
  sourceKind: "own" | "third_party" | "commons_import";
}>;

const OG_DESCRIPTION_MAX = 200;

/**
 * Krótki podpis okładki do `og:description` i `twitter:description`: większość serwisów pokazuje
 * opis w podglądzie linku, więc autor i licencja są widoczne bez kliknięcia (CC BY wymaga uznania
 * autorstwa). `alt` obrazu zostaje opisem zdjęcia. Pełny podpis jest pod okładką na stronie.
 */
export function ogCoverDescription(cover: CoverCreditInput): string {
  const source = cover.sourceKind === "commons_import" ? ", Wikimedia Commons" : "";
  const text = `Okładka: fot. ${cover.authorText.trim()}, ${cover.licenseLabel.trim()}${source}`;

  return text.length <= OG_DESCRIPTION_MAX ? text : `${text.slice(0, OG_DESCRIPTION_MAX - 1)}…`;
}

/**
 * Adres obrazu do `og:image` (JPEG 1200 px) pod adresem serwisu albo `null`, gdy kolekcja nie ma
 * okładki albo serwis nie zna swojego adresu (`BETTER_AUTH_URL`): podgląd linku wymaga adresu
 * bezwzględnego, a odgadywanie go z nagłówka żądania pozwalałoby podstawić cudzy adres.
 */
export function ogImageUrl(
  publicBaseUrl: string | undefined,
  cover: Pick<CardCoverInput, "photoId"> | null,
): string | null {
  if (cover === null || publicBaseUrl === undefined || publicBaseUrl.trim() === "") {
    return null;
  }

  let origin: string;

  try {
    origin = new URL(publicBaseUrl).origin;
  } catch {
    return null;
  }

  return `${origin}/media/p/${cover.photoId}/og`;
}
