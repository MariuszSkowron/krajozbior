import type { Metadata } from "next";

import styles from "./zrodla.module.css";

// Strona „Źródła danych” (spec kolekcji właściciela, 5.7): publiczna, bez logowania. Mówi, skąd
// pochodzą dane o miejscach, na jakich licencjach i że wydawcy danych nie odpowiadają za
// aplikację. Opis dotyczy rodzajów źródeł; podpis konkretnego miejsca stoi na jego stronie.
export const metadata: Metadata = {
  title: "Źródła danych — Krajozbiór",
};

// Miesiąc pobrania danych ze źródeł. Aktualizuj tę stałą przy każdym wgraniu nowych danych
// (np. nowej kolekcji z pliku); to jedyne miejsce, z którego strona bierze tę informację.
const DATA_RETRIEVED = "listopad 2026";

type Source = Readonly<{
  id: string;
  name: string;
  used: string;
  license: string;
  licenseUrl: string;
  homeUrl: string;
  homeLabel: string;
}>;

const SOURCES: readonly Source[] = [
  {
    id: "nid",
    name: "Narodowy Instytut Dziedzictwa — rejestr zabytków",
    used: "Dane o obiektach wpisanych do rejestru zabytków (np. nazwa, rodzaj, lokalizacja).",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    homeUrl: "https://dane.gov.pl/pl/dataset/1130",
    homeLabel: "Zbiór danych na dane.gov.pl",
  },
  {
    id: "wikidata",
    name: "Wikidane",
    used: "Fakty o miejscach w postaci uporządkowanych danych (np. daty, styl, położenie).",
    license: "CC0 1.0 (domena publiczna)",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    homeUrl: "https://www.wikidata.org/",
    homeLabel: "wikidata.org",
  },
  {
    id: "osm",
    name: "OpenStreetMap",
    used: "Mapa na stronie kolekcji (po wybraniu widoku „Mapa”).",
    license: "ODbL 1.0 — © autorzy OpenStreetMap",
    licenseUrl: "https://www.openstreetmap.org/copyright",
    homeUrl: "https://www.openstreetmap.org/",
    homeLabel: "openstreetmap.org",
  },
];

export default function SourcesPage() {
  return (
    <article className={`content-width ${styles.page}`}>
      <h1>Źródła danych</h1>
      <p>
        Miejsca w Krajozbiorze pochodzą z otwartych danych publicznych. Pod opisem każdego takiego
        miejsca widać podpis jego źródeł.
      </p>
      <p>Dane pobrano: {DATA_RETRIEVED}.</p>

      <section aria-labelledby="skad-dane" className={styles.section}>
        <h2 id="skad-dane">Skąd pochodzą dane</h2>
        <ul className={styles.sources}>
          {SOURCES.map((source) => (
            <li key={source.id} className={styles.source}>
              <h3>{source.name}</h3>
              <p>{source.used}</p>
              <p>
                Licencja:{" "}
                <a href={source.licenseUrl} rel="noopener noreferrer">
                  {source.license}
                </a>
              </p>
              <p>
                <a href={source.homeUrl} rel="noopener noreferrer">
                  {source.homeLabel}
                </a>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="wikipedia" className={styles.section}>
        <h2 id="wikipedia">Wikipedia</h2>
        <p>
          Przy miejscach, które mają artykuł w polskiej Wikipedii, dajemy odnośnik „Więcej w
          Wikipedii”. Fakty z artykułów Wikipedii wykorzystujemy jako jedno ze źródeł; nie kopiujemy
          tekstu artykułów. Autorów artykułu i jego licencję (CC BY-SA 4.0) zobaczysz na stronie
          samego artykułu.
        </p>
      </section>

      <section aria-labelledby="zdjecia" className={styles.section}>
        <h2 id="zdjecia">Zdjęcia z Wikimedia Commons</h2>
        <p>
          Zdjęcia miejsc pochodzą z{" "}
          <a href="https://commons.wikimedia.org/" rel="noopener noreferrer">
            Wikimedia Commons
          </a>
          , wolnego zbioru plików. Każde zdjęcie ma własnego autora i własną licencję, na przykład
          CC BY-SA albo CC BY. Pod zdjęciem na stronie miejsca podajemy autora, tytuł (jeśli jest),
          odnośnik do strony pliku w Commons i licencję z odnośnikiem do jej dokładnej wersji.
        </p>
        <p>
          Zmniejszamy zdjęcia i zapisujemy je w formacie WebP, żeby szybko się ładowały; poza tym
          nie przerabiamy ich. Zdjęcia na licencji CC BY-SA udostępniamy dalej na tej samej
          licencji.
        </p>
      </section>

      <section aria-labelledby="opisy" className={styles.section}>
        <h2 id="opisy">Opisy miejsc</h2>
        <p>
          Opisy miejsc przygotowuje redakcja serwisu na podstawie źródeł wymienionych na tej
          stronie, korzystając z narzędzi, w tym ze sztucznej inteligencji. Redakcja na bieżąco
          przegląda i poprawia opisy, także po zgłoszeniach odkrywców. Kurator może opis poprawić;
          wtedy tekst jest już jego autorstwa.
        </p>
      </section>

      <section aria-labelledby="odpowiedzialnosc" className={styles.section}>
        <h2 id="odpowiedzialnosc">Odpowiedzialność</h2>
        <p>
          Dane przetworzył Krajozbiór. Wydawcy danych nie odpowiadają za aplikację ani za to, jak
          pokazujemy ich dane. Jeśli widzisz błąd w opisie miejsca, wybierz „Zgłoś problem z
          miejscem” przy tym miejscu albo napisz do nas na adres z dołu strony.
        </p>
      </section>
    </article>
  );
}
