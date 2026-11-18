# Kroje aplikacji

Pliki `woff2` są pełnymi plikami z oficjalnych wydań, bez zmian i bez cięcia zestawu znaków (zawierają
`latin-ext`, więc mają polskie znaki). Licencja każdej rodziny: SIL Open Font License 1.1 (`OFL.txt`
obok plików). Kroje ładuje `next/font/local` w `src/app/fonts.ts`, a Storybook przez
`src/design-system/fonts/fonts.css` (`@font-face` z tych samych plików).

| Plik                                             | Źródło                                                                                                                                                   | Wersja                                                                        | SHA-256                                                            | Rozmiar            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------ |
| `geist/Geist-Variable.woff2`                     | `vercel/geist-font`, `fonts/Geist/webfonts/Geist[wght].woff2` w pliku `geist-font-v1.9.2.zip` (https://github.com/vercel/geist-font/releases/tag/v1.9.2) | v1.9.2                                                                        | `3626eba547294501c8a4d662c7d9ea3b49734409a4c5a1ccf12fa86429b1687e` | 67,9 KB (69 488 B) |
| `geist-mono/GeistMono-Variable.woff2`            | to samo wydanie, `fonts/GeistMono/webfonts/GeistMono[wght].woff2`                                                                                        | v1.9.2                                                                        | `5d93ee62680bbec1abc5405c2658311f9396f6f9a821ef8551ec463887e600d4` | 69,5 KB (71 212 B) |
| `instrument-serif/InstrumentSerif-Regular.woff2` | `Instrument/instrument-serif`, `fonts/webfonts/InstrumentSerif-Regular.woff2` (https://github.com/Instrument/instrument-serif)                           | commit `65c0ef225f386a3c7e87570a4aa9cc0262c2fd81` (repozytorium nie ma wydań) | `ca21b99b0d6b88a0dc34cebfe48104611e5c7f8f92746bed26c37aa470174322` | 26,8 KB (27 440 B) |
| `instrument-serif/InstrumentSerif-Italic.woff2`  | `fonts/webfonts/InstrumentSerif-Italic.woff2` w tym samym commicie                                                                                       | `65c0ef2…`                                                                    | `4f7aacc18d491dea8778bbc591db87b9455625899ed5f913957e7fd82604c294` | 27,4 KB (28 096 B) |

Razem 191,6 KB (196 236 B). Geist i Geist Mono to pliki zmiennej wagi (oś `wght` 100–900); Instrument Serif ma jedną
wagę (400) w odmianie prostej i kursywie.

Jedyna zmiana wobec źródła: nazwy plików Geist i Geist Mono (`Geist[wght].woff2` na
`Geist-Variable.woff2` itd.), bo nawiasy kwadratowe przeszkadzają narzędziom. Zawartość plików jest
bez zmian (sumy SHA-256 liczone po zmianie nazwy; to ten sam plik).

Kontrola polskich znaków (tabela `cmap`, `fontTools` 4.68.0): każdy z czterech plików ma wszystkie litery
`ĄĆĘŁŃÓŚŹŻąćęłńóśźż`.
