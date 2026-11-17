---
name: private-data
description: Wzorzec dla każdej funkcji, która dodaje lub zmienia dane prywatne użytkownika albo dane widoczne tylko dla roli z ograniczonym zakresem — nowa tabela lub kolumna z danymi osobistymi, nowy przypadek użycia, trasa API lub akcja serwera czytająca takie dane. Prowadzi od klasyfikacji danych przez migrację z RLS, przypadek użycia z kontrolą roli i adapter w kontekście użytkownika po wymagany test integracyjny odmowy dostępu. Użyj przed pisaniem migracji w src/lib/db/migrations/.
---

# Dane prywatne i dane roli z zakresem

## W skrócie

Obiecujemy, że nikt nie zobaczy cudzych danych prywatnych, a rola z zakresem widzi tylko swój zakres. Tę obietnicę trzymają dwie niezależne bariery: serwer sprawdza rolę, a baza (RLS, czyli reguły PostgreSQL ograniczające wiersze) sama odmawia dostępu, nawet gdy kod aplikacji się pomyli. Ten skill opisuje, jak dodać funkcję z danymi prywatnymi tak, żeby obie bariery powstały od razu i żeby test to udowodnił.

Źródła prawdy (przeczytaj, zanim zaczniesz): `docs/data-isolation.md` (klasy danych, role bazy, macierz polityk, wymagane testy), `docs/architecture.md`, `AGENTS.md`. Ten skill ich nie zastępuje — przy rozbieżności wygrywają one.

Przykłady poniżej używają wymyślonej tabeli `trip_notes` (prywatne notatki użytkownika); zamień na swoją.

## Kiedy używać

- Nowa tabela albo kolumna z danymi osobistymi lub danymi roli z zakresem.
- Nowy przypadek użycia, trasa `src/app/api/**` albo akcja serwera, która czyta lub zapisuje takie dane.
- Zmiana uprawnień istniejącej tabeli prywatnej (nowa operacja, nowy grant kolumnowy).

Nie używaj do danych w pełni publicznych — tam obowiązuje zapis przez `starter_ops` i polityka `SELECT` dla wszystkich.

Hook `.claude/hooks/require-rls-in-migration.mjs` blokuje migrację, która tworzy tabelę bez włączonego i wymuszonego RLS. Jeśli cię zatrzymał, wróć do kroku 2.

## Krok 1. Sklasyfikuj dane

Ustal klasę według `docs/data-isolation.md`, sekcja 2, i zapisz decyzję w specyfikacji:

| Klasa     | Kto czyta                                         | Kto zapisuje              | Mechanizm                                                                         |
| --------- | ------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| PRIV      | tylko właściciel                                  | tylko właściciel          | `privateTableSecuritySql()` z `src/lib/db/policies.ts`                            |
| CUR       | autor; rola z zakresem, gdy zasób jest w zakresie | autor; rola przez decyzję | nazwane funkcje `security definer`, bez bezpośredniego `UPDATE` dla `starter_app` |
| Publiczna | każdy, także gość                                 | `starter_ops`             | polityka `SELECT` dla wszystkich                                                  |

Role nie dziedziczą uprawnień: administrator nie jest rolą z zakresem, rola z zakresem nie jest zwykłym użytkownikiem. Zdecyduj, czego rola z zakresem **nigdy** nie widzi.

## Krok 2. Migracja: tabela razem z RLS

Plik `src/lib/db/migrations/MigrationYYYYMMDDHHMMSS_<slug>.ts` (`npm run db:migration:create`).

1. Tabela, ograniczenia (`CHECK`, unikalności, klucze obce) i indeks na `user_id` w **tej samej** migracji co RLS. Nigdy „RLS później”.
2. Uprawnienia minimalne — tylko operacje, których używa przypadek użycia:
   ```ts
   for (const statement of privateTableSecuritySql("trip_notes", {
     operations: ["select", "insert", "delete"],
   })) {
     this.addSql(statement);
   }
   ```
   Helper włącza i wymusza RLS (`FORCE` obejmuje też właściciela tabeli), odbiera wszystko `public`, nadaje `starter_app` tylko wskazane operacje i tworzy polityki właściciela z `WITH CHECK`.
