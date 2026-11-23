import type {
  LegendaryCardCategory,
  LegendaryCardContent,
  LegendaryCardPhoto,
} from "./legendary-card";

// Wymyślone dane do historii Storybooka (D-51 pkt 5): ani prawdziwych kuratorów, ani miejsc
// kultu i pamięci (D-39). Pierwsza karta pochodzi z makiety skrytki.
export const legendarySamples: Readonly<Record<LegendaryCardCategory, LegendaryCardContent>> = {
  culture_night: {
    category: "culture_night",
    eventName: "Noc Muzeów",
    collectionTitle: "Wieże ciśnień Pomorza",
    placeName: "Wieża ciśnień w Tczewie",
    dateLabel: "16.5.2026, 22:40",
  },
  heritage: {
    category: "heritage",
    eventName: "Europejskie Dni Dziedzictwa",
    collectionTitle: "Zabytki techniki Żuław",
    placeName: "Stacja kolejki wąskotorowej",
    dateLabel: "13.9.2026, 11:00",
  },
  national_holiday: {
    category: "national_holiday",
    eventName: "Muzea na Święto Niepodległości",
    collectionTitle: "Muzea Pomorza",
    placeName: "Muzeum Miasta",
    dateLabel: "11.11.2026, 10:00",
  },
  nature_sky: {
    category: "nature_sky",
    eventName: "Noc Perseidów",
    collectionTitle: "Miejsca z widokiem na niebo",
    placeName: "Polana widokowa nad jeziorem",
    dateLabel: "12.8.2026, 23:30",
  },
  trail_community: {
    category: "trail_community",
    eventName: "Rajd Wzdłuż Wisły",
    collectionTitle: "Szlak nadwiślański",
    placeName: "Przystań w Tczewie",
    dateLabel: "20.6.2026, 9:00",
  },
  krajozbior: {
    category: "krajozbior",
    eventName: "Premiera kolekcji",
    collectionTitle: "Wieże ciśnień Pomorza",
    placeName: "Spichlerz nad Wisłą",
    dateLabel: "1.12.2026, 18:00",
  },
};

export const previewNote = "Zapowiedź funkcji: karty legendarne nie działają jeszcze w aplikacji.";
export const photoNote = "Obraz i podpis są przykładowe.";

// Obrazy zastępcze narysowane w repozytorium (DT-E6-4a-13): bez zdjęć z sieci i prawdziwych miejsc.
// Ścieżki rozwiązuje Vite Storybooka; aplikacja (`npm run build`) tego pliku nie importuje.
export const samplePhotos = {
  "3x2": {
    src: new URL("./legendary-card-samples/sample-3x2.svg", import.meta.url).href,
    width: 1200,
    height: 800,
  },
  "2x3": {
    src: new URL("./legendary-card-samples/sample-2x3.svg", import.meta.url).href,
    width: 800,
    height: 1200,
  },
  "1x1": {
    src: new URL("./legendary-card-samples/sample-1x1.svg", import.meta.url).href,
    width: 1000,
    height: 1000,
  },
  "3x1": {
    src: new URL("./legendary-card-samples/sample-3x1.svg", import.meta.url).href,
    width: 1500,
    height: 500,
  },
} as const satisfies Readonly<Record<string, LegendaryCardPhoto>>;

/** Zepsuty adres: pokazuje stan „zdjęcie nie ładuje się”. */
export const brokenPhoto: LegendaryCardPhoto = {
  src: "https://obraz-przykladowy.invalid/nie-istnieje.jpg",
  width: 1200,
  height: 800,
};
