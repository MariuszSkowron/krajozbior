import type { Meta, StoryObj } from "@storybook/react-vite";

import styles from "../foundation/foundation.module.css";
import { VisitMark } from "./visit-mark";

const meta = { title: "Krajozbiór Components/VisitMark" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

// Znacznik stoi na karcie (`color.surface.card`), jak odznaki stanu.
export const States: Story = {
  name: "Stany wizyty",
  render: () => (
    <main className={styles.page}>
      <h1>VisitMark</h1>
      <p className={styles.lead}>Jeden wygląd odwiedzonego miejsca; stan zawsze ma słowo.</p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-md)",
          padding: "var(--space-md)",
          background: "var(--color-surface-card)",
          borderRadius: "var(--radius-lg)",
        }}
      >
        <VisitMark>Odwiedzone</VisitMark>
        <VisitMark>Z przeszłości · marzec 2019</VisitMark>
      </div>
    </main>
  ),
};
