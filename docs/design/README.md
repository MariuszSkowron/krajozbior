# Materiały projektowe

## W skrócie

Tu mieszka dokumentacja design systemu: jak zbudowany jest interfejs, jakie mamy tokeny i jakie wymagania dostępności spełnia każdy komponent. Szkielet ma neutralny wygląd; tożsamość wizualną projektu ustala właściciel (ankieta, pytanie o wygląd), a agent zapisuje ją w tokenach i motywie. Makiety i materiały z tego katalogu są poglądowe — wymagania wynikają z `<docs>/docs/product.md`, a przy konflikcie wygrywa `<docs>/docs/product.md`.

## Dokumentacja design systemu

Kod warstwy: `src/design-system/` (tokeny jako zmienne CSS, motyw bazowy, strony Storybook „Foundation”).

- [architecture.md](architecture.md) — warstwy, podział natywny HTML / komponenty produktu, położenie w repozytorium.
- [ui-foundation.md](ui-foundation.md) — podstawy UI: React 19, natywny HTML, kiedy dodać bibliotekę.
- [tokens.md](tokens.md) — model, nazewnictwo i zasady używania tokenów.
- [accessibility.md](accessibility.md) — kontrakt dostępności komponentu i sposób weryfikacji.
- [voice-and-tone.md](voice-and-tone.md) — głos i ton tekstów dla odkrywcy; wzorzec dla skilli `przeglad-polszczyzny`, `przeglad-tonu` i `przeglad-wypelniaczy`.

Dokumenty, które powstaną razem z produktem (nie twórz ich „na zapas”): kierunek wizualny, zasady projektowe, komponenty, wzorce UX.

## UI Definition of Done

Każda zmiana UI przechodzi tę listę. Punkty niedotyczące zmiany oznacz N/A.

**Fundament**

- [ ] Czy istnieje odpowiedni element natywny lub komponent w `src/design-system/`?
- [ ] Czy nie duplikuję istniejącego komponentu?
- [ ] Czy używam tokenów semantycznych i nie hardcoduję wartości?

**Stany**

- [ ] ładowanie, pusty, błąd, sukces, nieaktywny (jeśli dotyczy)

**Dostępność**

- [ ] klawiatura, widoczny fokus, nazwa dostępna, kontrast, status nie tylko kolorem, cele dotykowe, semantyka dla czytnika ekranu

**Responsywność**

- [ ] telefon, komputer, (jeśli produkt tego wymaga) użycie w terenie

**Treść**

- [ ] tekst dla użytkownika w języku z `<docs>/docs/product.md` (domyślnie polski), zrozumiały, bez języka technicznego i bazodanowego

**Dokumentacja**

- [ ] Czy nowy komponent lub wzorzec wymaga dokumentacji i historii Storybook?

Lista ma ograniczać regresje, nie tworzyć narzutu proceduralnego.
