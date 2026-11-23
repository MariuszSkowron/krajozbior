import Link from "next/link";

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

/** Napis przy organizacji (Q4): zespół Krajozbioru nie jest „zweryfikowaną organizacją”. */
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
        <span className={styles.organizationName}>{name}</span> · {verificationLabel(verification)}
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

/** Karta listy: `<article>` z jednym linkiem, tytułem. */
export function NewsCard({
  card,
  featured,
}: Readonly<{ card: PublicNewsCard; featured: boolean }>) {
  return (
    <article className={featured ? `${styles.card} ${styles.featured}` : styles.card}>
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
