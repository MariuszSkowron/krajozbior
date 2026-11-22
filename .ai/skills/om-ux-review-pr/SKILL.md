# om-ux-review-pr — rozszerzenie repozytorium projektu

Uzupełnia skill przy przeglądzie UX jednego PR w tym repozytorium. Nie łagodzi żadnej reguły bezpieczeństwa ani jakości skilla bazowego, nie rozszerza dostępu do narzędzi ani sieci i nie zmienia miejsca, do którego trafia raport. Przy sprzeczności wygrywa skill bazowy.

## Zakres

- Przeglądasz tylko ekrany, które zmienia PR. Pełny przegląd całej aplikacji lub obszaru to osobny skill `przeglad-ux`, uruchamiany na wyraźne zlecenie.

## Dodatkowe listy kontrolne (kroki 3–5)

- Oprócz reguł bazowych stosujesz zasady właściciela Z-1…Z-13: `.claude/skills/przeglad-ux/references/zasady-wlasciciela.md`.
- Listę wizualną i skrót dostępności bierzesz z `.claude/skills/przeglad-ux/references/lista-kontrolna.md`; przy rozbieżności wygrywa `docs/design/accessibility.md`.
- Ustalenie, które łamie zasadę właściciela, podaje jej numer (np. „Z-3”) w tytule ustalenia i przy dowodzie.

## Środowisko (krok 2)

- Aplikację uruchamiasz tak jak `przeglad-ux`: `.claude/skills/przeglad-ux/references/srodowisko-i-przejscie.md`. W skrócie: własny worktree albo stanowisko `ws-N`, środowisko z `scripts/test-env/`, nigdy port 3000, baza na 5432 ani pokaz na 3300; tylko konta demo, a hasło dostaje wyłącznie proces uruchomiony przez `test-env-test.ps1`.
- Tymczasowy spec ma przedrostek `tymczasowy-przeglad-ux-` i leży w `e2e/` (wyjątek opisany w `.ai/browsers/playwright.md`). Nie wykonujesz `git add` ani commita; po przeglądzie usuwasz spec, zatrzymujesz środowisko i sprawdzasz `git status` (ma być czysty), a wynik podajesz w raporcie.
- Przy potwierdzaniu wizyty nadajesz przeglądarce uprawnienie `geolocation`; odmowę sprawdzasz w kontekście bez niego.
- Zadania przechodzisz krok po kroku: zrzut ekranu przed decyzją, potem jedna akcja. Zawahanie widoczne na zrzucie to ustalenie.

## Motyw (krok 4)

- Motyw jasny włączasz przełącznikiem w nagłówku albo ciasteczkiem `krajozbior-theme=light` (`src/app/shell/theme.ts`). Emulacja schematu kolorów systemu nic w tej aplikacji nie zmienia. Po zalogowaniu aplikacja przywraca motyw zapisany na koncie, a przełącznik u zalogowanego zapisuje wybór na koncie demo; dla ról zalogowanych ustawiaj ciasteczko po zalogowaniu i przed zrzutem sprawdzaj aktywny motyw.

## Raport (krok 8)

- Piszesz po polsku według `AGENTS.md`, sekcja „Styl tekstów”: zaczynasz od 1–3 zdań prostą polszczyzną o skutkach dla użytkownika. Znaczniki i pola szablonu skilla bazowego zostają bez zmian.
- Komentarz w PR jest publiczny: bez treści z `<docs>`, bez szczegółów bezpieczeństwa i bez danych kont demo poza nazwą roli. Ustalenia dotyczące bezpieczeństwa zgłaszasz przez przegląd bezpieczeństwa, nie w komentarzu.