3. `UPDATE` tylko na edytowanych kolumnach (grant kolumnowy). Nie nadawaj `UPDATE` na całą tabelę; `user_id` i klucze muszą być niezmienialne.
4. **Klucz obcy omija RLS.** Jeśli wiersz wskazuje inną tabelę z własnymi ograniczeniami widoczności, dodaj restrykcyjną politykę `INSERT`, która wymaga widocznego celu — inaczej ktoś, kto zna UUID niewidocznego wiersza, go przypnie:
   ```sql
   create policy trip_notes_target_insert on public.trip_notes
     as restrictive for insert to starter_app
     with check (exists (select from places p where p.id = trip_notes.place_id and p.is_published));
   ```
5. Wartości słownikowe w `CHECK` kopiuj do migracji jako zamrożone stałe, nie importuj z kodu domeny.
6. `down()`: tabele powiązane politykami usuwaj jedną instrukcją `drop table a, b`, bez `CASCADE`.
7. Funkcja `security definer` czytająca tabelę z `FORCE` potrzebuje wąskiej polityki dla `starter_owner` i jawnego `set search_path`; agregaty zwracają liczby, nie wiersze.

## Krok 3. Domena

`src/features/<feature>/domain/` — czyste funkcje i walidacja (Zod), bez Next.js i ORM. Próg pokrycia domeny to 100% na plik, więc każda gałąź walidacji ma test jednostkowy w `tests/features/<feature>/`. Tekst z formularza normalizuj (CRLF → LF) przed liczeniem długości.

## Krok 4. Przypadek użycia: najpierw rola, potem kontekst

`src/features/<feature>/application/` (wzór autoryzacji: `src/features/identity/application/authorize.ts`).

- Pierwszy krok: sprawdzenie roli aktora; błędy mapuj na wynik `{ status: "unauthenticated" | "forbidden" }`, nie rzucaj ich do warstwy HTTP.
- Dopiero potem `withUserContext(actor, (tx) => ...)` z `src/lib/db/user-context.ts`. Zależności (repozytorium, kontekst użytkownika, logger) przekazuj jawnie przez typ `<Feature>Deps`, żeby test integracyjny podał prawdziwą bazę.
- **Żaden przypadek użycia nie przyjmuje `userId` od wywołującego.** Właściciel to zawsze aktor z sesji.
- Zwracaj obiekty z jawnie wybranymi polami (bez `user_id` i bez danych autora dla roli z zakresem).

## Krok 5. Adapter bazy

`src/features/<feature>/infrastructure/postgres-*-repository.ts` pracuje wyłącznie na `tx.em` z kontekstu. Przy zapisie `user_id` ustawiaj w SQL jako `app_current_user_id()`, nie z parametru. Nigdy `SET` sesyjnego ani `set_config(..., false)`; nie otwieraj `withUserContext` wewnątrz innej transakcji (`NestedUserContextError`).

## Krok 6. Trasa API lub akcja serwera

Przed pisaniem sprawdź właściwy przewodnik w `node_modules/next/dist/docs/` (Next.js 16 różni się od wcześniejszych wersji).

- Sprawdź pochodzenie żądania przy zapisie (wzór: `src/features/identity/domain/origin.ts`).
- Aktor tylko z sesji po stronie serwera; ciało żądania nigdy nie wskazuje właściciela.
- Odpowiedzi z danymi prywatnymi: `Cache-Control: private, no-store`.
- Mapowanie: brak sesji → 401, zła rola → 403, cudzy lub niewidoczny zasób → 404 (nie zdradzaj, że istnieje), awaria → 503 bez szczegółów (`logFailure` z `src/lib/log-failure.ts`).

## Krok 7. Test integracyjny odmowy dostępu (wymagany)

`tests/integration/<feature>-access.test.ts`, na prawdziwym PostgreSQL, połączenie jako `starter_app`. Wzór do skopiowania: `tests/integration/private-data-isolation.test.ts` (harness: `tests/support/database-harness.ts`). Pokryj punkty z `docs/data-isolation.md`, sekcja 7:

