import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { CollectionComplete } from "@/design-system/components/collection-progress";
import type { CollectionBanner } from "@/features/catalog/application/catalog-types";
import { showsWhole } from "@/features/catalog/domain/collection-cover";
import { THUMB_WIDTH } from "@/features/media/domain/limits";
import { buildPhotoCredit } from "@/features/photos/domain/photo-credit";

import styles from "./home-banner.module.css";

// Okładka banera; z puli gościa (PR 4) ma jeszcze kadr (`object-position` na laptopie i telefonie).
type BannerCover = CollectionBanner & { focus?: Readonly<{ wide: string; narrow: string }> };

// Zdjęcie banera: natywne <img> z `srcset` (miniatura `w400` i plik `main`), wymiary z bazy
// rezerwują miejsce, kadr stylami (`object-fit: cover`; panoramy i zdjęcia pionowe w całości,
// Q4). Baner jest zdjęciem nad treścią strony, więc ładuje się od razu (`fetchPriority`).
export function BannerPhoto({
  cover,
  alt,
  className,
}: Readonly<{ cover: BannerCover; alt: string; className: string }>) {
  const main = `/media/p/${cover.photoId}/main`;
  const thumb = `/media/p/${cover.photoId}/w400`;
  const hasChoice = cover.width > THUMB_WIDTH;
  const whole = showsWhole(cover.width, cover.height);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- plik z własnej trasy, bez optymalizatora
    <img
      className={`${className} ${whole ? styles.photoWhole : styles.photo}`}
      src={main}
      srcSet={hasChoice ? `${thumb} ${THUMB_WIDTH}w, ${main} ${cover.width}w` : undefined}
      sizes={hasChoice ? "(min-width: 90rem) 84rem, 100vw" : undefined}
      width={cover.width}
      height={cover.height}
      style={
        cover.focus === undefined
          ? undefined
          : ({
              "--focus-wide": cover.focus.wide,
              "--focus-narrow": cover.focus.narrow,
            } as CSSProperties)
      }
      alt={alt}
      decoding="async"
      fetchPriority="high"
    />
  );
}

// Podpis zdjęcia na banerze: miejsce jako link, potem autor, źródło i licencja (wymogi licencji
// CC), jak pod zdjęciem na stronie miejsca. Teksty z zewnątrz wstawia React jako tekst.
export function BannerCredit({
  cover,
  className,
}: Readonly<{ cover: CollectionBanner; className: string }>) {
  const credit = buildPhotoCredit(cover);

  return (
    <p className={className}>
      <Link
        className={`${styles.creditLink} ${styles.placeLink}`}
        href={`/places/${cover.placeId}`}
      >
        {cover.placeName}
      </Link>
      <span className={styles.sep}> · </span>
      {credit.title === null ? null : `${credit.title}. `}
      Autor:{" "}
      {credit.author.url === null ? (
        credit.author.text
      ) : (
        <a className={styles.creditLink} href={credit.author.url} rel="noopener noreferrer">
          {credit.author.text}
        </a>
      )}
      .
      {credit.source === null ? null : (
        <>
          {" "}
          Źródło:{" "}
          <a className={styles.creditLink} href={credit.source.url} rel="noopener noreferrer">
            {credit.source.label}
          </a>
          .
        </>
      )}{" "}
      {credit.license.heading}:{" "}
      {credit.license.url === null ? (
        credit.license.label
      ) : (
        <a className={styles.creditLink} href={credit.license.url} rel="noopener noreferrer">
          {credit.license.label}
        </a>
      )}
      .{credit.notices.length === 0 ? null : ` ${credit.notices.join(" ")}`}
    </p>
  );
}

// Baner strony głównej (R3, D-57): zdjęcie na całą szerokość ramy, na nim treść (dzieci) i podpis
// zdjęcia. Gość: nagłówek, akapit i przyciski; odkrywca bez zapisanej kolekcji: stan pusty.
// Bez zdjęcia: spokojne tło zastępcze i tekst w kolorach motywu.
export function HomeBanner({
  cover,
  size: variant = "tall",
  children,
}: Readonly<{
  cover: BannerCover | null;
  /** `short`: baner z jednym zdaniem (stan pusty), niższy niż `tall` gościa. */
  size?: "tall" | "short";
  children: ReactNode;
}>) {
  const size = variant === "short" ? styles.short : styles.tall;

  if (cover === null) {
    return (
      <div className={`${styles.banner} ${styles.plain} ${size}`}>
        <div className={styles.body}>{children}</div>
      </div>
    );
  }

  return (
    <div className={`${styles.banner} ${styles.withPhoto} ${size}`}>
      <BannerPhoto cover={cover} alt={cover.altText} className={styles.settle} />
      <div className={styles.body}>
        {children}
        <BannerCredit cover={cover} className={styles.credit} />
      </div>
    </div>
  );
}

// Baner odkrywcy z zapisaną kolekcją: okładka tej kolekcji, tytuł, etykieta i duża liczba
// postępu. Cały baner jest jednym linkiem do kolekcji; podpis zdjęcia stoi pod nim, bo linki
// nie mogą być zagnieżdżone. Pasek jest ozdobą (liczba jest w tekście dla czytnika).
export function SavedCollectionBanner({
  cover,
  href,
  eyebrow,
  title,
  progress,
}: Readonly<{
  cover: CollectionBanner | null;
  href: string;
  eyebrow: string;
  title: string;
  progress: Readonly<{ visited: number; total: number }> | null;
}>) {
  return (
    <div className={styles.saved}>
      <Link
        className={`${styles.banner} ${styles.compact} ${cover === null ? styles.plain : styles.withPhoto} ${styles.link}`}
        href={href}
      >
        {cover === null ? null : <BannerPhoto cover={cover} alt="" className={styles.still} />}
        <div className={`${styles.body} ${styles.savedBody}`}>
          <div>
            <span className={styles.eyebrow}>{eyebrow}</span>
            <h3 className={styles.savedTitle}>{title}</h3>
          </div>
          {progress === null || progress.total === 0 ? null : (
            <span className={styles.count}>
              <span className={styles.srOnly}>
                {progress.visited}/{progress.total} odwiedzone
                {progress.visited >= progress.total ? ". Kolekcja kompletna" : ""}
              </span>
              <span className={styles.countNumber} aria-hidden="true">
                <span className={styles.countBig}>{progress.visited}</span>
                <span className={styles.countOf}>/{progress.total}</span>
              </span>
              <span className={styles.eyebrow} aria-hidden="true">
                {progress.visited >= progress.total ? <CollectionComplete /> : "odwiedzone"}
              </span>
              <span className={styles.bar} aria-hidden="true">
                <span
                  className={styles.fill}
                  style={{ "--fill": progress.visited / progress.total } as CSSProperties}
                />
              </span>
            </span>
          )}
        </div>
      </Link>
      {cover === null ? null : <BannerCredit cover={cover} className={styles.creditBelow} />}
    </div>
  );
}
