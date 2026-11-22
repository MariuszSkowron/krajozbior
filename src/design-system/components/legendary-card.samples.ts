import type { LegendaryCardCategory, LegendaryCardProps } from "./legendary-card";

// Wymyślone dane do historii Storybooka (D-51 pkt 5): ani prawdziwych kuratorów, ani miejsc
// kultu i pamięci (D-39). Pierwsza karta pochodzi z makiety skrytki.
export const legendarySamples: Readonly<
  Record<LegendaryCardCategory, Omit<LegendaryCardProps, "playing">>
> = {
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
