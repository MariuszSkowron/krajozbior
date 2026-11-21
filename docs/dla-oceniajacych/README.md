# Dla oceniających

## W skrócie

Ten folder jest punktem wejścia dla osób, które oceniają Krajozbiór w konkursie i nie znają projektu. Poniższa tabela prowadzi od każdego wymogu konkursu do miejsca w tym repozytorium, gdzie można go sprawdzić: pliku, testu albo PR-a (propozycji zmiany w kodzie, którą przed scaleniem ktoś sprawdza). Pełna dokumentacja projektu (decyzje właściciela, dzienniki pracy agentów, prywatne notatki bezpieczeństwa, plany biznesowe) zostaje w osobnym, prywatnym repozytorium; tutaj są jej jawne streszczenia, napisane od nowa. Oceniający nie potrzebują dostępu do tamtego repozytorium.

## Od czego zacząć

1. [Produkt](produkt.md): jaki problem rozwiązuje Krajozbiór, dla kogo jest, co wchodzi do wersji konkursowej i czego świadomie nie robimy.
2. [Backlog](backlog.md): epiki całego produktu i jeden pełny epik (E12 „Odkrywanie”) podzielony na historyjki z kryteriami akceptacji.
3. [Specyfikacja epiku E12](specyfikacja-e12-odkrywanie.md): jawna wersja specyfikacji tych historyjek z wynikiem przeglądu przez inny model.
4. [Stan realizacji](stan-realizacji.md): co już działa i co jest w planie.
5. [Architektura i ochrona danych](architektura-i-dane.md): jak aplikacja jest zbudowana i kto widzi jakie dane.
6. [Specyfikacje](specyfikacje.md): streszczenia pozostałych specyfikacji, według których powstał kod.
7. [Proces, przeglądy i bezpieczeństwo](proces-i-przeglady.md): jak pracują agenci AI, kto sprawdza ich zmiany i co wykazały przeglądy.
8. [Notatki bezpieczeństwa](../../security-notes.md): jakie uprawnienia ma agent, gdzie są sekrety i jak skończyła się próba prompt injection.

## Wymogi konkursu i gdzie je znaleźć

Numery z `#` to numery PR-ów w tym repozytorium (zakładka Pull requests na GitHubie).

### Produkt

