// Znaczniki robocze w tekstach prawnych (K-12): `[DO UZUPEŁNIENIA: …]` i `[PRAWNIK: …]`.
// Żaden nie może być widoczny dla publiczności. Ten sam skaner służy dwóm bramkom:
// test jednostkowy porównuje wynik z jawną listą otwartych pozycji (CI zielone, lista może
// się tylko kurczyć), a polecenie `npm run legal:final` odmawia przy jakimkolwiek znaczniku
// przed zdjęciem hasła z serwisu (spec 5.4a, docs/deployment.md).
const MARKER = /\[(?:DO UZUPEŁNIENIA|PRAWNIK)[^\]]*\]/g;

/** Każdy znacznik jako „slug: [znacznik]”, w kolejności dokumentów i wystąpień. */
export function findLegalMarkers(
  documents: readonly Readonly<{ slug: string; markdown: string }>[],
): string[] {
  return documents.flatMap((document) =>
    [...document.markdown.matchAll(MARKER)].map(([marker]) => `${document.slug}: ${marker}`),
  );
}
