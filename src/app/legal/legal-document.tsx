import Link from "next/link";
import type { ReactNode } from "react";

import type { Block, Inline, ListBlock } from "@/features/legal/domain/markdown";

import styles from "./legal.module.css";

// Wypisuje drzewo z czytnika Markdownu (src/features/legal/domain/markdown.ts) elementami
// natywnymi: nagłówki, listy, tabele. Nic nie jest wstawiane jako HTML, więc tekst nie może
// wnieść własnych znaczników.

function renderInlines(inlines: readonly Inline[]): ReactNode[] {
  return inlines.map((inline, index) => {
    switch (inline.kind) {
      case "strong":
        return <strong key={index}>{inline.text}</strong>;
      case "em":
        return <em key={index}>{inline.text}</em>;
      case "link":
        return inline.href.startsWith("/") ? (
          <Link key={index} href={inline.href}>
            {inline.text}
          </Link>
        ) : (
          <a key={index} href={inline.href} rel="noopener noreferrer">
            {inline.text}
          </a>
        );
      case "text":
        return inline.text;
    }
  });
}

function renderList(block: ListBlock, key: number): ReactNode {
  const items = block.items.map((item, index) => (
    <li key={index}>
      {renderInlines(item.inlines)}
      {item.children.map((child, childIndex) => renderList(child, childIndex))}
    </li>
  ));

  return block.ordered ? (
    <ol key={key} start={block.start}>
      {items}
    </ol>
  ) : (
    <ul key={key}>{items}</ul>
  );
}

export function LegalBlocks({ blocks }: Readonly<{ blocks: readonly Block[] }>) {
  let lastHeading = "";

  return blocks.map((block, index) => {
    switch (block.kind) {
      case "heading": {
        lastHeading = block.text;

        return block.level === 2 ? (
          <h2 key={index} id={block.id}>
            {block.text}
          </h2>
        ) : (
          <h3 key={index} id={block.id}>
            {block.text}
          </h3>
        );
      }
      case "paragraph":
        return <p key={index}>{renderInlines(block.inlines)}</p>;
      case "list":
        return renderList(block, index);
      case "table":
        // Szeroka tabela przewija się w poziomie; obszar przewijania musi dać się
        // osiągnąć klawiaturą i mieć nazwę (WCAG 2.1.1, 4.1.2).
        return (
          <div
            key={index}
            className={styles.tableScroll}
            role="region"
            aria-label={lastHeading === "" ? "Tabela" : `Tabela: ${lastHeading}`}
            tabIndex={0}
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    <th key={cellIndex} scope="col">
                      {renderInlines(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{renderInlines(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}
