// Pula zdjęć banera strony głównej dla gościa (R3, D-57, PR 4): stała lista wybranych miejsc.
// Przy każdym wejściu serwer losuje jedno miejsce z puli, które ma dziś dostępne zdjęcie.
//
// Lista zaakceptowana przez właściciela 2026-11-24 (spec R3, Q1; 13 miejsc z kadrami na telefon v2).
// Zmiana listy to mała zmiana w tym pliku (B-01); nie zmieniaj jej poza tym plikiem.
//
// Reguły dla każdego miejsca na liście:
//  - B-02: tylko fotografie (nie ryciny); szerokość pliku `main` (po obróbce, najwyżej 1600 px)
//    co najmniej 1100 px; kontrast tekstu na zdjęciu co najmniej 4,5:1 (pomiar na 1440 i 390 px);
//  - B-05: zdjęcie nie szersze niż 16:9 (odrzuca panoramy); zapytanie wymusza to w SQL;
//  - B-03/B-04: bez Zamku Drahim w Starym Drawsku (Q9386514), Filtrów Lindleya (Q642455)
//    i Zamku w Moryniu (Q9386686).
//
// Miejsce wskazuje QID z Wikidanych (`place_sources.wikidata_qid`), nie identyfikator miejsca:
// UUID różni się między bazą lokalną, pokazową i serwerem, a QID z importu jest wszędzie ten sam.
// Miejsce bez gotowego zdjęcia, spoza opublikowanej kolekcji albo nieznalezione po QID po prostu
// odpada z losowania; gdy odpadną wszystkie, baner pokazuje stałe zdjęcie (okładkę pierwszej
// kolekcji).
//
// `focus` to `object-position` kadru: `wide` na laptopie i szerszych ekranach, `narrow` na
// telefonie (kadry z makiety R3 i ze zrzutów podglądu puli).
//
// Ryzyka z podglądu puli:
//  - Pęzino (Q15641193): najmniejszy plik puli (1613 px na Commons), kontrast niezmierzony na
//    zdjęciu z Commons (limit serwera); pierwsza kandydatka do wymiany;
//  - Swobnica (Q33254678): na telefonie kadr to wieża i chmury; ruina jest pod tekstem, bo
//    baner na telefonie przycina zdjęcie tylko poziomo (kandydat do usunięcia, pula ma 12).
//  - Na telefonie (baner 640 px wysokości) zdjęcie jest skalowane do wysokości, więc działa tylko
//    pierwsza liczba `narrow` (poziom); druga zostaje 50%.

export type HomeBannerFocus = Readonly<{
  /** `object-position` na laptopie i szerszych ekranach. */
  wide: string;
  /** `object-position` na telefonie. */
  narrow: string;
}>;

export type HomeBannerPoolEntry = Readonly<{
  /** Element Wikidanych miejsca, np. `Q442169`. */
  qid: string;
  focus: HomeBannerFocus;
}>;

export const HOME_BANNER_POOL: readonly HomeBannerPoolEntry[] = [
  // Zamek Książąt Pomorskich w Szczecinie (p1)
  { qid: "Q442169", focus: { wide: "50% 40%", narrow: "45% 50%" } },
  // Zamek w Pęzinie (p2); ryzyko: najmniejszy plik puli
  { qid: "Q15641193", focus: { wide: "50% 38%", narrow: "62% 50%" } },
  // Stary zamek w Płotach (p4)
  { qid: "Q86668541", focus: { wide: "50% 30%", narrow: "45% 50%" } },
  // Zamek w Świdwinie (p5)
  { qid: "Q9386773", focus: { wide: "50% 35%", narrow: "32% 50%" } },
  // Zamek templariuszy (joannitów) w Swobnicy (p9); na telefonie widać wieżę i chmury, ruina jest pod tekstem
  { qid: "Q33254678", focus: { wide: "50% 40%", narrow: "3% 50%" } },
  // Zamek w Krągu (p11)
  { qid: "Q16619003", focus: { wide: "50% 40%", narrow: "55% 50%" } },
  // Zamek Książąt Pomorskich w Darłowie (p12)
  { qid: "Q2243270", focus: { wide: "50% 40%", narrow: "38% 50%" } },
  // Rezerwat przyrody Kadzielnia w Kielcach
  { qid: "Q9308632", focus: { wide: "50% 50%", narrow: "50% 50%" } },
  // Zabytkowa Kopalnia „Ignacy” w Rybniku
  { qid: "Q9385507", focus: { wide: "50% 50%", narrow: "100% 50%" } },
  // Zamek biskupów warmińskich w Lidzbarku Warmińskim
  { qid: "Q5420724", focus: { wide: "50% 50%", narrow: "66% 50%" } },
  // Monaster w Supraślu
  { qid: "Q2987314", focus: { wide: "50% 50%", narrow: "30% 50%" } },
  // Zamek w Kórniku
  { qid: "Q524338", focus: { wide: "50% 45%", narrow: "55% 50%" } },
  // Sobór Świętej Trójcy w Hajnówce
  { qid: "Q1138724", focus: { wide: "50% 40%", narrow: "62% 50%" } },
];
