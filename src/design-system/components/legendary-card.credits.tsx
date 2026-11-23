import type { ReactNode } from "react";

import type { LegendaryCardCategory, LegendaryCardContent } from "./legendary-card";
import { legendarySamples, samplePhotos } from "./legendary-card.samples";

// Przykładowe podpisy zdjęć do historii Storybooka (DT-E6-4a-13): ten sam format co `PhotoCredit`
// na stronie miejsca, z fikcyjnym autorem. W aplikacji (E6-4) podpis złoży ekran.
export const longCredit = (
  <>
    Zdjęcie: Obraz przykładowy. Autor: Fikcyjny Autor Testowy. Licencja:{" "}
    <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.pl">CC BY-SA 4.0</a>. Zdjęcie
    zmniejszone i skompresowane, zapisane w formacie WebP. Ta kopia jest dostępna na licencji CC
    BY-SA 4.0.
  </>
);

export const shortCredit = <>Zdjęcie: autor Fikcyjny Autor Testowy. Status: domena publiczna.</>;

/** Dane przykładowe kategorii z obrazem zastępczym o wskazanych proporcjach i podpisem. */
export function withPhoto(
  category: LegendaryCardCategory,
  ratio: keyof typeof samplePhotos = "3x2",
  credit: ReactNode = longCredit,
): LegendaryCardContent {
  return { ...legendarySamples[category], photo: samplePhotos[ratio], photoCredit: credit };
}
