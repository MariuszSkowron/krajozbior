import type { Meta, StoryObj } from "@storybook/react-vite";

import { tokenVar, type TokenName } from "../tokens/tokens";
import styles from "./foundation.module.css";
import { TokenValue } from "./TokenValue";

const meta = { title: "Foundation/Elevation" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

const shadows: ReadonlyArray<TokenName> = ["shadow.card", "shadow.overlay"];

export const Shadows: Story = {
  name: "Cienie",
  render: () => (
    <main className={styles.page}>
      <h1>Elevation</h1>
      <p className={styles.lead}>
        Dwa poziomy: karta w układzie (miękki cień dwuwarstwowy, v1) oraz warstwa nakładana (np.
        dialog).
      </p>
      <div className={styles.elevationStage}>
        {shadows.map((name) => (
          <div key={name}>
            <div
              className={styles.box}
              style={{
                boxShadow: tokenVar(name),
                borderRadius: tokenVar("radius.md"),
                background: tokenVar(
                  name === "shadow.overlay" ? "color.surface.elevated" : "color.surface.card",
                ),
              }}
            >
              {name}
            </div>
            <TokenValue name={name} />
          </div>
        ))}
      </div>
    </main>
  ),
};
