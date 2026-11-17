import type { Meta, StoryObj } from "@storybook/react-vite";

import { tokenVar, type TokenName } from "../tokens/tokens";
import styles from "./foundation.module.css";
import { TokenValue } from "./TokenValue";

const meta = { title: "Foundation/Radii" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

const radii: ReadonlyArray<TokenName> = ["radius.sm", "radius.md", "radius.lg", "radius.pill"];

export const Scale: Story = {
  name: "Promienie",
  render: () => (
    <main className={styles.page}>
      <h1>Promienie</h1>
      <p className={styles.lead}>
        Wartości v1: kontrolki, małe elementy, karty i duże powierzchnie oraz pełne zaokrąglenie
        plakietek.
      </p>
      {radii.map((name) => (
        <div className={styles.row} key={name}>
          <div className={styles.rowLabel}>
            <span className={styles.name}>{name}</span>
            <br />
            <TokenValue name={name} />
          </div>
          <div className={styles.box} style={{ borderRadius: tokenVar(name) }}>
            {name}
          </div>
        </div>
      ))}
    </main>
  ),
};
