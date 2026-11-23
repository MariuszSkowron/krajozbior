# Tokeny

## W skrócie

Tokeny to nazwane wartości wyglądu (kolory, odstępy, promienie, cienie, rozmiary, krój pisma, fokus, ruch) zapisane jako zmienne CSS. Nazwa mówi, do czego wartość służy, a nie jak wygląda, więc zmiana wyglądu to zmiana wartości w jednym miejscu. Wygląd „nocny album” (ciemny motyw domyślny i jasny) pochodzi z design systemu właściciela (D-08, D-22); agent zapisuje go w tokenach. Ten dokument opisuje model, nazewnictwo i zasady; faktyczne wartości są w `src/design-system/tokens/tokens.css` (jedyne źródło).

Oznaczenia: **[Z]** wymaganie, **[P]** propozycja, **[Decyzja techniczna]** rozstrzygnięcie.

## Rola tokenów

**[Decyzja techniczna]** Tożsamość wizualna powstaje przez tokeny i motyw. Komponent nie używa wartości „na sztywno” (kolorów, odstępów, promieni, cieni). **[Z]** Tokeny opisują znaczenie, nie wygląd: `color.surface.card`, nie `green500`.

## Model

Dwie warstwy, jedna reguła zależności:

| Warstwa | Przykłady | Kto jej używa |
| --- | --- | --- |
| **Semantic** — ogólne role interfejsu | `color.text.primary`, `space.md`, `radius.lg`, `shadow.card` | komponenty i wzorce |
| **Domain** — znaczenie wynikające z produktu | np. `<pojęcie>.<stan>` | komponenty domenowe |

Tokeny domenowe powstają dopiero z pierwszym komponentem, który ich używa, i tylko dla znaczeń z `<docs>/docs/product.md`. Wartości surowe istnieją wyłącznie w motywie; nie tworzymy warstwy „palety” z odcieniami. Zależności są jednokierunkowe: komponent → token domenowy lub semantyczny → wartość. Token nie zawiera logiki.

### Nazewnictwo

Gramatyka `<kategoria>.<rola>[.<wariant>]`, małe litery, po angielsku. W CSS: kropki zamieniają się na myślniki (`color.text.accent` → `--color-text-accent`). Nazwa nie zawiera barwy, jasności ani liczby. Wyjątki: skale porządkowe `xs`–`xl` i `2xl`–`3xl` oraz `pill` (kształt).

## Motywy

**[Decyzja techniczna]** Motyw to klasa na `<html>`: `.theme-dark` (nocny, domyślny; jego wartości stoją też w `:root`, więc działa bez klasy) i `.theme-light`. Oba bloki w `tokens.css` definiują dokładnie te same nazwy kolorów i cieni; zmiana motywu zmienia tylko wartości, nigdy komponenty. Każdy blok ustawia `color-scheme`. Klasę ustawia po stronie serwera układ główny z ciasteczka `krajozbior-theme` (`src/app/shell/theme.ts`; każda wartość inna niż `light` oznacza motyw nocny; `prefers-color-scheme` nie jest czytane), a przełącznik w nagłówku to natywny formularz z akcją serwera (`theme-actions.ts`), działający bez JavaScriptu. W Storybooku motyw zmienia pasek narzędzi „Motyw”.

## Mapowanie nazw z design systemu właściciela

Zostajemy przy gramatyce repozytorium; nazwy z PDF design systemu mapujemy 1:1. Wartości są w `tokens.css`, nie tutaj.

| PDF | Token repozytorium | Rola |
| --- | --- | --- |
| `--bg` | `color.surface.canvas` | tło strony i pól formularzy |
| `--surface` | `color.surface.card` | karty, nagłówek |
| `--surface-2` | `color.surface.tint` | tło wyróżnione |
| `--hover` | `color.surface.hover` | tło po najechaniu (cichy przycisk) |
| `--line` / `--line-2` / `--line-3` | `color.border.subtle` / `.default` / `.strong` | linie; `.strong` obrys po najechaniu |
| `--track` | `color.progress.track` | tor paska postępu |
| `--text` / `--strong` / `--muted` / `--muted-2` / `--faint` | `color.text.primary` / `.strong` / `.secondary` / `.label` / `.meta` | tekst; `.meta` także obrys pól i tekst zastępczy (D-22, Q3) |
| `--accent` / `--accent-text` / `--on-accent` | `color.brand.accent` / `color.text.accent` / `color.text.on-accent` | przyciski i wypełnienia / linki i fokus / tekst na akcencie |
| `--ok` `--warn` `--bad` `--info` (+`-bg`) | `color.feedback.success` / `.warning` / `.danger` / `.info` (+`.bg`) | stany |
| `--glass` | `color.surface.glass` | półprzezroczyste tło dolnego paska nawigacji (E3-2a) |
| `--img-a` / `--img-b` | `color.image.placeholder` / `.placeholder-alt` | okładka kolekcji bez zdjęcia: gradient (E3-2a) |
| `--scrim` / `#fff` | `color.image.scrim` / `color.text.on-image` | przyciemnienie pod tekstem na zdjęciu (gradient w `color-mix`) i tekst na takim zdjęciu; ta sama wartość w obu motywach (D-57, DT-2) |

