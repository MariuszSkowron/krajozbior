# Standardy inżynierskie

## W skrócie

Dokument rozdziela obowiązujące dziś zasady pracy od wymagań, które trzeba spełnić przy implementacji funkcji. Opis wymagania nie potwierdza, że kontrola jest już zaimplementowana. Najważniejsze: najmniejsza zmiana spełniająca specyfikację, weryfikacja z faktycznym statusem w runie i autoryzacja zawsze po stronie serwera.

## Obowiązuje w repozytorium teraz

- Dokumentacja po polsku, nazwy plików i identyfikatory w kodzie po angielsku.
- Złożona zmiana ma krótką specyfikację w `<docs>/.ai/specs/`; po pracy zapisuje się adekwatną weryfikację w `<docs>/.ai/runs/`.
- Zachowuj istniejące zmiany użytkownika. Bez destrukcyjnych operacji, push i merge; zasady dotyczące sekretów opisuje sekcja „Zależności, konfiguracja i sekrety”.
- Nie ogłaszaj testów jako zaliczonych, jeśli ich nie uruchomiono; w runie zapisz zmiany, wyniki, blokery i następny krok według sekcji „Weryfikacja i raport w runie”.

### Źródła prawdy i konflikty

- Nie zakładaj, że dokumentacja opisuje aktualny stan implementacji. Stan systemu ustalaj na podstawie kodu, migracji, konfiguracji i testów.
- Wymagania funkcjonalne wynikają z zaakceptowanej specyfikacji zadania, zgodnej z `<docs>/docs/product.md` i `<docs>/docs/decisions.md`. Makiety i `docs/design/` nie są źródłem wymagań.
- Jeżeli specyfikacja, kod, testy, migracje lub dokumentacja są sprzeczne, nie rozwiązuj konfliktu przez zgadywanie. Wskaż rozbieżność (pliki i treść sprzeczności) w `<docs>/.ai/runs/`; pytanie wymagające decyzji produktowej przenieś do `<docs>/docs/decisions.md`.
- Nie zmieniaj testu tylko dlatego, że nie pasuje do nowej implementacji. Najpierw ustal, czy błędny jest test, implementacja czy specyfikacja, i zapisz ustalenie w runie.
- Przy nierozstrzygniętej sprzeczności wybierz najbezpieczniejszą zmianę, która nie rozszerza zakresu zadania ani nie osłabia kontroli bezpieczeństwa i prywatności.

### Rozpoznanie przed zmianą

- Przed zmianą znajdź w repozytorium istniejące implementacje tego samego lub podobnego wzorca i zastosuj je zamiast tworzyć nowe podejście.
- Sprawdź aktualne typy, migracje, testy, konfigurację i zależności zmienianego obszaru.
- Nie zakładaj istnienia biblioteki, API, tabeli, kolumny, zmiennej środowiskowej, funkcji ani konfiguracji. Zweryfikuj je w repozytorium (`package.json`, kod, migracje, `.env.example`).
- Przed zmianą kodu Next.js przeczytaj właściwy przewodnik z `node_modules/next/dist/docs/` i uwzględnij wersję zainstalowaną w repo.
- Dla złożonej zmiany przed implementacją zapisz w specyfikacji dotknięte granice systemu i kryteria akceptacji. Prosta zmiana nie wymaga osobnego planu.

### Zakres zmiany

- Implementuj najmniejszą zmianę wystarczającą do spełnienia zaakceptowanej specyfikacji i kryteriów akceptacji.
- Nie wykonuj refaktoryzacji niezwiązanych bezpośrednio z zadaniem; zauważony problem spoza zakresu zapisz w runie jako następny krok.
- Nie zmieniaj architektury, publicznych kontraktów API, bibliotek ani modelu danych, jeśli zadanie tego nie wymaga.
- Nie twórz abstrakcji dla hipotetycznych przyszłych przypadków użycia.

### Zależności, konfiguracja i sekrety

