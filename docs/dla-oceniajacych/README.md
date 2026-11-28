# Dla oceniających

## W skrócie

To punkt wejścia dla osób, które oceniają Krajozbiór w konkursie i nie znają projektu. Najpierw podajemy, który plik odpowiada na które pytanie, potem prowadzimy od każdego wymogu konkursu do miejsca, w którym da się go sprawdzić: pliku, testu albo PR-a (propozycji zmiany w kodzie, którą przed scaleniem ktoś sprawdza). Pełna dokumentacja (decyzje właściciela, dzienniki pracy agentów, raporty bezpieczeństwa, plany biznesowe) zostaje w osobnym, prywatnym repozytorium; tutaj są jej jawne streszczenia, a oceniający nie potrzebują dostępu do tamtego repozytorium.

## W dwie minuty

1. **Co to jest?** Album odwiedzonych miejsc: kurator (np. gmina) układa tematyczną kolekcję miejsc, odkrywca potwierdza wizyty lokalizacją telefonu i widzi postęp, np. 9/24. → [Produkt](produkt.md)
2. **Co działa?** Cała ścieżka od kolekcji kuratora do wizyty odkrywcy, a wokół niej strona główna, wyszukiwarka, mapa, zdjęcia z Wikimedia Commons, aktualności, własne kolekcje i profil. → [Stan realizacji](stan-realizacji.md)
3. **Jak powstawało?** Kod piszą agenci AI według specyfikacji; każdą zmianę sprawdzają inny agent i testy w CI, a od 21 listopada 2026 roku właściciel zatwierdza każdy PR. → [Proces, przeglądy i bezpieczeństwo](proces-i-przeglady.md)
4. **Czy dane są bezpieczne?** Dwie niezależne bariery (serwer i reguły dostępu w samej bazie), a każdą sprawdza test odmowy dostępu. → [Architektura i ochrona danych](architektura-i-dane.md)

## Który plik odpowiada na które pytanie

| Pytanie                                                                                 | Plik                                                            |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Jaki problem rozwiązujemy, dla kogo, co jest w MVP i czego nie robimy?                  | [Produkt](produkt.md)                                           |
| Jak podzieliliśmy pracę na epiki i historyjki z kryteriami akceptacji?                  | [Backlog](backlog.md)                                           |
| Jak wygląda pełna specyfikacja jednego epiku i jej przegląd?                            | [Specyfikacja E12 „Odkrywanie”](specyfikacja-e12-odkrywanie.md) |
| Według jakich innych specyfikacji powstał kod i które PR-y z nich wyszły?               | [Specyfikacje](specyfikacje.md)                                 |
| Co już działa, a co jest w toku?                                                        | [Stan realizacji](stan-realizacji.md)                           |
| Jak zbudowana jest aplikacja i kto widzi jakie dane?                                    | [Architektura i ochrona danych](architektura-i-dane.md)         |
| Jak pracują agenci, kto sprawdza ich zmiany i co wykazały przeglądy?                    | [Proces, przeglądy i bezpieczeństwo](proces-i-przeglady.md)     |
| Jakie uprawnienia ma agent, gdzie są sekrety, jak skończyły się próby prompt injection? | [Notatki bezpieczeństwa](../../security-notes.md)               |
| Co zmieniło się w kolejnych PR-ach?                                                     | [Dziennik zmian](../../CHANGELOG.md)                            |
| Jak uruchomić aplikację u siebie?                                                       | [README](../../README.md), sekcja „Uruchomienie lokalne”        |

## Jak czytać odnośniki

W całej dokumentacji powtarzają się cztery rodzaje oznaczeń. Pokazują, z czego wynika dana zmiana:

