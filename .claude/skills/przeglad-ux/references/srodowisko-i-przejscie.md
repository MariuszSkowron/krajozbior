# Środowisko i przejście w przeglądarce

Krok 2 skilla `przeglad-ux`: jak uruchomić aplikację, zalogować się kontami demo i zbierać dowody, nie dotykając środowiska właściciela ani pracy innych agentów. Źródło prawdy: `docs/testing.md` (sekcja „Lokalne środowisko testowe (Windows)”) i `.ai/skills/om-prepare-test-env/SKILL.md`; przy rozbieżności wygrywają one.

## Czego nie wolno

- Używać portu 3000, bazy na 5432 ani pokazu lokalnego na 3300 — należą do właściciela.
- Pracować w kopii repozytorium, w której pracuje inny agent. Przegląd uruchamiasz we własnym worktree albo na własnym stanowisku `ws-N`: `test-env-down.ps1` zatrzymuje środowisko całego stanowiska, a tymczasowy spec widzą lint, Prettier i `git add` wszystkich, którzy pracują w tej kopii.
- Czytać `.env*` ani `.data/test-env/<stanowisko>/test-env.env` (jednorazowe hasła). Hasło kont demo trafia do przeglądarki wyłącznie przez proces uruchomiony skryptem `test-env-test.ps1`.
- Wykonywać `git add`, commita ani pushu w repozytorium kodu.
- Uruchamiać drugiego lokalnego przebiegu E2E, gdy trwa inny (skrypt i tak czeka na blokadę `Global\krajozbior-test-env-e2e`).
- Zostawiać działającego środowiska po przeglądzie.

## Start

1. Ustal stanowisko i porty: `node scripts/test-env/test-env-station.mjs config` (główna kopia: aplikacja 3100; `ws-N`: 3100+N).
2. Zacznij od świeżego środowiska: `powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-down.ps1`.
3. Wymaga uruchomionego Docker Desktop. Gdy go nie ma, przegląd kończy się wynikiem **Niepełny** z blokerem „brak Dockera”.

## Przejście: tymczasowy spec Playwright, rozbudowywany krok po kroku

Narzędziem przeglądarki projektu jest Playwright (`.ai/agentic.config.json`, dostawca `playwright`). Skrypt `test-env-test.ps1` przyjmuje tylko pliki `e2e/…*.spec.ts`, więc przejście zapisujesz jako tymczasowy spec (wyjątek od ogólnej reguły opisany w `.ai/browsers/playwright.md`; `.gitignore` pomija pliki z tym przedrostkiem). Nie piszesz go z góry dla całej ścieżki: zawahanie widać tylko wtedy, gdy patrzysz na ekran, zanim zdecydujesz, co kliknąć.

1. Utwórz `e2e/tymczasowy-przeglad-ux-<data>.spec.ts` (narzędziem Write). Przedrostek `tymczasowy-przeglad-ux-` jest obowiązkowy: po nim każdy rozpozna plik, który nie może trafić do commita. Spec:
   - bierze hasło kont demo z `process.env.DEMO_ACCOUNT_PASSWORD` i loguje się formularzem na `/login` (wzór logowania: `e2e/login.spec.ts`),
   - używa lokatorów po roli, etykiecie i tekście (bez zgadywania selektorów CSS),
   - zapisuje zrzuty `page.screenshot({ path, fullPage: true })` wprost do `.ai/tmp/przeglad-ux/zrzuty/` (katalog ignorowany przez git), pod nazwami `<rola>-<ekran>-<wariant>-<krok>.png`,
   - zapisuje komunikaty konsoli oraz adres i kod statusu odpowiedzi 4xx/5xx (bez treści odpowiedzi) do pliku JSON w tym samym katalogu,
   - ustawia warianty przez `page.setViewportSize`, `page.emulateMedia({ reducedMotion })` i `context.setOffline`,
   - nie używa `expect` jako „oceny UX”: asercje tylko pilnują, że krok się wykonał; ocenę robisz ty, patrząc na zrzuty.