- Nową zależność dodawaj tylko wtedy, gdy istniejący kod, platforma ani zainstalowane biblioteki nie rozwiązują problemu rozsądnie prościej.
- Dodanie lub istotną aktualizację zależności uzasadnij w specyfikacji lub runie.
- Nie zmieniaj `package-lock.json` bez odpowiadającej zmiany zależności w `package.json`.
- Każdą nową zmienną środowiskową opisz w `.env.example` bez rzeczywistych wartości sekretów.
- Nie zapisuj sekretów, kluczy, tokenów ani danych uwierzytelniających w kodzie, testach, fixture'ach, dokumentacji, logach ani `<docs>/.ai/runs/`.

### Weryfikacja i raport w runie

- Każdą wymaganą weryfikację zapisz w `<docs>/.ai/runs/` z dokładnym poleceniem i jednym statusem:
  - `passed` — wyłącznie po rzeczywistym uruchomieniu weryfikacji zakończonej powodzeniem;
  - `failed` — weryfikację uruchomiono i zakończyła się niepowodzeniem; podaj, co nie przeszło;
  - `blocked` — weryfikacji nie dało się wykonać; podaj konkretną przyczynę (np. brak Dockera lub bazy). Wynik NOT RUN z `docs/testing.md` zapisuj jako `blocked`;
  - `not applicable` — weryfikacja nie dotyczy zmiany; podaj krótkie uzasadnienie.
- Nie traktuj `blocked` ani `not applicable` jako `passed`.
- Run jasno pokazuje, co faktycznie sprawdzono, czego nie sprawdzono i jakie blokery pozostały.

## Wymagane przy implementacji funkcji

### Struktura i zależności

- Stosuj `src/app` dla routingu i cienkich handlerów, `src/features` dla logiki domen i przypadków użycia, `src/design-system` dla współdzielonego UI (zob. `docs/design/architecture.md`) oraz `src/lib` dla infrastruktury. Testy trzymaj w `tests` i `e2e`.
- Nazwy domen, plików i eksportowanych typów są po angielsku. Komponenty i typy używają `PascalCase`, funkcje i zmienne `camelCase`, stałe `UPPER_SNAKE_CASE` tylko dla faktycznych stałych. Pliki routingu zachowują konwencje Next.js; pozostałe pliki używają `kebab-case`.
- Importy z aliasem `@/` stosuj dla granic między obszarami, importów do wspólnej infrastruktury i długich ścieżek. Krótkie importy względne są dopuszczalne wewnątrz modułu. Unikaj cykli i re-eksportów bez potrzeby.
- Endpointy leżą pod `/api` w strukturze aplikacji, zasoby nazywaj po angielsku w liczbie mnogiej, identyfikatory umieszczaj w segmentach ścieżki, a operacje zapisu wykonuj metodą HTTP. Handler waliduje, autoryzuje, deleguje i mapuje odpowiedź — bez reguł domeny.
- Tabele i kolumny PostgreSQL mają nazwy `snake_case`. Nie używaj nazw zależnych od lokalnego języka ani etykiet UI jako identyfikatorów bazy.
- Przekazuj zależności jawnie do funkcji i przypadków użycia. Nie dodawaj kontenera DI, generycznego frameworka CRUD ani globalnych ukrytych singletonów domenowych.

### Granice zaufania i błędy

- Błąd bazy po wyjściu z kontekstu użytkownika (`runInUserContext`, `runInGuestContext`) czytaj tylko przez `code` (SQLSTATE) i `constraint`, nigdy przez `message` ani `detail`: w produkcji tych pól nie ma (wartości użytkownika nie mogą trafić do dziennika), w testach są (`src/lib/db/database-error.ts`). Ta sama zasada dotyczy dziennika biblioteki logowania: `createAuth` podaje jej `authLogger` (`src/features/identity/infrastructure/auth-logger.ts`), który wypisuje tylko nazwę błędu i SQLSTATE; nie dodawaj do biblioteki własnych wywołań `console` z całym błędem.
- Waliduj każdą konfigurację zewnętrzną i dane wejściowe po stronie serwera schematami Zod; typy przeglądarki nie zastępują walidacji żądania.
- Zwracaj stabilne kody błędów i bezpieczne komunikaty. Nie ujawniaj SQL, ścieżek, tokenów, sekretów, konfiguracji, stosów ani danych osobowych. Szczegóły diagnostyczne loguj wyłącznie po stronie serwera z redakcją pól wrażliwych.
- Sprawdzaj autoryzację na serwerze przy każdym żądaniu. Dla operacji osobistych weryfikuj właściciela; dla operacji roli z zakresem weryfikuj rolę i dopasowanie zakresu do zasobu. Ukrycie elementu UI nie jest zabezpieczeniem.
- Dane prywatne izoluj na warstwie bazy (RLS) oraz w zapytaniach serwerowych (`docs/data-isolation.md`). Rola nie dziedziczy uprawnień innej roli.
- Zabroń samozatwierdzania: autor wniosku nie zatwierdza własnego wniosku jako rola decyzyjna. Sprawdzenie wykonuj na serwerze i, gdzie to możliwe, w regule bazy.