| Oznaczenie           | Co znaczy                                                                                     | Gdzie to sprawdzić                       |
| -------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `#N` (np. #134)      | PR w tym repozytorium, czyli konkretna zmiana w kodzie z opisem po polsku                     | zakładka Pull requests na GitHubie       |
| `E1`–`E12`, `E12-S1` | epik i historyjka z backlogu; w tytułach PR-ów także faza specyfikacji (np. `E4-2b`, `E7-R1`) | [Backlog](backlog.md)                    |
| `D-NN` (np. D-57)    | decyzja właściciela; jej treść jest prywatna, a skutek opisuje PR, który się na nią powołuje  | opis PR-a z tym numerem                  |
| `docs#N`             | zadanie w prywatnym repozytorium dokumentacji                                                 | tylko numer; treść zadania jest prywatna |

Kierunek zależności jest zawsze ten sam: **zadanie (`docs#N`) → specyfikacja z przeglądem → decyzje właściciela (`D-NN`) → PR (`#N`) z testami i przeglądem → wpis w [dzienniku zmian](../../CHANGELOG.md)**.

## Wymogi konkursu i gdzie je znaleźć

### Produkt

| Wymóg                                                     | Gdzie to jest                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logowanie i co najmniej dwie role z różnymi uprawnieniami | Logowanie jednorazowym kodem z e-maila (`src/features/identity/`), od #104 w dwóch krokach, od #134 z osobnymi wejściami „Zaloguj się” i „Załóż konto”. Role: gość, odkrywca, kurator organizacji, administrator ([Produkt](produkt.md), „Kto korzysta”). Organizacje kuratorskie i nadawanie roli kuratora: #10; dziennik operacji: #22; kurator po zalogowaniu trafia do swojego panelu: #121.                                                                     |
| Nikt nie widzi cudzych danych                             | Reguły dostępu do wierszy w bazie (RLS) i role bazy: [docs/data-isolation.md](../data-isolation.md). Test, że każda tabela ma włączone i wymuszone reguły: [`tests/integration/rls-coverage.test.ts`](../../tests/integration/rls-coverage.test.ts).                                                                                                                                                                                                                 |
| CRUD (dodawanie, podgląd, edycja, usuwanie)               | Panel kuratora: tworzenie, edycja i kolejność kolekcji i miejsc, publikacja, wycofanie publikacji, usuwanie szkiców (#11, #13), pinezka na mapie i wyszukiwanie adresu (#109, #137). Odkrywca: zapis i usunięcie kolekcji z albumu (#15, #16), lista „Chcę zobaczyć” (#18), wizyta z przeszłości z usuwaniem (#34), własne kolekcje z dodawaniem miejsc (#105), profil (#50), usunięcie konta (#43).                                                                 |
| Logika biznesowa (reguły, walidacje, statusy)             | Statusy kolekcji (szkic, opublikowana, wycofana; kolekcji kiedykolwiek opublikowanej nie da się usunąć) w #11. Potwierdzenie wizyty: odległość i dokładność odczytu sprawdza baza, z promieniem ustawianym przez kuratora (#17). Wizyta z przeszłości z dokładnością daty i pierwszeństwem potwierdzenia na miejscu (#34). Postęp „9/24” i „Kolekcja kompletna” (#16, #135), adres kolekcji ustalany przy pierwszej publikacji (#29). Reguły: [Produkt](produkt.md). |

### Praca z agentami

| Wymóg                                                                | Gdzie to jest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Opis produktu i backlog: problem, dla kogo, MVP, czego nie robimy    | [Produkt](produkt.md) i [Backlog](backlog.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Co najmniej jeden epik z historyjkami i kryteriami akceptacji        | Epik E12 „Odkrywanie” (zadanie `docs#13`) z czterema historyjkami `docs#79`–`docs#82`: [Backlog](backlog.md#e12-odkrywanie-strona-główna-wyszukiwarka-mapa).                                                                                                                                                                                                                                                                                                                                                 |
| Specyfikacje do historyjek epiku, każda przeglądana przez inny model | [Specyfikacja E12](specyfikacja-e12-odkrywanie.md): napisał ją Opus, przejrzał Sonnet, a poprawki sprawdził kolejny, niezależny agent. Pozostałe specyfikacje i ich przeglądy: [Specyfikacje](specyfikacje.md).                                                                                                                                                                                                                                                                                              |
| Uporządkowany `AGENTS.md`                                            | [AGENTS.md](../../AGENTS.md) (zasady pracy), [docs/agent-workflow.md](../agent-workflow.md) (przepływ od zadania do scalenia), [SDLC.md](../../SDLC.md) (kolejność etapów i warunki przejścia).                                                                                                                                                                                                                                                                                                              |
| Skille, w tym co najmniej jeden dopasowany do projektu               | Własne skille projektu w [`.claude/skills/`](../../.claude/skills/): [`private-data`](../../.claude/skills/private-data/SKILL.md) prowadzi agenta przy każdej funkcji z danymi prywatnymi (klasyfikacja danych, migracja z RLS, test odmowy dostępu; poprawiony w #23), a `przeglad-polszczyzny`, `przeglad-tonu`, `przeglad-wypelniaczy` i `przeglad-ux` sprawdzają teksty i ekrany (#96). Skille `om-*` (specyfikacje, przeglądy, PR-y, testy) mają wersje w [`skills-lock.json`](../../skills-lock.json). |
| Hook pilnujący wybranej zasady                                       | Siedem hooków w [`.claude/hooks/`](../../.claude/hooks/), każdy z testem w [`tests/scripts/`](../../tests/scripts/). Np. `require-rls-in-migration.mjs` blokuje migrację tworzącą tabelę bez reguł dostępu, a `block-shell-file-writes.mjs` (#33) blokuje zmianę plików poleceniami terminala. Opis hooków: [security-notes.md](../../security-notes.md).                                                                                                                                                    |
| PR zrobiony przez agenta na podstawie specyfikacji, z przeglądem     | Pięć PR-ów epiku E12: #38, #39, #40, #41, #49, a historyjka S4 w #79. Każdy przeszedł przegląd poziomu A innego agenta (Opus); wyniki: [Specyfikacja E12](specyfikacja-e12-odkrywanie.md#przeglądy-pr-ów-epiku). Wcześniej według specyfikacji ścieżki konkursowej: #10–#18 i #34; później według specyfikacji kolejnych epików: [Specyfikacje](specyfikacje.md#kolejne-specyfikacje-i-ich-pr-y).                                                                                                            |

### Jakość i bezpieczeństwo

| Wymóg                                                             | Gdzie to jest                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI przy każdym PR: build, testy jednostkowe, integracja/E2E       | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml): zadanie `check` (formatowanie, lint, typy, testy jednostkowe z progiem pokrycia, build), `integration` (testy na prawdziwej bazie PostgreSQL), `e2e` (testy w przeglądarce na zbudowanej aplikacji), `gitleaks` (sekrety), `guard` (czystość repozytorium publicznego). Opis: [docs/testing.md](../testing.md).                                                                                         |
| Test E2E tak, jak używa aplikacji użytkownik                      | [`e2e/competition-path.spec.ts`](../../e2e/competition-path.spec.ts): od utworzenia kolekcji przez kuratora do potwierdzenia wizyty przez odkrywcę. [`e2e/golden-path.spec.ts`](../../e2e/golden-path.spec.ts) (#134): nowa osoba od założenia konta do pierwszej wizyty. Pozostałe ścieżki w [`e2e/`](../../e2e/), m.in. wyszukiwarka, mapa, aktualności, własne kolekcje, usunięcie konta.                                                                          |
| Test uprawnień: A nie dobierze się do danych B ani do cudzej roli | Integracja: [`tests/integration/`](../../tests/integration/), np. `catalog-access.test.ts` (kurator organizacji B kontra szkic organizacji A), `visits-access.test.ts` i `album-access.test.ts` (odkrywca B kontra dane odkrywcy A), `own-collections-access.test.ts`, `news-access.test.ts`, `home-album-access.test.ts`, `search-access.test.ts`, `operations-audit-access.test.ts`. E2E z dwoma kontami: `e2e/album-access.spec.ts`, `e2e/catalog-access.spec.ts`. |
| `security-notes.md`                                               | [security-notes.md](../../security-notes.md) w katalogu głównym: uprawnienia agenta, miejsca sekretów bez ich treści, wynik dwóch prób prompt injection.                                                                                                                                                                                                                                                                                                              |

### Mile widziane

| Element                                    | Stan                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design system                              | [docs/design/](../design/README.md), tokeny i komponenty w `src/design-system/`, podgląd w Storybooku (budowany w CI). Wygląd „nocny album”: #25, #28, #31; nowy wygląd stron kolekcji, miejsca i strony głównej (D-57): #127, #129, #130, #132.                                          |
| Skanowanie sekretów i zależności w CI      | `gitleaks` na całej historii, `npm audit` dla zależności produkcyjnych (blokujące przy poziomie wysokim i krytycznym), analiza kodu CodeQL ([`.github/workflows/codeql.yml`](../../.github/workflows/codeql.yml)), Dependabot ([`.github/dependabot.yml`](../../.github/dependabot.yml)). |
| Aplikacja pod publicznym adresem, rollback | Narzędzia są scalone: obraz produkcyjny i konfiguracja serwera (#55), wdrożenie jednym poleceniem z powrotem do poprzedniej wersji (#62). Opis: [docs/deployment.md](../deployment.md). Adres dopiszemy tutaj po uruchomieniu.                                                            |
| Wydanie 1.0 z listą zmian                  | Lista zmian wydania 1.0.0: [CHANGELOG.md](../../CHANGELOG.md) (wydanie w przygotowaniu).                                                                                                                                                                                                  |

## Jak sprawdzić samodzielnie

- **Uruchomienie lokalne:** instrukcja w [README.md](../../README.md), sekcja „Uruchomienie lokalne”. Polecenie `npm run db:seed:demo` zakłada konta demonstracyjne (odkrywcy i kuratorzy dwóch organizacji), a strona logowania poza trybem produkcyjnym pokazuje ich listę.
- **Testy odmowy dostępu:** katalog `tests/integration/` (na prawdziwej bazie PostgreSQL). Test `rls-coverage.test.ts` sprawdza, że każda tabela ma włączone reguły dostępu.
- **Historia zmian:** zakładka Pull requests na GitHubie i [dziennik zmian](../../CHANGELOG.md). Każdy PR zaczyna się wprowadzeniem po polsku: co zmienia, dlaczego i z czego wynika.

## Czego tu nie ma i dlaczego

- Strategii biznesowej, planów komercyjnych i analiz rynku: to materiały właściciela.
- Szczegółów ustaleń bezpieczeństwa: publikujemy liczby i stan poprawek, nie opis słabości, które mogłyby jeszcze być otwarte.
- Danych osobowych, sekretów i informacji o infrastrukturze serwera.
- Dzienników pracy agentów i decyzji właściciela w pełnej treści: tutaj są ich streszczenia.

Część kodu pochodzi z wcześniejszego projektu właściciela.

Dokumentacja opisuje stan z 28 listopada 2026 roku ; pełna, bieżąca lista scalonych zmian jest w [historii PR-ów repozytorium](https://github.com/MariuszSkowron/krajozbior/pulls?q=is%3Apr+is%3Amerged). Gdy opis i kod się różnią, rozstrzyga kod i testy.
