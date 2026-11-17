import type { Meta, StoryObj } from "@storybook/react-vite";

import styles from "./foundation.module.css";
import { TokenValue } from "./TokenValue";

const meta = { title: "Foundation/Focus" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

export const Treatment: Story = {
  name: "Wskaźnik fokusu",
  render: () => (
    <main className={styles.page}>
      <h1>Fokus</h1>
      <p className={styles.lead}>
        Globalna reguła <code>:focus-visible</code> z <code>theme.css</code>. Naciśnij Tab, aby
        zobaczyć wskaźnik na kolejnych elementach.
      </p>
      <section className={styles.group}>
        <h2>Tokeny</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>color.border.focus</span>
          <TokenValue name="color.border.focus" />
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>focus.ring.width</span>
          <TokenValue name="focus.ring.width" />
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>focus.ring.offset</span>
          <TokenValue name="focus.ring.offset" />
        </div>
      </section>
      <section className={styles.group}>
        <h2>Elementy interaktywne</h2>
        <p
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-md)",
            alignItems: "center",
          }}
        >
          <button className={styles.focusTarget} type="button">
            Przycisk
          </button>
          <a href="#fokus">Link</a>
          <input className={styles.focusTarget} aria-label="Pole tekstowe" defaultValue="Pole" />
        </p>
      </section>
    </main>
  ),
};
