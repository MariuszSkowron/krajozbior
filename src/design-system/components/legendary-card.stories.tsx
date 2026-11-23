import type { Meta, StoryObj } from "@storybook/react-vite";

import styles from "../foundation/foundation.module.css";
import {
  LegendaryCard,
  legendaryCategories,
  legendaryCategoryLabel,
  type LegendaryCardCategory,
} from "./legendary-card";
import { longCredit, shortCredit, withPhoto } from "./legendary-card.credits";
import {
  brokenPhoto,
  legendarySamples,
  photoNote,
  previewNote,
  samplePhotos,
} from "./legendary-card.samples";

const meta = {
  title: "Krajozbiór Components/LegendaryCard",
  parameters: {
    a11y: { test: "error" },
    docs: { description: { component: previewNote } },
  },
} satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

const note = `${previewNote} ${photoNote}`;

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
  name: "Domyślna (Krajozbiór, ze zdjęciem)",
  parameters: { docs: { description: { story: note } } },
  render: () => (
    <Page title="Karta legendarna">
      <LegendaryCard {...withPhoto("krajozbior")} headingLevel={2} />
    </Page>
  ),
};

function ratioStory(ratio: "3x2" | "2x3" | "1x1" | "3x1", name: string): Story {
  return {
    name,
    parameters: {
      docs: {
        description: {
          story: `${note} Zdjęcie leży w oknie w całości, z tłem passe-partout zamiast przycięcia.`,
        },
      },
    },
    render: () => (
      <Page title={name}>
        <LegendaryCard
          {...withPhoto("culture_night", ratio, ratio === "1x1" ? shortCredit : longCredit)}
          headingLevel={2}
        />
      </Page>
    ),
  };
}

export const Photo3x2 = ratioStory("3x2", "Ze zdjęciem 3:2");
export const Photo2x3 = ratioStory("2x3", "Ze zdjęciem 2:3");
export const Photo1x1 = ratioStory("1x1", "Ze zdjęciem 1:1");
export const Photo3x1 = ratioStory("3x1", "Ze zdjęciem 3:1 (panorama)");

export const LongNames: Story = {
  name: "Długie nazwy na 320 px (zdjęcie 2:3, pełny podpis)",
  globals: { viewport: { value: "mobileSmall", isRotated: false } },
  parameters: { docs: { description: { story: note } } },
  render: () => (
    <Page title="Długie nazwy">
      <LegendaryCard
        category="heritage"
        eventName="Europejskie Dni Dziedzictwa w Miastach i Miasteczkach Dolnego Powiśla"
        collectionTitle="Zabytki architektury przemysłowej i techniki wodnej Dolnego Powiśla"
        placeName="Wieża ciśnień przy Zakładach Wodociągowych w Kwidzynie"
        dateLabel="13.9.2026, 11:00"
        headingLevel={2}
        photo={samplePhotos["2x3"]}
        photoCredit={longCredit}
      />
    </Page>
  ),
};

export const WithoutPhoto: Story = {
  name: "Bez zdjęcia (Noc kultury i Święto narodowe)",
  parameters: {
    docs: {
      description: {
        story: `${previewNote} W oknie stoi emblemat kategorii na tle passe-partout.`,
      },
    },
  },
  render: () => (
    <Page title="Karta bez zdjęcia">
      <div style={{ display: "grid", gap: "var(--space-lg)", justifyItems: "center" }}>
        <LegendaryCard {...legendarySamples.culture_night} headingLevel={2} />
        <LegendaryCard {...legendarySamples.national_holiday} headingLevel={2} />
      </div>
    </Page>
  ),
};

export const PhotoFails: Story = {
  name: "Zdjęcie nie ładuje się",
  parameters: {
    docs: {
      description: {
        story: `${previewNote} Adres zdjęcia jest zepsuty: karta wygląda jak bez zdjęcia, bez podpisu zdjęcia.`,
      },
    },
  },
  render: () => (
    <Page title="Zdjęcie nie ładuje się">
      <LegendaryCard
        {...legendarySamples.heritage}
        photo={brokenPhoto}
        photoCredit={longCredit}
        headingLevel={2}
      />
    </Page>
  ),
};

function categoryStory(category: LegendaryCardCategory): Story {
  const label = legendaryCategoryLabel(category);
  return {
    name: `Odsłonięta: ${label}`,
    parameters: { docs: { description: { story: note } } },
    render: () => (
      <Page title={`Kategoria: ${label}`}>
        <LegendaryCard {...withPhoto(category)} headingLevel={2} />
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

function allCategories(withPhotos: boolean): Story {
  return {
    name: withPhotos ? "Wszystkie kategorie — ze zdjęciami" : "Wszystkie kategorie — bez zdjęć",
    parameters: { docs: { description: { story: note } } },
    render: () => (
      <Page title={withPhotos ? "Wszystkie kategorie, ze zdjęciami" : "Wszystkie kategorie"}>
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
              <LegendaryCard
                {...(withPhotos
                  ? withPhoto(category, "3x2", shortCredit)
                  : legendarySamples[category])}
                headingLevel={2}
              />
            </li>
          ))}
        </ul>
      </Page>
    ),
  };
}

export const AllCategoriesWithPhotos = allCategories(true);
export const AllCategories = allCategories(false);
