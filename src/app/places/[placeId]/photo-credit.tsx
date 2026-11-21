import { buildPhotoCredit, type PhotoCreditInput } from "@/features/photos/domain/photo-credit";

import styles from "./photo-credit.module.css";

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
        Licencja:{" "}
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
