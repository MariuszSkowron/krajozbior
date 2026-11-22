# Siedem przebiegów tonu

Każdy przebieg sprawdza jeden wymiar. Po każdym wróć krótko do poprzednich: poprawka emocji nie może zepsuć konkretu ani głosu. Numer przebiegu (`T1`…`T7`) i numer reguły wpisujesz w kolumnie „Reguła” raportu. Każda propozycja podlega bezpiecznikowi długości ze `SKILL.md` („Granice redakcji”).

## T1. Głos i zasady „Treść i ton” [Z]

**Pytanie:** czy tekst brzmi jak przewodnik, który zna okolicę, i spełnia zasady z design systemu?

Sprawdź 11 zasad z `docs/design/voice-and-tone.md` i tabelę „Jesteśmy / Nie jesteśmy”. Punkty T1.x niżej obejmują zasady łamane najczęściej:

- **T1.1 Przycisk mówi, co się stanie.** Nie: „OK”, „Dalej”, „Zatwierdź”, „Pokaż”. Przed: „Pokaż” (aplikacja, `src/app/my/collections/page.tsx:119`, filtr) — sprawdź kontekst; gdy nie wiadomo, co pokaże, zaproponuj „Pokaż kolekcje”.
- **T1.2 Tytuł mówi rzecz, nie temat.** Nie: „Nowa karta dostępna”, „Powiadomienie”.
- **T1.3 Liczby w formacie albumu**: „9/24”, „14 odkrytych miejsc”, nie procent.
- **T1.4 Odmowa z wyjściem.** Każda odmowa mówi, co odkrywca może zrobić.
  Przed: „Jesteś 6,2 km od miejsca.” (aplikacja, `src/features/visits/domain/visit-outcome.ts:67`)
  Po: „Jesteś 6,2 km od miejsca. Wizytę potwierdzisz w promieniu [promień] m od niego.”
- **T1.5 Wyjaśniamy moderację.** Nie: „Oczekuje na weryfikację”.
- **T1.6 Brak ocen** gwiazdkami i punktami, brak emoji.
- **T1.7 Zmiana tonu w obrębie ekranu** (ciepło na górze, urzędowo na dole). Same słowa urzędowe i systemowe („operacja”, „użytkownik”) zgłasza `przeglad-wypelniaczy` (F-02); tu oceniasz tylko niespójność tonu między częściami ekranu.

## T2. Po co to odkrywcy

**Pytanie:** czy każde zdanie odpowiada na „i co mi z tego?”.

- Funkcja bez korzyści: „Kolekcje zostały wyposażone w funkcję mapy.” → „Na mapie widzisz miejsca kolekcji.”
- Opis tego, co robimy, zamiast tego, co zyskuje odkrywca: „Oferujemy kolekcje miejsc” → „Zbierasz kolekcje miejsc”.
- Test „Teraz możesz…” z `references/narzedzia-oceny.md` dla nagłówków i zachęt.

## T3. Konkret

**Pytanie:** czy tekst mówi rzecz, którą da się zobaczyć, policzyć albo odwiedzić?

| Ogólnik                     | Konkret                                                 |
| --------------------------- | ------------------------------------------------------- |
| ciekawe miejsca             | wieże ciśnień, kapliczki, stare dworce                  |
| w Twojej okolicy            | 6 km od Ciebie                                          |
| wiele kolekcji              | 14 kolekcji na Pomorzu                                  |
| niedawno                    | 8.11.2026                                               |

Przed: „Krajozbiór to kolekcje ciekawych miejsc w Polsce.” (aplikacja, `src/app/page.tsx:121`)
Po: „Krajozbiór to kolekcje wież ciśnień, kapliczek i dworców w Polsce.” `[POTRZEBNE: rodzaje miejsc, które naprawdę są w katalogu]`

Liczb i nazw nie wymyślasz. Gdy konkret wymaga danych, napisz `[POTRZEBNE: …]`.

## T4. Uczciwość obietnicy

**Pytanie:** czy każda obietnica jest prawdziwa dziś?

- Przymiotniki bez dowodu: „największa”, „najlepsza”, „wszystkie miejsca w Polsce”.
- Obietnica funkcji, której jeszcze nie ma, w tonie teraźniejszym.
- Ogólnik, który bywa nieprawdą: przyczyna podana „na oko” zamiast rzeczywistej (np. „minęło sporo czasu” przy wygasłym logowaniu, które kończy się też z innych powodów).
- Prywatność: tekst o lokalizacji i danych mówi dokładnie to, co robi aplikacja. Przykład uczciwego tekstu: „Nie zapisujemy, gdzie jesteś, tylko to, że miejsce trafiło do Twojego albumu.”

## T5. Emocja bez hype'u [Z]

**Pytanie:** czy tekst pozwala odkrywcy coś poczuć — radość odkrycia, ciekawość, spokój — bez reklamowego krzyku?

- **Za płasko**: moment kulminacyjny opisany jak protokół.
  Przed: „Wizyta potwierdzona.” (aplikacja, `src/features/visits/domain/visit-outcome.ts:65`)
  Po: „[Nazwa miejsca] jest w Twoim albumie.” (pod spodem i tak pokazujemy postęp 10/24)
- **Za głośno**: „Niesamowite!”, „Wow, gratulacje!!!”, „Przygoda Twojego życia”, seria wykrzykników. Skala hype'u: `references/narzedzia-oceny.md`, sekcja 3.
- Emocja proporcjonalna do wydarzenia: zapis profilu — sucho; ukończona kolekcja — jedno ciepłe zdanie.
- Źródła emocji w Krajozbiorze: obraz miejsca (nazwa, epoka, szczegół), postęp w albumie, poczucie bycia „tam”, wspólnota odkrywców. Nie: rywalizacja, presja, strach przed utratą.

## T6. Spokój przed decyzją

**Pytanie:** czy przy kroku, który budzi wahanie, tekst odpowiada na obawę?

- Zgoda na lokalizację: co zapisujemy, a czego nie.
- Usunięcie konta: co zniknie, czy da się cofnąć, jak zrezygnować.
- Logowanie: ile trwa, co dostanę na e-mail.
- Bez presji i manipulacji („Na pewno chcesz stracić wszystko?”).

## T7. Ton do sytuacji

**Pytanie:** czy ton pasuje do stanu odkrywcy? Porównaj z tabelą „Ton: jak zmienia się z sytuacją” w przewodniku.

- Odmowa i awaria: spokojnie, bez winy („Podałeś zły kod” → „Ten kod nie pasuje. Sprawdź e-mail albo poproś o nowy.”).
- Teren prywatny, ruina: rzeczowo, prośba zamiast zakazu, bez alarmu.
- Pusty stan: zachęta i pierwszy krok, nie „Brak danych”.
