import type { Meta, StoryObj } from "@storybook/react-vite";

import styles from "../foundation/foundation.module.css";
import { BookmarkIcon, CardsIcon, HomeIcon, PinIcon, ProfileIcon } from "./icons";

const meta = { title: "Foundation/Ikony" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

const icons = [
  ["Start", HomeIcon],
  ["Moje kolekcje", CardsIcon],
  ["Chcę zobaczyć", BookmarkIcon],
  ["Konto", ProfileIcon],
  ["Miejsce", PinIcon],
] as const;

export const Set: Story = {
  name: "Zestaw",
  render: () => (
    <main className={styles.page}>
      <h1>Ikony</h1>
      <p className={styles.lead}>Dekoracja: znaczenie niesie napis obok (aria-hidden).</p>
      <ul
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-lg)",
          margin: 0,
          padding: 0,
          listStyle: "none",
        }}
      >
        {icons.map(([name, Component]) => (
          <li
            key={name}
            style={{ display: "grid", justifyItems: "center", gap: "var(--space-sm)" }}
          >
            <Component size={32} />
            <span>{name}</span>
          </li>
        ))}
      </ul>
    </main>
  ),
};