2. **Pierwszy przebieg** dla każdej roli: tylko logowanie i zrzut ekranu startowego, bez żadnej akcji. Obejrzyj zrzut i zapisz, czy wiesz, co kliknąć, żeby wykonać zadanie; jeśli nie, to ustalenie.
3. **Kolejne przebiegi**: dopisz najwyżej jedno zadanie jednej roli (ekran, decyzja, jedna akcja, zrzut po akcji), uruchom, obejrzyj i dopiero potem dopisz następny krok. Nie łącz całej ścieżki w jeden skrypt. Każdy krok to osobny `test(...)`; kroki niezależne uruchamiaj filtrem `-g`.
4. Uruchom: `powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-test.ps1 e2e e2e/tymczasowy-przeglad-ux-<data>.spec.ts --output .ai/tmp/przeglad-ux/wyniki`. Przed kolejnym przebiegiem, który zmienia dane kont demo, uruchom `test-env-down.ps1`, bo ponowne użycie kont daje fałszywe porażki.
5. Obejrzyj zrzuty (narzędzie Read na plikach PNG).
6. Po przeglądzie: skopiuj wybrane zrzuty do katalogu raportu w `<docs>/.ai/qa/`, usuń spec jednym poleceniem usunięcia pliku, uruchom `test-env-down.ps1`. Katalogu `.ai/tmp/przeglad-ux/` nie usuwasz rekurencyjnie: zostaw go i wypisz w raporcie.
7. Uruchom `git status` w repozytorium kodu. Wynik ma być czysty; wpisz go do raportu. Jeśli coś zostało, wypisz pliki w raporcie i niczego nie commituj.

`globalSetup` Playwrighta wstawia przy starcie fikstury testowe. To dane demo, ale pamiętaj o nich, oceniając „pusty stan” — konto, które ma fikstury, nie jest puste.

## Warianty w specu

- **Motyw.** Aplikacja wybiera motyw z ciasteczka `krajozbior-theme` (wartość `light` daje motyw jasny, każda inna i brak ciasteczka — nocny; `src/app/shell/theme.ts`). Motyw jasny włączasz przełącznikiem w nagłówku (jest też dla gościa) albo ustawiasz ciasteczko przez `context.addCookies` przed otwarciem strony. Emulacja `prefers-color-scheme` nic tu nie zmienia i dałaby dwa identyczne zrzuty. Po zalogowaniu aplikacja przywraca motyw zapisany na koncie, a przełącznik u zalogowanego zapisuje wybór na koncie demo. Dla ról zalogowanych ustawiaj ciasteczko po zalogowaniu i przed każdym zrzutem sprawdzaj aktywny motyw.
- **Lokalizacja.** Potwierdzenie wizyty wymaga uprawnienia: `context.grantPermissions(["geolocation"])` i `context.setGeolocation({ latitude, longitude })` (w promieniu miejsca i poza nim). Odmowę dostępu sprawdzasz w kontekście bez nadanego uprawnienia.
- **Mapa.** Kafelki OpenStreetMap ładujesz najwyżej raz na rolę i szerokość ekranu. W pozostałych przebiegach blokujesz żądania kafelków przez `page.route` (adres serwera kafelków odczytaj z komponentu mapy w `src/`). Zdjęcia z Wikimedia Commons pobiera serwer aplikacji, nie przeglądarka.

## Dowody

- Każde ustalenie ma co najmniej jeden zrzut; ustalenie o akcji ma zrzut przed i po.
- Zrzut pokazuje cały ekran w danym wariancie; jeśli problem jest mały, dodaj drugi, przycięty do fragmentu.
- Nazwa zrzutu mówi, co przedstawia; w raporcie link względny do pliku.
- Błędy konsoli i odpowiedzi 5xx z przejścia to osobne ustalenia (wysokie lub krytyczne): adres, kod statusu i komunikat konsoli bez danych osobowych.

## Gdy coś nie działa

| Objaw | Co zrobić |
|---|---|
| Logowanie kontem demo odrzucone | Sprawdź, czy środowisko jest świeże (`test-env-down.ps1`); serwer musi mieć flagę kont demo, którą ustawia `playwright.config.ts`. Nie obchodź logowania. |
| Skrypt odrzuca argumenty | Dozwolone są tylko ścieżki `e2e/…*.spec.ts`, `-g <tekst>` i `--output <katalog w repo>` (`scripts/test-env/test-env-args.mjs`). |
| Zajęty port | Skrypt sam wybiera wolny port; adres odczytaj z `.data/test-env/<stanowisko>/test-env.json`. |
| Potwierdzenie wizyty nie reaguje na lokalizację | Sprawdź, czy kontekst ma nadane uprawnienie `geolocation`. |
| Sesja wygasła w trakcie | Zapisz to jako ustalenie, jeśli użytkownik nie dostał jasnego komunikatu, i zacznij ścieżkę od nowa. |
