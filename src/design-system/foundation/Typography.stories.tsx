import type { Meta, StoryObj } from "@storybook/react-vite";

import { tokenVar, type TokenName } from "../tokens/tokens";
import styles from "./foundation.module.css";
import { TokenValue } from "./TokenValue";

const meta = { title: "Foundation/Typography" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

const sizes: ReadonlyArray<TokenName> = [
  "font.size.4xl",
  "font.size.3xl",
  "font.size.2xl",
  "font.size.xl",
  "font.size.lg",
  "font.size.md",
  "font.size.sm",
  "font.size.xs",
];

export const Scale: Story = {
  name: "Skala i krój",
  render: () => (
    <main className={styles.page}>
      <h1>Typografia</h1>
      <p className={styles.lead}>
        Trzy kroje z plików w repozytorium (<code>next/font/local</code>, bez zapytań do Google):
        Instrument Serif (tytuły, jedna waga 400), Geist (tekst, przyciski, formularze) i Geist Mono
        (etykiety wersalikami, daty, liczniki). Rozmiary w <code>rem</code>, więc szanują ustawienia
        użytkownika.
      </p>
      <section className={styles.group}>
        <h2>Krój</h2>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.name}>font.family.display</span>
            <br />
            <TokenValue name="font.family.display" />
          </div>
          <span
            style={{
              fontFamily: tokenVar("font.family.display"),
              fontSize: tokenVar("font.size.2xl"),
              fontWeight: tokenVar("font.weight.regular"),
              lineHeight: tokenVar("line.height.heading"),
            }}
          >
            Żółć, Gdańsk, Łódź <em>(kursywa)</em>
          </span>
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.name}>font.family.base</span>
            <br />
            <TokenValue name="font.family.base" />
          </div>
          <span>Zażółć gęślą jaźń — tekst główny krojem Geist.</span>
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.name}>font.family.mono</span>
            <br />
            <TokenValue name="font.family.mono" />
          </div>
          <span style={{ fontFamily: tokenVar("font.family.mono") }}>ŻÓŁĆ · 12,4 KM · 9/24</span>
        </div>
      </section>
      <section className={styles.group}>
        <h2>Nagłówki i etykieta (style bazowe)</h2>
        <p className="eyebrow">Kolej · etykieta wersalikami</p>
        <p
          style={{
            fontFamily: tokenVar("font.family.display"),
            fontSize: tokenVar("font.size.3xl"),
            fontWeight: tokenVar("font.weight.regular"),
            lineHeight: tokenVar("line.height.heading"),
            margin: 0,
          }}
        >
          Tytuł ekranu (h1): 40 px na telefonie, 52 px na komputerze
        </p>
        <p
          style={{
            fontFamily: tokenVar("font.family.base"),
            fontSize: tokenVar("font.size.lg"),
            fontWeight: tokenVar("font.weight.strong"),
            margin: 0,
          }}
        >
          Nagłówek sekcji (h2) na telefonie: Geist 600
        </p>
      </section>
      <section className={styles.group}>
        <h2>Rozmiary</h2>
        {sizes.map((name) => (
          <div className={styles.row} key={name}>
            <div className={styles.rowLabel}>
              <span className={styles.name}>{name}</span>
              <br />
              <TokenValue name={name} />
            </div>
            <span style={{ fontSize: tokenVar(name) }}>Krajozbiór: szkielet aplikacji</span>
          </div>
        ))}
      </section>
      <section className={styles.group}>
        <h2>Grubość i interlinia</h2>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.name}>font.weight.strong</span>
            <br />
            <TokenValue name="font.weight.strong" />
          </div>
          <strong>Tekst wyróżniony</strong>
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.name}>line.height.heading</span>
            <br />
            <TokenValue name="line.height.heading" />
          </div>
          <p style={{ lineHeight: tokenVar("line.height.heading"), margin: 0, maxWidth: "20rem" }}>
            Nagłówek zajmujący kilka linii pokazuje ciasną interlinię nagłówków.
          </p>
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.name}>line.height.body</span>
            <br />
            <TokenValue name="line.height.body" />
          </div>
          <p style={{ margin: 0, maxWidth: "20rem" }}>
            Tekst podstawowy zajmujący kilka linii pokazuje interlinię treści, wygodną w czytaniu na
            telefonie.
          </p>
        </div>
      </section>
    </main>
  ),
};
