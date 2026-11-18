// The table of the folding cases (text, folded text) shared by the unit test of
// `foldSearchText` and the integration test that runs `foldSql` on the database:
// both must give the same answer (D-E12-3).
export const FOLD_CASES: readonly (readonly [string, string])[] = [
  ["ŁÓDŹ", "lodz"],
  ["Łódź", "lodz"],
  ["Wieża", "wieza"],
  ["WIEŻA", "wieza"],
  ["Żuławy", "zulawy"],
  ["ŻUŁAWY", "zulawy"],
  ["Gdańsk Śródmieście", "gdansk srodmiescie"],
  ["ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż", "acelnoszz acelnoszz"],
  ["Zamek w Gniewie", "zamek w gniewie"],
];