| Wymóg                                                     | Gdzie to jest                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logowanie i co najmniej dwie role z różnymi uprawnieniami | Logowanie jednorazowym kodem z e-maila (`src/features/identity/`). Role: gość, odkrywca, kurator organizacji, administrator ([Produkt](produkt.md), „Kto korzysta”). Organizacje kuratorskie i nadawanie roli kuratora: #10; dziennik operacji: #22.                                                                                                                                                                                                        |
| Nikt nie widzi cudzych danych                             | Reguły dostępu do wierszy w bazie (RLS) i role bazy: [docs/data-isolation.md](../data-isolation.md). Test, że każda tabela ma włączone i wymuszone reguły: [`tests/integration/rls-coverage.test.ts`](../../tests/integration/rls-coverage.test.ts).                                                                                                                                                                                                        |
| CRUD (dodawanie, podgląd, edycja, usuwanie)               | Panel kuratora: tworzenie, edycja i kolejność kolekcji i miejsc, publikacja, wycofanie publikacji, usuwanie szkiców (#11, #13). Odkrywca: zapis i usunięcie kolekcji z albumu (#15, #16), lista „Chcę zobaczyć” (#18), wizyta z przeszłości z usuwaniem (#34), profil (#50), usunięcie konta (#43).                                                                                                                                                         |
| Logika biznesowa (reguły, walidacje, statusy)             | Statusy kolekcji (szkic, opublikowana, wycofana; kolekcji kiedykolwiek opublikowanej nie da się usunąć) w #11. Potwierdzenie wizyty: odległość i dokładność odczytu sprawdza baza, z promieniem ustawianym przez kuratora (#17). Wizyta z przeszłości z dokładnością daty i pierwszeństwem potwierdzenia na miejscu (#34). Postęp „9/24”, adres kolekcji ustalany przy pierwszej publikacji (#29), statystyki profilu (#54). Reguły: [Produkt](produkt.md). |

### Praca z agentami

| Wymóg                                                                | Gdzie to jest                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opis produktu i backlog: problem, dla kogo, MVP, czego nie robimy    | [Produkt](produkt.md) i [Backlog](backlog.md).                                                                                                                                                                                                                                                                                                                                                    |
| Co najmniej jeden epik z historyjkami i kryteriami akceptacji        | Epik E12 „Odkrywanie” (zadanie `docs#13`) z czterema historyjkami `docs#79`–`docs#82`: [Backlog](backlog.md#e12-odkrywanie-strona-główna-wyszukiwarka-mapa).                                                                                                                                                                                                                                      |
| Specyfikacje do historyjek epiku, każda przeglądana przez inny model | [Specyfikacja E12](specyfikacja-e12-odkrywanie.md): napisał ją Opus, przejrzał Sonnet, a poprawki sprawdził kolejny, niezależny agent. Pozostałe specyfikacje i ich przeglądy: [Specyfikacje](specyfikacje.md).                                                                                                                                                                                   |
| Uporządkowany `AGENTS.md`                                            | [AGENTS.md](../../AGENTS.md) (zasady pracy), [docs/agent-workflow.md](../agent-workflow.md) (przepływ od zadania do scalenia), [SDLC.md](../../SDLC.md).                                                                                                                                                                                                                                          |
| Skille, w tym co najmniej jeden dopasowany do projektu               | Własny skill projektu [`private-data`](../../.claude/skills/private-data/SKILL.md): prowadzi agenta przy każdej funkcji z danymi prywatnymi (klasyfikacja danych, migracja z RLS, test odmowy dostępu); poprawiony w #23. Pozostałe skille (`om-*`: specyfikacje, przeglądy, PR-y, testy) są w [`.claude/skills/`](../../.claude/skills/), wersje w [`skills-lock.json`](../../skills-lock.json). |
| Hook pilnujący wybranej zasady                                       | Sześć hooków w [`.claude/hooks/`](../../.claude/hooks/), każdy z testem w [`tests/scripts/`](../../tests/scripts/). Np. `require-rls-in-migration.mjs` blokuje migrację tworzącą tabelę bez reguł dostępu, a `block-shell-file-writes.mjs` (#33) blokuje zmianę plików poleceniami terminala. Tabela wszystkich hooków: [security-notes.md](../../security-notes.md).                             |
| PR zrobiony przez agenta na podstawie specyfikacji, z przeglądem     | Pięć PR-ów epiku E12: #38, #39, #40, #41, #49. Każdy przeszedł przegląd poziomu A innego agenta (Opus); wyniki: [Specyfikacja E12](specyfikacja-e12-odkrywanie.md#przeglądy-pr-ów-epiku). Wcześniej według specyfikacji ścieżki konkursowej: #10–#18 i #34.                                                                                                                                       |

### Jakość i bezpieczeństwo

| Wymóg                                                             | Gdzie to jest                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CI przy każdym PR: build, testy jednostkowe, integracja/E2E       | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml): zadanie `check` (formatowanie, lint, typy, testy jednostkowe z progiem pokrycia, build), `integration` (testy na prawdziwej bazie PostgreSQL), `e2e` (testy w przeglądarce na zbudowanej aplikacji), `gitleaks` (sekrety). Opis: [docs/testing.md](../testing.md).                                                                             |
| Test E2E tak, jak używa aplikacji użytkownik                      | [`e2e/competition-path.spec.ts`](../../e2e/competition-path.spec.ts): od utworzenia kolekcji przez kuratora do potwierdzenia wizyty przez odkrywcę. Pozostałe ścieżki w [`e2e/`](../../e2e/), m.in. wyszukiwarka, strona główna, mapa, usunięcie konta.                                                                                                                                                      |
| Test uprawnień: A nie dobierze się do danych B ani do cudzej roli | Integracja: [`tests/integration/`](../../tests/integration/), np. `catalog-access.test.ts` (kurator organizacji B kontra szkic organizacji A), `visits-access.test.ts` i `album-access.test.ts` (odkrywca B kontra dane odkrywcy A), `home-album-access.test.ts`, `search-access.test.ts`, `operations-audit-access.test.ts`. E2E z dwoma kontami: `e2e/album-access.spec.ts`, `e2e/catalog-access.spec.ts`. |
| `security-notes.md`                                               | [security-notes.md](../../security-notes.md) w katalogu głównym: uprawnienia agenta, miejsca sekretów bez ich treści, wynik próby prompt injection.                                                                                                                                                                                                                                                          |

### Mile widziane

| Element                                    | Stan                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design system                              | [docs/design/](../design/README.md), tokeny i komponenty w `src/design-system/`, podgląd w Storybooku (budowany w CI). Wygląd „nocny album”: #25, #28, #31.                                                                                                                               |
| Skanowanie sekretów i zależności w CI      | `gitleaks` na całej historii, `npm audit` dla zależności produkcyjnych (blokujące przy poziomie wysokim i krytycznym), analiza kodu CodeQL ([`.github/workflows/codeql.yml`](../../.github/workflows/codeql.yml)), Dependabot ([`.github/dependabot.yml`](../../.github/dependabot.yml)). |
| Aplikacja pod publicznym adresem, rollback | W przygotowaniu: obraz produkcyjny i konfiguracja serwera (#55), wysyłka kodów logowania (#57), strony prawne (#58), limity i logi bez danych osobowych (#60, #61). Opis: [docs/deployment.md](../deployment.md). Adres dopiszemy tutaj po uruchomieniu.                                  |
| Wydanie 1.0 z listą zmian                  | Planowane przed terminem konkursu.                                                                                                                                                                                                                                                        |

## Jak sprawdzić samodzielnie

- **Uruchomienie lokalne:** instrukcja w [README.md](../../README.md), sekcja „Uruchomienie lokalne”. Polecenie `npm run db:seed:demo` zakłada konta demonstracyjne (odkrywcy i kuratorzy dwóch organizacji), a strona logowania poza trybem produkcyjnym pokazuje ich listę.
- **Testy odmowy dostępu:** katalog `tests/integration/` (na prawdziwej bazie PostgreSQL). Test `rls-coverage.test.ts` sprawdza, że każda tabela ma włączone reguły dostępu.
- **Historia zmian:** zakładka Pull requests na GitHubie. Każdy PR zaczyna się wprowadzeniem po polsku; zadania z prywatnego repozytorium są oznaczone jako `docs#N`.

## Czego tu nie ma i dlaczego

- Strategii biznesowej, planów komercyjnych i analiz rynku: to materiały właściciela.
- Szczegółów ustaleń bezpieczeństwa: publikujemy liczby i stan poprawek, nie opis słabości, które mogłyby jeszcze być otwarte.
- Danych osobowych, sekretów i informacji o infrastrukturze serwera.
- Dzienników pracy agentów i decyzji właściciela w pełnej treści: tutaj są ich streszczenia.

Część kodu pochodzi z wcześniejszego projektu właściciela.

Dokumentacja opisuje stan z 21 listopada 2026 roku. Gdy opis i kod się różnią, rozstrzyga kod i testy.
