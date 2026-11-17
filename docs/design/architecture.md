# Architektura warstwy UI

## W skrócie

Interfejs opiera się na natywnym HTML stylowanym tokenami (zmiennymi CSS) i CSS Modules. Własny komponent powstaje tylko wtedy, gdy dodaje coś, czego element natywny nie zapewnia: pojęcie z produktu albo niezmiennik dostępności. Zależności idą tylko w dół, a żaden komponent nie używa wartości „na sztywno”. Uzasadnienie wyboru podstaw: [ui-foundation.md](ui-foundation.md).

Oznaczenia: **[Z]** wymaganie, **[P]** propozycja, **[Decyzja techniczna]** rozstrzygnięcie architektoniczne.

## Decyzja

**[Z]** React 19 jest twardym wymaganiem. **[Decyzja techniczna]** Podstawą kontrolek jest natywny HTML (`<button>`, `<input>`, `<select>`, `<dialog>`, `<progress>`…) stylowany semantycznymi tokenami. Brak biblioteki komponentów; nowa biblioteka UI wymaga wpisu w `<docs>/docs/decisions.md` i potwierdzenia zgodności z React 19 uruchomieniem w repozytorium, nie tylko deklaracją peer deps.

**[Decyzja techniczna]** Stylowanie: zmienne CSS jako tokeny + CSS Modules (wbudowane w Next.js). Brak Tailwind CSS i CSS-in-JS.

## Warstwy

```text
Natywny HTML
  → semantic tokens / theme (zmienne CSS)
    → komponenty produktu
      → wzorce UX
        → ekrany aplikacji
```

| Warstwa | Odpowiada za | Zależy od | Nie robi |
| --- | --- | --- | --- |
| Natywny HTML | przyciski, pola, dialog, postęp, fokus, klawiatura, ARIA | — | nie niesie tożsamości wizualnej ani pojęć produktu |
| Tokeny / motyw | nazwane role kolorów, odstępów, promieni, cieni, rozmiarów | — | nie zawiera logiki ani komponentów |
| Komponenty produktu | prezentacja pojęć domenowych na podstawie prostych danych; komponenty z niezmiennikiem dostępności (np. pole z etykietą i błędem) | tokeny, natywny HTML | nie importują ORM, nie autoryzują, nie znają reguł domeny |
| Wzorce UX | powtarzalne przepływy: lista z filtrami, stany ładowania/pusty/błąd, formularz z walidacją, potwierdzenie akcji | komponenty | nie zawierają reguł biznesowych konkretnego ekranu |
| Ekrany | trasy w `src/app`, kompozycja, pobieranie danych w komponentach serwerowych | wszystkie warstwy | nie stylują kontrolek ad hoc |

**[Decyzja techniczna]** Zależności idą tylko w dół. Komponent nie używa kolorów, odstępów, promieni ani cieni „na sztywno”, tylko tokenów.

## Kiedy używać natywnego HTML wprost

Gdy element jest generyczną kontrolką, nie niesie pojęcia ani reguły produktu, jego wygląd wynika z tokenów i nie powtarza się z tą samą konfiguracją w wielu miejscach.

## Kiedy tworzyć komponent produktu

- element reprezentuje pojęcie z `<docs>/docs/product.md`,
- ta sama kompozycja z tą samą semantyką pojawia się w co najmniej dwóch miejscach,
- trzeba zagwarantować niezmiennik UX lub dostępności, którego natywny element nie wymusza (np. status zawsze z tekstem, pole zawsze z etykietą i powiązanym błędem),
- wyraża język wizualny produktu, którego nie da się uzyskać samymi tokenami.

Komponent przyjmuje proste dane, nie zawiera autoryzacji ani dostępu do danych.

## Kiedy nie tworzyć komponentu

- wystarczy element natywny ze stylem z tokenów lub zmiana wartości tokenu,
- opakowanie tylko przekazuje propsy bez dodanej semantyki,
- jest jedno użycie i brak pojęcia domenowego — zostaw kompozycję w ekranie,
- chodzi o hipotetyczny przyszły przypadek (`AGENTS.md`: „New abstractions require a real product use case”),
- element jest regułą domeny lub autoryzacją — jej miejsce to `src/features`.

## Położenie w repozytorium

```text
src/design-system/
  tokens/       tokens.css (zmienne CSS), tokens.ts (lista nazw i tokenVar)
  theme/        theme.css (style bazowe: krój, tło, fokus), historie kontrolek natywnych
  components/   komponenty produktu (powstają z pierwszym realnym użyciem)
  patterns/     wzorce UX (powstają z pierwszym realnym użyciem)
  foundation/   wyłącznie strony Storybook „Foundation”; nie importować w aplikacji
```

Historie (`*.stories.tsx`) leżą przy warstwie, którą dokumentują. Publiczne API warstwy to importy po ścieżce pliku (`@/design-system/tokens/tokens.css`), bez plików `index` z re-eksportami. Kierunek zależności: `tokens` ← `theme` ← `components` ← `patterns` ← `src/app`; `src/design-system` nie importuje z `src/app`, `src/features` ani `src/lib`. Tokeny ładuje `src/app/layout.tsx`, a zaraz po nich `theme.css`. Komponenty z logiką konkretnej funkcji zostają w `src/features/<domena>/`.
