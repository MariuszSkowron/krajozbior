# Cykl życia zmian

## W skrócie

Praca przechodzi od zadania w prywatnym repozytorium dokumentacji, przez specyfikację, implementację, dwa przeglądy (kod i bezpieczeństwo) i poprawki, do automatycznego scalenia w GitHub. Zmiany wrażliwe czekają na zatwierdzenie właściciela. Role, poziomy przeglądu, statusy i polecenia opisuje [docs/agent-workflow.md](docs/agent-workflow.md); ten plik podaje kolejność i warunki przejścia. Streszczenie dla osób spoza projektu, z wynikami przeglądów: [Proces, przeglądy i bezpieczeństwo](docs/dla-oceniajacych/proces-i-przeglady.md).

<!-- discovery:start -->

## Discovery i Definition of Ready

Przed utworzeniem zadania właściciel produktu potwierdza brief: problem, użytkowników, zakres „teraz / później / nie robimy”, reguły, decyzje oraz sposób sprawdzenia wyniku. Materiały badawcze i decyzje trafiają do `<docs>/.ai/specs/research/` (`<docs>/` to repozytorium dokumentacji obok, `AGENTS.md`); `om-discover --refresh` aktualizuje brief, a `om-backlog` tworzy zadania dopiero z gotowego briefu.

### Definition of Ready

Zadanie jest gotowe do implementacji, gdy zawiera albo odsyła do specyfikacji z następującymi elementami.

**Na poziomie zadania:**

- problem lub potrzebę oraz rolę, której dotyczy;
- oczekiwany wynik i sposób jego sprawdzenia;
- zakres wyłączony z zadania;
- pytania otwarte oznaczone jako blokujące lub nieblokujące; żadne blokujące pytanie nie pozostaje bez odpowiedzi;
- decyzje potrzebne do realizacji, z właścicielem i statusem `active`;
- potwierdzone przez człowieka założenia automatyczne, jeśli występują.

**Na poziomie specyfikacji:**

- kryteria akceptacji;
- reguły biznesowe;
- ścieżkę główną i kluczowe sytuacje błędne;
- wpływ na dane, prywatność i uprawnienia;
- zależności oraz, dla interfejsu, odnośnik do prototypu lub mockupu.

Defekt musi dodatkowo dać się odtworzyć. Braki specyfikacji można uzupełnić przed implementacją, ale brak elementu poziomu zadania zatrzymuje przyjęcie zadania do pracy.

### Decyzje produktu jako chroniony kontrakt

Po odświeżeniu briefu jego non-goals, reguły biznesowe i decyzje otrzymują stabilne identyfikatory, właściciela, status oraz sposób zmiany. Pull Request nie może im przeczyć bez jawnej decyzji zastępującej, zapisanej w `<docs>/docs/decisions.md` przed scaleniem.

<!-- discovery:end -->

## Etapy

| Nr  | Etap                                     | Gdzie                                                           | Warunek przejścia dalej                                                                                                                                                                                                                                            |
| --- | ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Zadanie**                              | issue w repozytorium dokumentacji                               | spełnia Definition of Ready                                                                                                                                                                                                                                        |
| 2   | **Specyfikacja** (przy złożonej zmianie) | `<docs>/.ai/specs/YYYY-MM-DD-slug.md`                           | wymagania `[Z]`, propozycje `[P]`, pytania otwarte i decyzje techniczne rozdzielone; blokujące pytania rozstrzygnięte                                                                                                                                              |
| 3   | **Implementacja**                        | gałąź robocza na stanowisku `ws-N`, draft PR                    | `npm run check` i testy ukierunkowane zielone lokalnie; run w `<docs>/.ai/runs/`                                                                                                                                                                                   |
| 4   | **Przegląd**                             | komentarze w PR, raport bezpieczeństwa w `<docs>/.ai/security/` | statusy `agent-review` i `security-review` ustawione na bieżącym commicie                                                                                                                                                                                          |
| 5   | **Poprawki**                             | ten sam PR, jeden push                                          | uwagi drobne poprawione; poważne rozstrzygnięte z właścicielem; poprawki zweryfikowane (poziom A: niezależny agent)                                                                                                                                                |
| 6   | **Scalenie**                             | GitHub                                                          | przebieg CI po ostatnim pushu zakończony i zielony → `gh pr ready` → `gh pr merge <n> --auto --squash`; GitHub scala przy zielonych `gitleaks`, `check`, `integration`, `e2e`, `guard`, `agent-review`, `security-review`, rozwiązanych wątkach i aktualnej gałęzi |
| 7   | **Po scaleniu**                          | repozytorium dokumentacji, pozostałe PR-y                       | zadanie zamknięte, specyfikacja w `implemented/`, pozostałe PR-y zaktualizowane o `main` (merge, nie rebase)                                                                                                                                                       |

Od 2026-11-21 (decyzja D-39) każdy PR czeka na zatwierdzenie właściciela, bo `.github/CODEOWNERS` wskazuje go domyślnie dla całego repozytorium; jawna lista ścieżek wrażliwych (logowanie i trasy API, uprawnienia i reguły dostępu do danych, wszystkie migracje, konfiguracja bezpieczeństwa, zależności i PR-y Dependabota, skrypty, CI, ustawienia i skille agentów) wyznacza przegląd poziomu A. Wymusza to `.github/CODEOWNERS` razem z rulesetem. To jest granica bezpieczeństwa; statusy `agent-review` i `security-review` są tylko bramką wygody (`docs/agent-workflow.md`).

## Zasady stałe

- Wynik lokalny nie zastępuje CI. Nie opisuj niewykonanej kontroli jako zielonej.
- Nie wypychaj i nie oznaczaj PR jako gotowego w jednym ruchu; nigdy nie scalaj przy wszystkich checkach pominiętych.
- Publiczny PR nie zawiera treści prywatnych: zadanie to `docs#N`, ustalenia bezpieczeństwa są tylko w `<docs>`.
- Specyfikację wykonaną przenieś do `<docs>/.ai/specs/implemented/`, a zastąpioną lub porzuconą do `<docs>/.ai/specs/archive/`. Wniosek przydatny dla kolejnych zmian dodaj do `<docs>/.ai/lessons.md` albo osobnego pliku w `<docs>/.ai/lessons/`, bez duplikatów i sekretów. Runy i specyfikacje nie zawierają transkrypcji rozumowania.

Pipeline agentów konfiguruje `.ai/agentic.config.json` (skille w `.agents/skills/`, dowiązane w `.claude/skills/`; lokalne rozszerzenia w `.ai/skills/`). Mapowanie skilli `om-*` na etapy i ich ograniczenia opisuje `docs/agent-workflow.md`, sekcja 6.
