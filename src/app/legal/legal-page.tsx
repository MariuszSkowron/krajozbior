import type { Metadata } from "next";

import { LEGAL_DOCUMENTS } from "@/features/legal/content";
import { legalPage, type LegalSlug } from "@/features/legal/domain/legal-pages";
import { parseMarkdown, type Block } from "@/features/legal/domain/markdown";

import { LegalBlocks } from "./legal-document";
import styles from "./legal.module.css";

type HeadingBlock = Extract<Block, { kind: "heading" }>;

// Tytuł karty i `noindex` stron prawnych w wersji roboczej (E11-Q15 A): robocza polityka nie
// ma krążyć w wynikach wyszukiwarek. Linki ze strony dalej są śledzone (`follow`).
export function legalMetadata(slug: LegalSlug): Metadata {
  return {
    title: `${legalPage(slug).title} — Krajozbiór`,
    robots: { index: false, follow: true },
  };
}

// Strona prawna (F-K3, spec E11, sekcja 5.9): publiczna, bez logowania. U góry wyróżniony
// dopisek „Wersja robocza”, numer wersji, spis treści z kotwicami (dla długich tekstów)
// i lista wersji dokumentu (przed pierwszą zmianą ma jeden wpis, regulamin rozdz. 16 ust. 1).
export function LegalPage({ slug }: Readonly<{ slug: LegalSlug }>) {
  const document = LEGAL_DOCUMENTS[slug];
  const { title } = legalPage(slug);
  const blocks = parseMarkdown(document.markdown);
  const sections = blocks.filter(
    (block): block is HeadingBlock => block.kind === "heading" && block.level === 2,
  );

  return (
    <article className={`content-width ${styles.page}`}>
      <h1>{title}</h1>
      <p className={styles.draft}>
        <strong>Wersja robocza z dnia {document.date}</strong> Tekst czeka na sprawdzenie przez
        prawnika.
      </p>
      <p className={styles.version}>Wersja {document.version}</p>
      {sections.length >= 4 ? (
        <nav aria-label="Spis treści" className={styles.toc}>
          <h2 className={styles.tocTitle}>Spis treści</h2>
          <ol>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className={styles.body}>
        <LegalBlocks blocks={blocks} />
      </div>
      <section aria-labelledby="wersje-dokumentu" className={styles.versions}>
        <h2 id="wersje-dokumentu">Wersje tego dokumentu</h2>
        <ul>
          <li>
            Wersja {document.version} z dnia {document.date} (obowiązująca, robocza)
          </li>
        </ul>
      </section>
    </article>
  );
}