### Baza i współbieżność

- Wszystkie zmiany schematu przechodzą przez wersjonowane migracje. Utrzymuj FK, `NOT NULL`, `CHECK` i unikalności dla niezmienników domeny. Dodawaj indeksy dla FK, właściciela i kolumn używanych w filtrach.
- Nie zmieniaj schematu produkcyjnego ręcznym DDL ani `schema:update`; migracje muszą dać się przeglądać i odtworzyć. Migracja z politykami RLS ma test „revert + apply” (`down()` i ponowne `up()`).
- Tabela z danymi prywatnymi powstaje w tej samej migracji co jej RLS (`privateTableSecuritySql`); pilnuje tego hook `require-rls-in-migration`.
- Do zapytania `tx.em.execute` trafiają wyłącznie wartości (parametry `?`), nigdy nazwy tabel, kolumn ani kierunku sortowania z danych użytkownika; element zapytania, który nie jest wartością, wybierasz ze stałej listy w kodzie. Wartość przed zapytaniem przechodzi walidację typu i długości. Cytowanie wartości robi biblioteka, więc ochrona zależy od obu warunków naraz. Nowe zapytanie z tekstem użytkownika ma test na prawdziwej bazie ze znakami specjalnymi (apostrof, ukośnik wsteczny, `?`, `:`, `$1`, `--`); wzór: `tests/integration/search-access.test.ts`.
- Operacje wieloetapowe, które muszą się udać razem, wykonuj w jednej transakcji. Chroń zapis przed nieaktualnym stanem (wersja rekordu lub warunek aktualizacji); konflikt zwracaj jako konflikt do ponownego odczytu (np. HTTP 409), nie nadpisuj po cichu.

### Interfejs

- UI jest po polsku (chyba że `<docs>/docs/product.md` stanowi inaczej), mobile-first i responsywny. Stosuj semantyczny HTML, obsługę klawiatury, widoczny fokus, etykiety kontrolek i komunikaty dostępne dla technologii asystujących (`docs/design/accessibility.md`).
- Każdy ekran danych ma stany ładowania, pusty i błędu; formularz pokazuje walidację oraz wynik akcji bez utraty kontekstu. Nie przedstawiaj dekoracyjnych przycisków jako działających funkcji.
- Nie zapisuj lokalizacji urządzenia ani innych danych z czujników bez świadomej zgody użytkownika.

### Testy

- Testuj czystą logikę domeny i dozwolone oraz niedozwolone przejścia stanów.
- Testuj uprawnienia właściciela i ról, zakaz samozatwierdzania oraz brak odczytu cudzych danych.
- Testami integracji sprawdzaj RLS, transakcje, konflikty aktualizacji, migracje i granice API.
- Testuj błędne wejście i bezpieczny kształt błędu, także bez ujawniania szczegółów infrastruktury.
- Testy zależne od czasu używają sztucznego zegara; test „nie zadziała” musi dać się wywrócić (`<docs>/.ai/lessons.md`).

## Definition of Done

Zmiana spełnia specyfikację i kryteria akceptacji; kontrole serwerowe nie polegają na UI; migracje są kompletne; testy właściwe dla domeny, uprawnień i integracji, lint, typecheck i build mają status `passed` albo uzasadniony status `blocked` lub `not applicable`; dokumentacja jest aktualna; run zawiera statusy wszystkich wymaganych weryfikacji i pozostałe blokery zgodnie z sekcją „Weryfikacja i raport w runie”. Zmiana z weryfikacją `failed` lub z weryfikacją bez statusu nie jest ukończona. Zmiana z weryfikacją `blocked` nie jest zgłaszana jako w pełni zweryfikowana — handoff wymienia blokery wprost.
