import Link from "next/link";

import type { CollectionBanner } from "@/features/catalog/application/catalog-types";
import { buildPhotoCredit } from "@/features/photos/domain/photo-credit";

import styles from "../places/[placeId]/photo-credit.module.css";

/**
 * Krótki podpis okładki wpisu (D-58 pkt 3): jedna linia „<miejsce> · fot. <autor>, <źródło> ·
 * <licencja> · zdjęcie zmniejszone”. Zdjęcie pochodzi z miejsca, nie z wydarzenia, więc nazwa
 * miejsca (link do jego strony) stoi na początku. Pełny podpis jest na stronie miejsca. Teksty
 * z zewnątrz wstawia React jako tekst; adresy w bazie mają wymuszone `https://`.
 */
export function NewsPhotoCredit({ photo }: Readonly<{ photo: CollectionBanner }>) {
  const credit = buildPhotoCredit(photo);
  const changed = credit.notices.length > 0;

  return (
    <figcaption className={styles.credit}>
      <p>
        <Link href={`/places/${photo.placeId}`}>{photo.placeName}</Link>
        {" · fot. "}
        {credit.author.url === null ? (
          credit.author.text
        ) : (
          <a href={credit.author.url} rel="noopener noreferrer">
            {credit.author.text}
          </a>
        )}
        {credit.source === null ? null : (
          <>
            {", "}
            <a href={credit.source.url} rel="noopener noreferrer">
              {credit.source.label}
            </a>
          </>
        )}
        {" · "}
        {credit.license.url === null ? (
          credit.license.label
        ) : (
          <a href={credit.license.url} rel="noopener noreferrer">
            {credit.license.label}
          </a>
        )}
        {changed ? " · zdjęcie zmniejszone" : null}
      </p>
    </figcaption>
  );
}
