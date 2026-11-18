import type { Meta, StoryObj } from "@storybook/react-vite";

import styles from "../foundation/foundation.module.css";
import { StatusBadge } from "./status-badge";

const meta = { title: "Krajozbiór Components/StatusBadge" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

// Odznaki stoją na karcie (`color.surface.card`): tak wymaga reguła tła w jasnym motywie.
export const Tones: Story = {
  name: "Stany na karcie",
  render: () => (
    <main className={styles.page}>
      <h1>StatusBadge</h1>
      <p className={styles.lead}>Stan zawsze ma słowo; kolor go tylko wspiera.</p>
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
        <StatusBadge tone="success">Opublikowana</StatusBadge>
        <StatusBadge tone="warning">Czeka na akceptację</StatusBadge>
        <StatusBadge tone="danger">Odrzucona</StatusBadge>
        <StatusBadge tone="info">Kurator</StatusBadge>
        <StatusBadge tone="neutral">Szkic</StatusBadge>
      </div>
    </main>
  ),
};
