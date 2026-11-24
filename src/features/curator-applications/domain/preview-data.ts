// Invented data of the preview of the curator panel (spec "Rola kuratora", DT-P7-4). It lives in
// code: the preview reads no database, so it cannot show a real draft or give any permission.
// The names cannot be mistaken for a real institution.

export type PreviewPlace = Readonly<{ name: string; address: string; note: string }>;

export type PreviewCollection = Readonly<{
  title: string;
  summary: string;
  status: "Szkic" | "Opublikowana";
  places: readonly PreviewPlace[];
}>;

export const PREVIEW_ORGANIZATION_NAME = "Gmina Przykładowo (przykład)";

export const PREVIEW_COLLECTIONS: readonly PreviewCollection[] = [
  {
    title: "Wieże ciśnień w okolicy (przykład)",
    summary: "Trzy wieże ciśnień z widokiem na okolicę. Wszystko wymyślone na potrzeby podglądu.",
    status: "Szkic",
    places: [
      {
        name: "Wieża Pierwsza (przykład)",
        address: "ul. Przykładowa 1, Przykładowo",
        note: "Ceglana wieża z początku XX wieku.",
      },
      {
        name: "Wieża Druga (przykład)",
        address: "ul. Wymyślona 2, Przykładowo",
        note: "Taras widokowy otwarty w weekendy.",
      },
      {
        name: "Wieża Trzecia (przykład)",
        address: "ul. Pokazowa 3, Przykładowo",
        note: "Najwyższa z trzech, widoczna z rynku.",
      },
    ],
  },
  {
    title: "Dawne młyny nad rzeką (przykład)",
    summary: "Druga kolekcja z przykładu, już opublikowana.",
    status: "Opublikowana",
    places: [
      {
        name: "Młyn Wodny (przykład)",
        address: "ul. Nadrzeczna 4, Przykładowo",
        note: "Koło wodne i mała wystawa.",
      },
    ],
  },
];