Tokeny, które pierwszy używa kolejny PR (zasada 5), powstają dopiero w nim: `radius.xl`, `space.2xl`, `space.3xl`, odstępy kart. PR E3-2b dodał `font.size.5xl`, `font.tracking.display`, `motion.duration.medium`, `motion.duration.enter`, `size.row.min`, `size.icon.badge` i `border.width.state`. PR E3-2a dodał `color.surface.glass`, `color.image.placeholder(-alt)`, `shadow.card-hover`, `shadow.accent-glow`, `font.size.2xs` i `font.weight.medium`.

Wysokość dolnego paska nawigacji (`--shell-bottom-bar-height`) to zmienna układu powłoki w `src/app/app-shell.module.css`, nie token: dotyczy tylko powłoki i nie zależy od motywu.

## Tokeny

Pełna lista: `src/design-system/tokens/tokens.ts` (86 tokenów po E6-4a; limit 90). E6-4a (D-52) dodało dwanaście barw `color.legendary.<kategoria>.start` i `.end` (kategorie: `culture-night`, `heritage`, `national-holiday`, `nature-sky`, `trail-community`, `krajozbior`; opalizacja ramki i połysku karty legendarnej, w obu blokach motywu, środek gradientu liczy `color-mix(in oklch, start, end)` w module komponentu) oraz `motion.duration.reveal` (1200 ms, `0ms` przy `prefers-reduced-motion`). Tekst i symbol karty nigdy nie stoją na barwach `color.legendary.*`; mają stały kolor z tokenów tekstu. Kolor i cienie zależą od motywu; odstępy, promienie, rozmiary, krój, fokus i ruch są wspólne. Krój: `font.family.{base,display,mono}` (Geist, Instrument Serif, Geist Mono z `src/design-system/fonts/`, z zapasem systemowym), wagi 400 i 600 (Instrument Serif ma tylko 400).

## Implementacja

**[Decyzja techniczna]** `tokens.css` jest jedynym źródłem wartości; `tokens.ts` zawiera listę nazw (`TokenName`) i `tokenVar(name)`. Komponenty w CSS Modules używają `var(--…)` wprost. Style bazowe (krój, kolor strony, fokus) są w `theme/theme.css`, importowanym po tokenach.

## Zasady używania

1. **Tylko tokeny.** Wyjątek: wartości 0, `100%`, `auto`.
2. **Najpierw semantyczny, potem domenowy.** Token domenowy tylko wtedy, gdy znaczenie wynika z modelu produktu.
3. **Znaczenie dobiera token, nie wygląd.**
4. **Status nigdy tylko kolorem:** etykieta tekstowa oraz ikona lub kształt (`accessibility.md`).
5. **Nowy token tylko z uzasadnieniem:** opisuje znaczenie, którego nie wyraża żaden istniejący, wynika z wymagania produktu lub dostępności i ma wskazane miejsce użycia oraz test kontrastu. Bez tokenów „na zapas”.
6. **Brak wariantów „na każdy przypadek”:** stany interakcji (hover, active, disabled) wynikają z elementu natywnego lub jednej reguły motywu, nie z osobnych tokenów. Każda funkcja działa bez hover. **Wyjątek:** token stanu interakcji jest dozwolony, gdy wartość podaje design system właściciela (D-08, D-22); poza tym stan wynika z tokenu bazowego. Tak powstały `color.surface.hover` i `color.border.strong` (oraz w kolejnych PR-ach `shadow.card-hover` i `shadow.accent-glow`).
7. **Limit utrzymaniowy:** 90 tokenów (D-24, `<docs>/docs/decisions.md`); przekroczenie wymaga przeglądu istniejących, nie dopisywania kolejnych. Test `tokens.test.ts` pilnuje limitu.

## Dostępność i kontrast

Kontrast tekstu spełnia WCAG 2.2 AA (4,5:1 dla tekstu zwykłego, 3:1 dla dużego i elementów nietekstowych); tekst główny celuje wyżej (7:1). Test `tests/design-system/tokens.test.ts` czyta `tokens.css` i sprawdza w obu motywach kontrast par dozwolonych (tekst 4,5:1, elementy nietekstowe 3:1, odznaki stanu z nałożonym tłem), prawdziwość listy par niedozwolonych (reguła tła, `accessibility.md`), jednakowe nazwy w obu motywach, porządek skal, zgodność listy `tokens.ts` z `tokens.css`, limit tokenów, wyzerowanie ruchu przy `prefers-reduced-motion` i brak literałów koloru w `src/` poza `tokens.css` (wyjątki: stała `themeColor` w `src/app/shell/theme.ts`, pierścienie `color-mix(in srgb, var(--…) N%, transparent)` i środek gradientu karty legendarnej `color-mix(in oklch, var(--color-legendary-<k>-start), var(--color-legendary-<k>-end))` tej samej kategorii). Pomiar kontrastu nie dowodzi czytelności w słońcu.

## Zmiana wyglądu projektu

Gdy właściciel zmieni kierunek wizualny: zapisz decyzję w `<docs>/docs/decisions.md`, zmień wartości w `tokens.css` (w obu motywach), zaktualizuj test kontrastu i strony Storybook „Foundation”, uruchom `npm run build-storybook`. Nie dopisuj nowych tokenów, jeśli wystarczy zmiana wartości.
