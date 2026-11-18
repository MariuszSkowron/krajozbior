import localFont from "next/font/local";

// Kroje z plików w repozytorium (src/design-system/fonts/, źródła i licencje w README.md tamże):
// bez zapytań do Google ani w czasie działania, ani przy budowaniu. Zmienne CSS trafiają na <html>
// i zasilają tokeny font.family.* (tokens.css).
export const geist = localFont({
  src: "../design-system/fonts/geist/Geist-Variable.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});

export const geistMono = localFont({
  src: "../design-system/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
  preload: false,
});

export const instrumentSerif = localFont({
  src: [
    {
      path: "../design-system/fonts/instrument-serif/InstrumentSerif-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../design-system/fonts/instrument-serif/InstrumentSerif-Italic.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-instrument-serif",
  display: "swap",
});
