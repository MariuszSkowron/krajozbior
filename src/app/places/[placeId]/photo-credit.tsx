import Link from "next/link";

import {
  buildPhotoCredit,
  buildShortPhotoCredit,
  type PhotoCreditInput,
} from "@/features/photos/domain/photo-credit";

import styles from "./photo-credit.module.css";

// Krótki podpis zdjęcia (D-58): jedna linia „Miejsce · fot. Autor, Wikimedia Commons · Licencja ·
// zdjęcie zmniejszone”; nazwa miejsca prowadzi do jego strony, źródło i licencja do swoich stron.
// Pełny podpis (`PhotoCredit`) jest tylko na stronie miejsca. `className` i `linkClassName` dają
// kolory zależne od tła (zdjęcie albo strona).
export function PhotoCreditLine({
  photo,
  place,
  className,
  linkClassName,
}: Readonly<{
  photo: PhotoCreditInput;
  place: Readonly<{ id: string; name: string }> | null;
  className?: string;
  linkClassName?: string;
}>) {
  const credit = buildShortPhotoCredit(photo);
  const link = linkClassName ?? styles.lineLink;

  return (
    <p className={className ?? styles.line}>
      {place === null ? null : (
        <>
          <Link className={link} href={`/places/${place.id}`}>
            {place.name}
          </Link>{" "}
          ·{" "}
        </>
      )}
      fot.{" "}
      {credit.author.url === null ? (
        credit.author.text
      ) : (
        <a className={link} href={credit.author.url} rel="noopener noreferrer">
          {credit.author.text}
        </a>
      )}
      {credit.source === null ? null : (
        <>
          ,{" "}
          <a className={link} href={credit.source.url} rel="noopener noreferrer">
            {credit.source.label}
          </a>
        </>
      )}{" "}
      ·{" "}
      {credit.license.url === null ? (
        credit.license.label
      ) : (
        <a className={link} href={credit.license.url} rel="noopener noreferrer">
          {credit.license.label}
        </a>
      )}
      {credit.notice === null ? null : ` · ${credit.notice}`}
    </p>
  );
}

// Podpis zdjęcia (E4-2b, S2): skąd jest zdjęcie, kto je zrobił i na jakiej licencji. To osobna
// rzecz niż linia źródeł danych miejsca (`PlaceSources`), która mówi, skąd są dane. Wymogi licencji
// CC: autor, licencja z linkiem w dokładnej wersji, źródło i informacja o zmianach. Teksty z
// zewnątrz (autor, tytuł) wstawia React jako tekst; adresy w bazie mają wymuszone `https://`.
export function PhotoCredit({ photo }: Readonly<{ photo: PhotoCreditInput }>) {
  const credit = buildPhotoCredit(photo);

  return (
    <figcaption className={styles.credit}>
      <p>
        {credit.title === null ? null : <span className={styles.title}>{credit.title}. </span>}
        Autor:{" "}
        {credit.author.url === null ? (
          credit.author.text
        ) : (
          <a href={credit.author.url} rel="noopener noreferrer">
            {credit.author.text}
          </a>
        )}
        .
        {credit.source === null ? null : (
          <>
            {" "}
            Źródło:{" "}
            <a href={credit.source.url} rel="noopener noreferrer">
              {credit.source.label}
            </a>
            .
          </>
        )}{" "}
        {credit.license.heading}:{" "}
        {credit.license.url === null ? (
          credit.license.label
        ) : (
          <a href={credit.license.url} rel="noopener noreferrer">
            {credit.license.label}
          </a>
        )}
        .
      </p>
      {credit.notices.length === 0 ? null : <p>{credit.notices.join(" ")}</p>}
    </figcaption>
  );
}
