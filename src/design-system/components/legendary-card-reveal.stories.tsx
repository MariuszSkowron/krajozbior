import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import foundation from "../foundation/foundation.module.css";
import {
  legendaryCategories,
  legendaryCategoryLabel,
  type LegendaryCardCategory,
} from "./legendary-card";
import { LegendaryCardReveal } from "./legendary-card-reveal";
import { withPhoto } from "./legendary-card.credits";
import { legendarySamples, photoNote, previewNote } from "./legendary-card.samples";

const meta = {
  title: "Krajozbiór Components/LegendaryCardReveal",
  component: LegendaryCardReveal,
  // Strona historii potrzebuje jednego głównego regionu i nagłówka h1 (axe); scena sama ma h2.
  decorators: [
    (Story) => (
      <main>
        <div className={foundation.page}>
          <h1>Scena odsłonięcia karty</h1>
          <p className={foundation.lead}>{previewNote}</p>
        </div>
        <Story />
      </main>
    ),
  ],
  parameters: {
    a11y: { test: "error" },
    docs: { description: { component: previewNote } },
  },
} satisfies Meta<typeof LegendaryCardReveal>;
export default meta;

type Story = StoryObj<typeof meta>;

const note = `${previewNote} ${photoNote}`;
const sample = withPhoto("culture_night");

// Przykładowe przyciski bez działania: ekran skrytki (E6-4) złoży własne.
const actions = (
  <>
    <button type="button" className="button button--primary">
      Zobacz w kolekcji
    </button>
    <button type="button" className="button button--quiet">
      Wróć do ekranu głównego
    </button>
  </>
);

async function reveal(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /Odsłoń kartę/ }));
}

export const Sealed: Story = {
  name: "Zakryta",
  args: { card: sample },
  parameters: { docs: { description: { story: note } } },
};

export const Revealing: Story = {
  name: "Odsłanianie (kliknięcie w zasłonę)",
  args: { card: sample, actions },
  parameters: { docs: { description: { story: note } } },
  play: async ({ canvasElement }) => reveal(canvasElement),
};

export const Revealed: Story = {
  name: "Odsłonięta",
  args: { card: sample, initialState: "revealed", actions },
  parameters: { docs: { description: { story: note } } },
};

export const ReducedMotion: Story = {
  name: "Bez animacji (ograniczony ruch)",
  args: { card: sample, motion: "reduce", actions },
  parameters: {
    docs: {
      description: {
        story: `${previewNote} Kliknięcie zasłony od razu pokazuje stan końcowy, bez ruchu.`,
      },
    },
  },
  play: async ({ canvasElement }) => reveal(canvasElement),
};

export const HighContrast: Story = {
  name: "Wysoki kontrast",
  args: { card: sample, initialState: "revealed", actions },
  parameters: {
    docs: {
      description: {
        story: `${previewNote} W narzędziach przeglądarki włącz emulację forced-colors: opalizacja znika, zostają obrys, symbol i tekst w kolorach systemowych.`,
      },
    },
  },
};

export const LightTheme: Story = {
  name: "W jasnym motywie (scena zostaje nocna)",
  args: { card: sample, actions },
  globals: { theme: "light" },
  parameters: { docs: { description: { story: note } } },
};

function categoryRevealed(category: LegendaryCardCategory): Story {
  return {
    name: `Odsłonięta: ${legendaryCategoryLabel(category)}`,
    args: { card: withPhoto(category), initialState: "revealed", actions },
    parameters: { docs: { description: { story: note } } },
  };
}

function categoryReveal(category: LegendaryCardCategory): Story {
  return {
    name: `Odsłonięcie z efektem: ${legendaryCategoryLabel(category)}`,
    args: { card: withPhoto(category) },
    parameters: {
      docs: {
        description: {
          story: `${previewNote} Kliknij zasłonę: gra jednorazowy efekt kategorii.`,
        },
      },
    },
  };
}

export const RevealedCultureNight = categoryRevealed("culture_night");
export const RevealedHeritage = categoryRevealed("heritage");
export const RevealedNationalHoliday = categoryRevealed("national_holiday");
export const RevealedNatureSky = categoryRevealed("nature_sky");
export const RevealedTrailCommunity = categoryRevealed("trail_community");
export const RevealedKrajozbior = categoryRevealed("krajozbior");

export const RevealCultureNight = categoryReveal("culture_night");
export const RevealHeritage = categoryReveal("heritage");
export const RevealNationalHoliday = categoryReveal("national_holiday");
export const RevealNatureSky = categoryReveal("nature_sky");
export const RevealTrailCommunity = categoryReveal("trail_community");
export const RevealKrajozbior = categoryReveal("krajozbior");

export const AllVeils: Story = {
  name: "Wszystkie zasłony (zakryte, z emblematem)",
  args: { card: sample },
  parameters: {
    docs: {
      description: {
        story: `${previewNote} Sześć zasłon obok siebie, każda z emblematem swojej kategorii.`,
      },
    },
  },
  render: () => (
    <div
      style={{
        display: "grid",
        gap: "var(--space-lg)",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(20rem, 100%), 1fr))",
        background: "var(--color-surface-canvas)",
      }}
    >
      {legendaryCategories.map((category) => (
        <LegendaryCardReveal key={category} card={legendarySamples[category]} />
      ))}
    </div>
  ),
};

export const AllCategories: Story = {
  name: "Wszystkie kategorie (odsłonięte obok siebie)",
  args: { card: sample },
  parameters: { docs: { description: { story: note } } },
  render: () => (
    <div
      style={{
        display: "grid",
        gap: "var(--space-lg)",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(20rem, 100%), 1fr))",
        background: "var(--color-surface-canvas)",
      }}
    >
      {legendaryCategories.map((category) => (
        <LegendaryCardReveal key={category} card={withPhoto(category)} initialState="revealed" />
      ))}
    </div>
  ),
};
