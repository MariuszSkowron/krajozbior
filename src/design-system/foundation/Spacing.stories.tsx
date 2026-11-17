import type { Meta, StoryObj } from "@storybook/react-vite";

import { tokenVar, type TokenName } from "../tokens/tokens";
import styles from "./foundation.module.css";
import { TokenValue } from "./TokenValue";

const meta = { title: "Foundation/Spacing" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

const spaces: ReadonlyArray<TokenName> = [
  "space.xs",
  "space.sm",
  "space.md",
  "space.lg",
  "space.xl",
];

export const Scale: Story = {
  name: "Skala odstępów",
  render: () => (
    <main className={styles.page}>
      <h1>Odstępy</h1>
      <p className={styles.lead}>Moduł 4 px. Pasek ma szerokość równą tokenowi.</p>
      {spaces.map((name) => (
        <div className={styles.row} key={name}>
          <div className={styles.rowLabel}>
            <span className={styles.name}>{name}</span>
            <br />
            <TokenValue name={name} />
          </div>
          <div
            className={styles.bar}
            style={{ width: tokenVar(name) }}
            role="img"
            aria-label={`Szerokość ${name}`}
          />
        </div>
      ))}
      <section className={styles.group}>
        <h2>Cele dotykowe</h2>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.name}>size.touch.min</span>
            <br />
            <TokenValue name="size.touch.min" />
          </div>
          <div className={styles.touchDemo} role="img" aria-label="Minimalny cel dotykowy" />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.name}>size.touch.primary</span>
            <br />
            <TokenValue name="size.touch.primary" />
          </div>
          <div
            className={styles.touchDemoPrimary}
            role="img"
            aria-label="Cel dotykowy głównej akcji"
          />
        </div>
      </section>
    </main>
  ),
};
