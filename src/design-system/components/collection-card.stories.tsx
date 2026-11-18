import type { Meta, StoryObj } from "@storybook/react-vite";

import styles from "../foundation/foundation.module.css";
import { CollectionCard } from "./collection-card";

const meta = { title: "Krajozbiór Components/CollectionCard" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

export const States: Story = {
  name: "Stany: z postępem, pusta, bez postępu",
  render: () => (
    <main className={styles.page}>
      <h1>CollectionCard</h1>
      <div
        style={{
          display: "grid",
          gap: "var(--space-md)",
          gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))",
        }}
      >
        <CollectionCard
          href="/collections/wieze"
          title="Wieże ciśnień Pomorza"
          regionLabel="Pomorskie"
          progress={{ visited: 9, total: 24 }}
        />
        <CollectionCard
          href="/collections/nowa"
          title="Nowa kolekcja"
          regionLabel="Mazowieckie"
          progress={{ visited: 0, total: 0 }}
        />
        <CollectionCard href="/collections/zamki" title="Zamki" regionLabel="Śląskie" />
      </div>
    </main>
  ),
};
