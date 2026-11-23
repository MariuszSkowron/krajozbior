import type { Meta, StoryObj } from "@storybook/react-vite";

import styles from "../foundation/foundation.module.css";
import { legendaryCategories, legendaryCategoryLabel } from "./legendary-card";
import { LegendaryEmblem } from "./legendary-emblems";
import { previewNote } from "./legendary-card.samples";

const meta = {
  title: "Krajozbiór Components/LegendaryEmblem",
  parameters: {
    a11y: { test: "error" },
    docs: { description: { component: previewNote } },
  },
} satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

export const Categories: Story = {
  name: "Emblematy kategorii",
  parameters: {
    docs: {
      description: {
        story: `${previewNote} Sześć rysunków w rozmiarach 7,5 rem (zasłona) i 3 rem (karta czekająca w skrytce). Nazwa kategorii jest tekstem pod rysunkiem; sam rysunek to dekoracja.`,
      },
    },
  },
  render: () => (
    <main
      className={`theme-dark ${styles.page}`}
      style={{ background: "var(--color-surface-canvas)" }}
    >
      <h1>Emblematy kategorii</h1>
      <p className={styles.lead}>{previewNote}</p>
      <ul
        style={{
          display: "grid",
          gap: "var(--space-lg)",
          gridTemplateColumns: "repeat(auto-fill, minmax(min(9rem, 100%), 1fr))",
          margin: 0,
          padding: 0,
          listStyle: "none",
        }}
      >
        {legendaryCategories.map((category) => (
          <li
            key={category}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--space-sm)",
              color: "var(--color-text-label)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            <span style={{ display: "block", inlineSize: "7.5rem", blockSize: "7.5rem" }}>
              <LegendaryEmblem category={category} />
            </span>
            <span style={{ display: "block", inlineSize: "3rem", blockSize: "3rem" }}>
              <LegendaryEmblem category={category} />
            </span>
            {legendaryCategoryLabel(category)}
          </li>
        ))}
      </ul>
    </main>
  ),
};
