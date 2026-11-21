// Twarda bramka tekstów prawnych (K-12, spec 5.4a): kończy się błędem (kod 1), jeśli
// którykolwiek tekst prawny ma jeszcze znacznik roboczy `[DO UZUPEŁNIENIA: …]` albo
// `[PRAWNIK: …]`. Uruchamia się ją przed zdjęciem hasła z serwisu (docs/deployment.md);
// nie blokuje budowy ani CI, które pilnuje tylko listy otwartych pozycji
// (tests/features/legal/legal-content.test.ts).
//
// Run with:
//   npm run legal:final
import { LEGAL_DOCUMENTS } from "../src/features/legal/content";
import { findLegalMarkers } from "../src/features/legal/domain/markers";

const markers = findLegalMarkers(Object.values(LEGAL_DOCUMENTS));

if (markers.length > 0) {
  console.error(
    `Teksty prawne mają niewypełnione znaczniki (liczba: ${markers.length}); serwisu nie wolno jeszcze otworzyć:`,
  );
  for (const marker of markers) {
    console.error(`- ${marker}`);
  }
  process.exitCode = 1;
} else {
  console.log("Teksty prawne nie mają znaczników roboczych.");
}