- [ ] **Katalog:** `findRowLevelSecurityGaps(client, ["public.<tabela>"])` i `findApplicationRoleGaps(client)` zwracają `[]`.
- [ ] **Dokładne uprawnienia:** `has_table_privilege('starter_app', ...)` dla każdej operacji — dokładnie te z kroku 2, nic więcej (`truncate`, `references`, `trigger` = `false`).
- [ ] **Brak kontekstu:** bez `app.user_id` 0 wierszy, `INSERT` odrzucony.
- [ ] **A kontra B:** użytkownik B nie odczyta, nie zmieni i nie usunie wiersza A — także surowym SQL; `INSERT` z cudzym `user_id` kończy się `42501`.
- [ ] **Inne role:** rola z zakresem poza zakresem i administrator dostają `forbidden`/403 (role nie dziedziczą); gość — `unauthenticated`/401 przez prawdziwy handler trasy z podmienioną sesją.
- [ ] **Klucz obcy:** surowy `insert` wskazujący niewidoczny wiersz → `42501` (polityka z kroku 2.4).
- [ ] **Rola z zakresem (tylko CUR):** w zakresie widzi, poza zakresem — odmowa; nie zatwierdzi własnego wniosku.
- [ ] **Wyciek kontekstu:** pula `{ min: 1, max: 1 }`, kolejna transakcja na tym samym połączeniu nie dziedziczy aktora.
- [ ] **Migracja:** „revert + apply” przechodzi.

Fikstury tabel z ograniczoną polityką `INSERT` wstawiaj rolą, która ją ma (`FORCE` blokuje właściciela), pulę zamykaj przez `closePool()` z harnessu. Integrację uruchamiaj na osobnym klastrze, nigdy na bazie z `compose.yaml`.

Jeśli funkcja ma ekran, dodaj scenariusz E2E z dwoma kontami (konta demo z seeda), który pokazuje, że B nie widzi danych A.

## Krok 8. Dokumentacja i kontrole

1. Zaktualizuj `docs/data-isolation.md` w tym samym PR: klasa w sekcji 2, wiersz w macierzy w sekcji 5.
2. Dopisz nowe ścieżki funkcji (moduł w `src/features/<funkcja>/`, strony z danymi prywatnymi, testy odmowy dostępu poza `tests/integration/`) do `.github/CODEOWNERS` w tym samym PR. Trasy w `src/app/api/` i migracje mają już właściciela. Bez wpisu PR z danymi prywatnymi scaliłby się po samych statusach agentów (`docs/agent-workflow.md`, sekcja 3).
3. Test `tests/integration/rls-coverage.test.ts` sprawdza nową tabelę automatycznie; nie dopisuj jej do listy wyjątków.
4. Uruchom: `npm run check`, `npm run test:integration` (osobna baza, jak w CI), a przy zmianie UI `npm run test:e2e`. `check` nie uruchamia integracji — zmiana kształtu odpowiedzi bez przebiegu integracji nie jest gotowa.
5. Zapisz faktyczne wyniki w `<docs>/.ai/runs/YYYY-MM-DD-<slug>.md`. Nową lekcję dopisz do `<docs>/.ai/lessons.md`.

## Częste błędy

| Błąd                                       | Skutek                                                   | Jak uniknąć                                |
| ------------------------------------------ | -------------------------------------------------------- | ------------------------------------------ |
| Tabela teraz, RLS „w następnym PR”         | Okno, w którym `starter_app` widzi wszystko              | Krok 2; hook blokuje taki plik             |
| `ENABLE` bez `FORCE`                       | Właściciel i funkcje `security definer` omijają polityki | Helper albo oba polecenia                  |
| Filtr `WHERE user_id = ?` zamiast polityki | IDOR po pierwszym zapomnianym filtrze                    | Polityka w bazie + `app_current_user_id()` |
| Klucz obcy bez polityki restrykcyjnej      | Przypięcie niewidocznego wiersza                         | Krok 2.4 i test surowego `insert`          |
| `userId` w parametrze przypadku użycia     | Podmiana właściciela                                     | Aktor tylko z sesji                        |
| Test tylko „szczęśliwej ścieżki”           | Brak dowodu izolacji                                     | Lista z kroku 7                            |
