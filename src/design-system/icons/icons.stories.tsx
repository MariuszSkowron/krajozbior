import type { Meta, StoryObj } from "@storybook/react-vite";

import styles from "../foundation/foundation.module.css";
import {
  BookmarkIcon,
  CardsIcon,
  ColumnCapitalIcon,
  CompassRoseIcon,
  HomeIcon,
  LeafIcon,
  MoonStarIcon,
  NewsIcon,
  PinIcon,
  ProfileIcon,
  RosetteIcon,
  SignetIcon,
} from "./icons";

const meta = { title: "Foundation/Ikony" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

const icons = [
  ["Start", HomeIcon],
  ["Moje kolekcje", CardsIcon],
  ["Chcę zobaczyć", BookmarkIcon],
  ["Profil", ProfileIcon],
  ["Aktualności", NewsIcon],
  ["Miejsce", PinIcon],
  ["Noc kultury", MoonStarIcon],
  ["Dziedzictwo", ColumnCapitalIcon],
  ["Święto narodowe", RosetteIcon],
  ["Przyroda i niebo", LeafIcon],
  ["Szlak i wspólnota", CompassRoseIcon],
  ["Krajozbiór", SignetIcon],
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
