import type { Metadata } from "next";

import { LEGAL_DOCUMENTS } from "@/features/legal/content";
import { legalPage, type LegalSlug } from "@/features/legal/domain/legal-pages";
import { parseMarkdown, type Block } from "@/features/legal/domain/markdown";

import { LegalBlocks } from "./legal-document";
import styles from "./legal.module.css";

type HeadingBlock = Extract<Block, { kind: "heading" }>;

// Tytuł karty stron prawnych. Od wersji 1.1 (pierwszej obowiązującej) strony są indeksowane;
// `noindex` obowiązywał tylko dla wersji roboczej (E11-Q15 A).
export function legalMetadata(slug: LegalSlug): Metadata {
  return { title: `${legalPage(slug).title} — Krajozbiór` };
}

// Strona prawna (F-K3, spec E11, sekcja 5.9): publiczna, bez logowania. U góry numer wersji
// z datą wejścia w życie, spis treści z kotwicami (dla długich tekstów) i lista wersji
// dokumentu (wersja 1.1 jest pierwszą obowiązującą, regulamin rozdz. 16 ust. 1).
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
      <p className={styles.version}>
        Wersja {document.version} — obowiązuje od {document.date}
      </p>
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
            Wersja {document.version} z dnia {document.date} (obowiązująca)
          </li>
        </ul>
      </section>
    </article>
  );
}
