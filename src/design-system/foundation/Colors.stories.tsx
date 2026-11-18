import type { Meta, StoryObj } from "@storybook/react-vite";

import { tokenNames, tokenVar, type TokenName } from "../tokens/tokens";
import { ContrastPair } from "./ContrastPair";
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
        wartości. Motyw nocny i jasny przełączasz w pasku narzędzi („Motyw”): te same nazwy, inne
        wartości.
      </p>
      <Group title="Marka" prefix="color.brand" />
      <Group title="Powierzchnie" prefix="color.surface" />
      <Group title="Tekst" prefix="color.text" />
      <Group title="Obramowania" prefix="color.border" />
      <Group title="Postęp" prefix="color.progress" />
      <Group title="Stany" prefix="color.feedback" />
    </main>
  ),
};

// Pary dozwolone (tekst ≥ 4,5:1, element nietekstowy ≥ 3:1) w obu motywach; reguła tła: akcent
// tekstem tylko na canvas i card (accessibility.md).
const textPairs: ReadonlyArray<readonly [TokenName, TokenName]> = [
  ["color.text.primary", "color.surface.canvas"],
  ["color.text.primary", "color.surface.card"],
  ["color.text.strong", "color.surface.canvas"],
  ["color.text.secondary", "color.surface.card"],
  ["color.text.label", "color.surface.card"],
  ["color.text.meta", "color.surface.canvas"],
  ["color.text.accent", "color.surface.canvas"],
  ["color.text.accent", "color.surface.card"],
  ["color.text.on-accent", "color.brand.accent"],
  ["color.feedback.success", "color.surface.card"],
  ["color.feedback.warning", "color.surface.card"],
  ["color.feedback.danger", "color.surface.card"],
  ["color.feedback.info", "color.surface.card"],
];

export const TextOnSurfaces: Story = {
  name: "Tekst na powierzchniach (kontrast)",
  render: () => (
    <main className={styles.page}>
      <h1>Tekst na powierzchniach</h1>
      <p className={styles.lead}>
        Zestawienia używane w aplikacji z kontrastem policzonym w bieżącym motywie (wzór WCAG 2.x).
        Wymagane 4,5:1.
      </p>
      <ul className={styles.grid}>
        {textPairs.map(([fg, bg]) => (
          <ContrastPair key={`${fg}-${bg}`} foreground={fg} background={bg} minimum={4.5} />
        ))}
      </ul>
    </main>
  ),
};
