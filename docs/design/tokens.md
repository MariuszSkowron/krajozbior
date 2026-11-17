# Tokeny

## W skrócie

Tokeny to nazwane wartości wyglądu (kolory, odstępy, promienie, cienie, rozmiary, krój pisma, fokus, ruch) zapisane jako zmienne CSS. Nazwa mówi, do czego wartość służy, a nie jak wygląda, więc zmiana wyglądu to zmiana wartości w jednym miejscu. Szkielet ma neutralne wartości; tożsamość wizualną projektu ustala właściciel, a agent zapisuje ją w tokenach. Ten dokument opisuje model, nazewnictwo i zasady; faktyczne wartości są w `src/design-system/tokens/tokens.css` (jedyne źródło).

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

Gramatyka `<kategoria>.<rola>[.<wariant>]`, małe litery, po angielsku. W CSS: kropki zamieniają się na myślniki (`color.brand.primary` → `--color-brand-primary`). Nazwa nie zawiera barwy, jasności ani liczby. Wyjątki: skale porządkowe `xs`–`xl` i `2xl`–`3xl` oraz `pill` (kształt).

## Tokeny w szkielecie

Kolor: `color.brand.{primary,accent}`, `color.surface.{canvas,card,elevated,tint}`, `color.text.{primary,secondary,inverse}`, `color.border.{default,subtle,focus}`, `color.feedback.danger`. Odstępy `space.{xs..xl}`, promienie `radius.{sm,md,lg,pill}`, cienie `shadow.{card,overlay}`, rozmiary dotyku `size.touch.{min,primary}`, typografia `font.family.{base,display}`, `font.size.*`, `font.weight.strong`, `line.height.*`, fokus `focus.ring.*`, ruch `motion.*`. Pełna lista: `src/design-system/tokens/tokens.ts`.

## Implementacja

**[Decyzja techniczna]** `tokens.css` jest jedynym źródłem wartości; `tokens.ts` zawiera listę nazw (`TokenName`) i `tokenVar(name)`. Komponenty w CSS Modules używają `var(--…)` wprost. Style bazowe (krój, kolor strony, fokus) są w `theme/theme.css`, importowanym po tokenach.

## Zasady używania

1. **Tylko tokeny.** Wyjątek: wartości 0, `100%`, `auto`.
2. **Najpierw semantyczny, potem domenowy.** Token domenowy tylko wtedy, gdy znaczenie wynika z modelu produktu.
3. **Znaczenie dobiera token, nie wygląd.**
4. **Status nigdy tylko kolorem:** etykieta tekstowa oraz ikona lub kształt (`accessibility.md`).
5. **Nowy token tylko z uzasadnieniem:** opisuje znaczenie, którego nie wyraża żaden istniejący, wynika z wymagania produktu lub dostępności i ma wskazane miejsce użycia oraz test kontrastu. Bez tokenów „na zapas”.
6. **Brak wariantów „na każdy przypadek”:** stany interakcji (hover, active, disabled) wynikają z elementu natywnego lub jednej reguły motywu, nie z osobnych tokenów. Każda funkcja działa bez hover.
7. **Limit utrzymaniowy:** zapisz w `<docs>/docs/decisions.md` przyjęty limit liczby tokenów; przekroczenie wymaga przeglądu istniejących, nie dopisywania kolejnych.

## Dostępność i kontrast

Kontrast tekstu spełnia WCAG 2.2 AA (4,5:1 dla tekstu zwykłego, 3:1 dla dużego i elementów nietekstowych); tekst główny celuje wyżej (7:1). Test `tests/design-system/tokens.test.ts` czyta `tokens.css` i sprawdza kontrast kluczowych par, porządek skal, zgodność listy `tokens.ts` z `tokens.css`, wyzerowanie ruchu przy `prefers-reduced-motion` i brak literałów koloru w `src/` poza `tokens.css`. Pomiar kontrastu nie dowodzi czytelności w słońcu.

## Zmiana wyglądu projektu

Gdy właściciel poda kierunek wizualny: zapisz decyzję w `<docs>/docs/decisions.md`, zmień wartości w `tokens.css`, zaktualizuj test kontrastu i strony Storybook „Foundation”, uruchom `npm run build-storybook`. Nie dopisuj nowych tokenów, jeśli wystarczy zmiana wartości.
