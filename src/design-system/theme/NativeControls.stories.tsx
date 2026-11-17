import type { Meta, StoryObj } from "@storybook/react-vite";

import styles from "../foundation/foundation.module.css";

/*
 * Primitives szkieletu to natywny HTML (zob. docs/design/ui-foundation.md), więc nie ma osobnej
 * warstwy w kodzie; story leży przy `theme.css`. Pokazuje, co kontrolki natywne dziedziczą
 * z theme (krój, kolor tekstu, fokus) bez żadnych klas.
 */
const meta = { title: "Primitives/Natywne kontrolki z theme" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

export const Unstyled: Story = {
  name: "Dziedziczenie theme",
  render: () => (
    <main className={styles.page}>
      <h1>Natywne kontrolki</h1>
      <p className={styles.lead}>
        Elementy bez klas i bez stylów własnych: pokazują stan bazowy theme. Stylowanie tokenami
        pojawi się razem z pierwszym komponentem.
      </p>
      <form style={{ display: "grid", gap: "var(--space-md)", maxWidth: "24rem" }}>
        <label htmlFor="n-text">Nazwa</label>
        <input id="n-text" type="text" defaultValue="Młyn wodny" />
        <label htmlFor="n-select">Kategoria</label>
        <select id="n-select" defaultValue="technika">
          <option value="historia">Historia</option>
          <option value="technika">Technika</option>
          <option value="przyroda">Przyroda</option>
        </select>
        <label htmlFor="n-area">Opis</label>
        <textarea id="n-area" rows={3} defaultValue="Krótki opis." />
        <fieldset>
          <legend>Widoczność</legend>
          <label>
            <input type="radio" name="vis" defaultChecked /> Prywatne
          </label>
          <label>
            <input type="radio" name="vis" /> Publiczne
          </label>
        </fieldset>
        <label>
          <input type="checkbox" /> Powiadom mnie o odpowiedzi
        </label>
        <label htmlFor="n-progress">Odkryte: 3 z 10</label>
        <progress id="n-progress" max={10} value={3} />
        <button type="button">Zapisz</button>
      </form>
    </main>
  ),
};
