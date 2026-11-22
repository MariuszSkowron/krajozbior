import type { Meta, StoryObj } from "@storybook/react-vite";

import styles from "../foundation/foundation.module.css";
import {
  LegendaryCard,
  legendaryCategories,
  legendaryCategoryLabel,
  type LegendaryCardCategory,
} from "./legendary-card";
import { legendarySamples, previewNote } from "./legendary-card.samples";

const meta = {
  title: "Krajozbiór Components/LegendaryCard",
  parameters: {
    a11y: { test: "error" },
    docs: { description: { component: previewNote } },
  },
} satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

// Karta stoi w stanie końcowym (odsłonięta, efekty w spoczynku); ruch pokazuje scena odsłonięcia.
function Page({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <main
      className={`theme-dark ${styles.page}`}
      style={{ background: "var(--color-surface-canvas)" }}
    >
      <h1>{title}</h1>
      <p className={styles.lead}>{previewNote}</p>
      {children}
    </main>
  );
}

export const Default: Story = {
  name: "Domyślna (Krajozbiór)",
  parameters: { docs: { description: { story: previewNote } } },
  render: () => (
    <Page title="LegendaryCard">
      <LegendaryCard {...legendarySamples.krajozbior} headingLevel={2} />
    </Page>
  ),
};

export const LongNames: Story = {
  name: "Długie nazwy na 320 px",
  globals: { viewport: { value: "mobileSmall", isRotated: false } },
  parameters: { docs: { description: { story: previewNote } } },
  render: () => (
    <Page title="Długie nazwy">
      <LegendaryCard
        category="heritage"
        eventName="Europejskie Dni Dziedzictwa w Miastach i Miasteczkach Dolnego Powiśla"
        collectionTitle="Zabytki architektury przemysłowej i techniki wodnej Dolnego Powiśla"
        placeName="Wieża ciśnień przy Zakładach Wodociągowych w Kwidzynie"
        dateLabel="13.09.2026, 11:00"
        headingLevel={2}
      />
    </Page>
  ),
};

function categoryStory(category: LegendaryCardCategory): Story {
  const label = legendaryCategoryLabel(category);
  return {
    name: `Odsłonięta: ${label}`,
    parameters: { docs: { description: { story: previewNote } } },
    render: () => (
      <Page title={`Kategoria: ${label}`}>
        <LegendaryCard {...legendarySamples[category]} headingLevel={2} />
      </Page>
    ),
  };
}

export const CultureNight = categoryStory("culture_night");
export const Heritage = categoryStory("heritage");
export const NationalHoliday = categoryStory("national_holiday");
export const NatureSky = categoryStory("nature_sky");
export const TrailCommunity = categoryStory("trail_community");
export const Krajozbior = categoryStory("krajozbior");

export const AllCategories: Story = {
  name: "Wszystkie kategorie",
  parameters: { docs: { description: { story: previewNote } } },
  render: () => (
    <Page title="Wszystkie kategorie">
      <ul
        style={{
          display: "grid",
          gap: "var(--space-lg)",
          gridTemplateColumns: "repeat(auto-fill, minmax(min(16rem, 100%), 1fr))",
          justifyItems: "center",
          margin: 0,
          padding: 0,
          listStyle: "none",
        }}
      >
        {legendaryCategories.map((category) => (
          <li
            key={category}
            style={{ inlineSize: "100%", display: "flex", justifyContent: "center" }}
          >
            <LegendaryCard {...legendarySamples[category]} headingLevel={2} />
          </li>
        ))}
      </ul>
    </Page>
  ),
};
