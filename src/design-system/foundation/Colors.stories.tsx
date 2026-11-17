import type { Meta, StoryObj } from "@storybook/react-vite";

import { tokenNames, tokenVar, type TokenName } from "../tokens/tokens";
import styles from "./foundation.module.css";
import { TokenValue, tokenCssName } from "./TokenValue";

const meta = { title: "Foundation/Colors" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

const colorTokens = (prefix: string) =>
  tokenNames.filter((name): name is TokenName => name.startsWith(prefix));

function Group({ title, prefix }: Readonly<{ title: string; prefix: string }>) {
  return (
    <section className={styles.group}>
      <h2>{title}</h2>
      <ul className={styles.grid}>
        {colorTokens(prefix).map((name) => (
          <li className={styles.tile} key={name}>
            <div className={styles.swatch} style={{ background: tokenVar(name) }} />
            <span className={styles.name}>{name}</span>
            <code className={styles.value}>{tokenCssName(name)}</code>
            <TokenValue name={name} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export const Semantic: Story = {
  render: () => (
    <main className={styles.page}>
      <h1>Kolory semantyczne</h1>
      <p className={styles.lead}>
        Komponenty używają wyłącznie tokenów semantycznych z <code>tokens.css</code>, nigdy surowych
        wartości. Dostępny jest tylko theme jasny.
      </p>
      <Group title="Marka" prefix="color.brand" />
      <Group title="Powierzchnie" prefix="color.surface" />
      <Group title="Tekst" prefix="color.text" />
      <Group title="Obramowania" prefix="color.border" />
      <Group title="Błędy" prefix="color.feedback" />
    </main>
  ),
};

export const TextOnSurfaces: Story = {
  name: "Tekst na powierzchniach",
  render: () => (
    <main className={styles.page}>
      <h1>Tekst na powierzchniach</h1>
      <p className={styles.lead}>
        Zestawienia używane w aplikacji (kontrasty pilnuje test tokenów).
      </p>
      <ul className={styles.grid}>
        {[
          ["color.text.primary", "color.surface.canvas"],
          ["color.text.primary", "color.surface.card"],
          ["color.text.secondary", "color.surface.card"],
          ["color.text.inverse", "color.brand.primary"],
          ["color.feedback.danger", "color.surface.canvas"],
          ["color.feedback.danger", "color.surface.card"],
        ].map(([fg, bg]) => (
          <li
            className={styles.swatch}
            key={`${fg}-${bg}`}
            style={{ color: tokenVar(fg as TokenName), background: tokenVar(bg as TokenName) }}
          >
            {fg.replace("color.", "")} / {bg.replace("color.", "")}
          </li>
        ))}
      </ul>
    </main>
  ),
};
