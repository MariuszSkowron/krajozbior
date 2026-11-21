// @ts-check
// Stałe obróbki zdjęć (E4-S7, D-E4-5, 5.3). Moduł bez importów: domena i trasy mogą go
// czytać bez ładowania biblioteki natywnej `sharp` (uwaga A-S1).

/** Twardy budżet pliku głównego, w bajtach (300 KB). */
export const MAX_MAIN_BYTES = 300 * 1024;
/** Dłuższy bok pliku głównego na starcie, w pikselach (bez powiększania). */
export const MAIN_LONG_SIDE = 1600;
/** Najmniejszy dłuższy bok, do którego strategia zmniejsza zdjęcie. */
export const MIN_LONG_SIDE = 1000;
/** Początkowa jakość WebP. */
export const START_QUALITY = 80;
/** Jakość, od której zaczyna się druga runda po zmniejszeniu boku. */
export const RESHRINK_QUALITY = 70;
/** Dolna granica jakości WebP. */
export const MIN_QUALITY = 45;
/** Krok zmiany jakości. */
export const QUALITY_STEP = 5;
/** Współczynnik zmniejszania dłuższego boku na krok (o 15%). */
export const SHRINK_FACTOR = 0.85;
/** Szerokość miniatury `w400`. */
export const THUMB_WIDTH = 400;
/** Jakość miniatury WebP. */
export const THUMB_QUALITY = 70;
/** Dłuższy bok JPEG do `og:image`. */
export const OG_LONG_SIDE = 1200;
/** Budżet JPEG do `og:image`, w bajtach (200 KB). */
export const MAX_OG_BYTES = 200 * 1024;
/** Najmniejszy krótszy bok zdjęcia wgrywanego przez użytkownika. */
export const MIN_SHORT_SIDE = 600;
/** Limit pikseli wejścia (ochrona przed bombą dekompresyjną). */
export const MAX_INPUT_PIXELS = 50_000_000;
/** Limit czasu procesu potomnego, w milisekundach. */
export const PROCESS_TIMEOUT_MS = 20_000;
/** Limit wielkości wejścia: 20 MB (R-03) plus zapas 64 KB na formularz. */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024 + 64 * 1024;
