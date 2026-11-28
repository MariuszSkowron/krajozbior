import type { Meta, StoryObj } from "@storybook/react-vite";

import styles from "../foundation/foundation.module.css";
import { CollectionCard } from "./collection-card";

const meta = { title: "Krajozbiór Components/CollectionCard" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

export const LongRegions: Story = {
  name: "Cztery długie województwa na wąskiej karcie",
  render: () => (
    <main className={styles.page}>
      <h1>CollectionCard: długie nazwy województw</h1>
      <div style={{ width: "240px" }}>
        <CollectionCard
          href="/collections/szlak"
          title="Szlak czterech województw"
          regionLabel="Kujawsko-pomorskie · Warmińsko-mazurskie · Zachodniopomorskie · Świętokrzyskie"
          note="12 miejsc · Gmina A"
        />
      </div>
    </main>
  ),
};

export const States: Story = {
  name: "Stany: z postępem, pusta, bez postępu, z okładką",
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
        <CollectionCard
          href="/collections/zamki"
          title="Zamki"
          regionLabel="Śląskie"
          note="13 miejsc · Gmina A"
        />
        <CollectionCard
          href="/collections/karpaty"
          title="Karpaty na granicy województw"
          regionLabel="Małopolskie · Podkarpackie · Śląskie · Świętokrzyskie"
          note="8 miejsc · Gmina A"
        />
        <CollectionCard
          href="/collections/mosty"
          title="Mosty nad Wisłą"
          regionLabel="Pomorskie"
          cover={{
            src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='267'%3E%3Crect width='400' height='267' fill='%23607a8c'/%3E%3C/svg%3E",
            width: 400,
            height: 267,
            alt: "Most nad rzeką",
          }}
        />
      </div>
    </main>
  ),
};
