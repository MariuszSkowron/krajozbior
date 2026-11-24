import Link from "next/link";

import { cardCoverImage } from "@/features/catalog/domain/collection-cover";
import type { PublicNewsCard } from "@/features/news/application/news-read-types";
import { NEWS_KIND_LABELS } from "@/features/news/domain/news";
import { NEWS_LINK_REL, type NewsBodyParagraph } from "@/features/news/domain/news-body";
import {
  formatEventDays,
  formatNewsDate,
  newsDateTime,
  organizationInitial,
} from "@/features/news/domain/news-view";

import styles from "./news.module.css";

/**
 * Napis przy organizacji (Q4): zespół Krajozbioru nie jest „zweryfikowaną organizacją”. Przy
 * redakcji karta pokazuje samą nazwę, bez drugiego napisu o tym samym autorze.
 */
export function verificationLabel(verification: PublicNewsCard["verification"]): string {
  return verification === "editorial" ? "Zespół Krajozbioru" : "Zweryfikowana organizacja";
}

/** Inicjał, nazwa organizacji i napis weryfikacji; inicjał jest dekoracją (nazwa stoi obok). */
export function NewsOrganization({
  name,
  verification,
}: Readonly<{ name: string; verification: PublicNewsCard["verification"] }>) {
  return (
    <p className={styles.organization}>
      <span className={styles.initial} aria-hidden="true">
        {organizationInitial(name)}
      </span>
      <span>
        <span className={styles.organizationName}>{name}</span>
        {verification === "editorial" ? null : ` · ${verificationLabel(verification)}`}
      </span>
    </p>
  );
}

/** Sam rodzaj nad tytułem: data publikacji nie stoi w nadtytule, żeby nie wyglądała na termin wydarzenia. */
export function NewsKicker({ card }: Readonly<{ card: PublicNewsCard }>) {
  return (
    <p className={styles.kicker}>
      <span>{NEWS_KIND_LABELS[card.kind]}</span>
    </p>
  );
}

/** „Dodano 22.11.2026”: data publikacji z opisem, w linii z autorem. */
export function NewsPublished({ card }: Readonly<{ card: PublicNewsCard }>) {
  return (
    <p className={styles.published}>
      Dodano{" "}
      <time dateTime={newsDateTime(card.publishedAt)}>{formatNewsDate(card.publishedAt)}</time>
    </p>
  );
}

export function NewsEventDays({ card }: Readonly<{ card: PublicNewsCard }>) {
  return card.eventStartsOn === null ? null : (
    <p className={styles.eventDays}>
      Termin:{" "}
      <time dateTime={card.eventStartsOn}>
        {formatEventDays(card.eventStartsOn, card.eventEndsOn)}
      </time>
    </p>
  );
}

/**
 * Karta listy: pozioma, na całą szerokość listy (jak „Kolekcje z tym miejscem”): zdjęcie 1/3 i
 * tekst 2/3, na telefonie zdjęcie 16:9 nad tekstem. `<article>` z jednym linkiem, tytułem,
 * rozciągniętym na całą kartę. Zdjęcie jest ozdobą (pusty `alt`): tytuł stoi obok; miniatura nie
 * ma podpisu (D-55 pkt 2). Wpis bez zdjęcia ma to samo pole z tłem zastępczym.
 */
export function NewsCard({
  card,
  featured,
}: Readonly<{ card: PublicNewsCard; featured: boolean }>) {
  const image = cardCoverImage(card.cover);

  return (
    <article className={featured ? `${styles.card} ${styles.featured}` : styles.card}>
      <div className={styles.image} aria-hidden={image === null ? "true" : undefined}>
        {image === null ? null : (
          // eslint-disable-next-line @next/next/no-img-element -- plik z własnej trasy, bez optymalizatora
          <img
            className={image.whole ? styles.imageWhole : undefined}
            src={image.src}
            srcSet={image.srcSet}
            sizes={featured ? "(min-width: 48rem) 42rem, 100vw" : "(min-width: 48rem) 30rem, 100vw"}
            width={image.width}
            height={image.height}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
      </div>
      <div className={styles.cardBody}>
        <NewsKicker card={card} />
        <h2 className={styles.cardTitle}>
          <Link className={styles.cardLink} href={`/news/${card.slug}`}>
            {card.title}
          </Link>
        </h2>
        <NewsEventDays card={card} />
        <p className={styles.lead}>{card.lead}</p>
        <NewsOrganization name={card.organization.name} verification={card.verification} />
        <NewsPublished card={card} />
      </div>
    </article>
  );
}

/**
 * Treść aktualności: akapity i linki `https://` z `parseNewsBody`. Fragmenty są węzłami
 * tekstowymi Reacta (nigdy `dangerouslySetInnerHTML`), więc znaczniki i `javascript:` w treści
 * zostają zwykłym tekstem. Adres wpisany z literami spoza ASCII pokazujemy w postaci `xn--`
 * z dopiskiem, co wpisał autor (ostrzeżenie przed podobnym wyglądem znaków).
 */
export function NewsBody({ paragraphs }: Readonly<{ paragraphs: readonly NewsBodyParagraph[] }>) {
  return (
    <div className={styles.body}>
      {paragraphs.map((fragments, paragraphIndex) => (
        <p key={paragraphIndex}>
          {fragments.map((fragment, index) =>
            fragment.kind === "text" ? (
              <span key={index}>{fragment.text}</span>
            ) : (
              <span key={index}>
                <a href={fragment.href} rel={NEWS_LINK_REL}>
                  {fragment.text}
                </a>
                {fragment.original === null ? null : <> {`(autor wpisał: ${fragment.original})`}</>}
              </span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}
