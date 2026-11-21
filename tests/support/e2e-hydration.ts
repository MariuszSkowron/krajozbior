import type { Page } from "@playwright/test";

// Czeka, aż React zahaczy się w strukturze strony (hydratacja), czyli aż przyciski i formularze
// zaczną reagować. Zastępuje `waitForLoadState("networkidle")`, które zależy od ruchu w sieci
// (kafelki mapy, prefetch Next.js) i przy obciążeniu przekracza limit czasu bez żadnej usterki.
// React zapisuje w węzłach DOM klucz `__reactFiber$…` dopiero podczas hydratacji, więc jego
// obecność w `<main>` jest wprost sygnałem „strona jest interaktywna”.
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.querySelector("main") ?? document.body;
    return Object.keys(root).some((key) => key.startsWith("__reactFiber$"));
  });
}
