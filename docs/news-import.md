# Wgrywanie aktualności redakcji z pliku (polecenie operatora)

## W skrócie

Przed konkursem aktualności publikuje tylko zespół Krajozbioru, z pliku. Polecenie `npm run news:import` wczytuje plik NDJSON (jedna aktualność w linii) i zapisuje go **w całości albo wcale**: gdy choć jedna linia jest błędna albo baza odmówi zmiany, żadna aktualność się nie zmienia. Ten sam plik wgrany drugi raz niczego nie zmienia. Tym samym plikiem można też wycofać aktualność (`"status":"withdrawn"`). Na serwerze polecenie uruchamia tryb `wdroz.ps1 -Aktualnosci` (opis: `docs/deployment.md`); na pokazie ten sam tryb działa bez pytania „tak/nie”. Specyfikacja: sekcja 14 specyfikacji E7 (repozytorium dokumentacji).

## Format pliku

Jedna linia to jedna aktualność w stanie docelowym. Kodowanie UTF-8 bez BOM, plik do 2 MiB, najwyżej 200 aktualności; puste linie są pomijane.

```json
{
  "id": "<uuid>",
  "kind": "guide",
  "title": "…",
  "lead": "…",
  "body": "…",
  "collection_slug": null,
  "place_id": null,
  "event_starts_on": null,
  "event_ends_on": null,
  "status": "published"
}
```

| Pole                               | Zasada                                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                               | UUID nadany raz przez agenta i nigdy niezmieniany; po nim polecenie rozpoznaje aktualność (dodanie, zmiana, „bez zmian”)                                  |
| `kind`                             | `new_place`, `info_change`, `event`, `guide`, `community`                                                                                                 |
| `title`, `lead`, `body`            | długości i znaki jak w domenie (`src/features/news/domain/`): tytuł 5–120, wstęp 1–280, treść do 5000 znaków, najwyżej 5 linków `https://`, bez skracaczy |
| `event_starts_on`, `event_ends_on` | tylko dla `event` (data początku obowiązkowa), format `RRRR-MM-DD`                                                                                        |
| `collection_slug`                  | opcjonalny adres opublikowanej kolekcji redakcji; polecenie zamienia go na identyfikator w tej samej transakcji; pola `collection_id` nie ma w formacie   |
| `place_id`                         | opcjonalne UUID miejsca (miejsca nie mają adresu)                                                                                                         |
| `status`                           | `draft`, `published` albo `withdrawn`                                                                                                                     |

Nieznane pole w linii jest błędem (literówka w nazwie nie może zniknąć po cichu). Adres strony (`slug`) powstaje z tytułu przy pierwszej publikacji i potem się nie zmienia, także po poprawce tytułu i po wycofaniu; przy powtórzonym tytule dostaje przyrostek `-2`, `-3`. Aktualności, których w pliku nie ma, polecenie nie rusza.

Dozwolone przejścia: `draft → draft`, `draft → published`, `published → published` (edycja), `published → withdrawn`, `withdrawn → withdrawn`, `withdrawn → published`. Nowa aktualność może zaczynać jako `draft` albo `published`; powrót do `draft` po publikacji jest odmową `invalid_transition`.

**Powiązanie z kolekcją.** Rola `krajozbior_ops` nie czyta tabeli `collections`; adres zamienia wąska funkcja `ops_resolve_news_collection`. Nieznany adres, szkic i kolekcja innej organizacji dają odmowę `stale_link` (kod 3, nic nie zapisano). Linia z polem `collection_id` (także razem z `collection_slug`) to błąd pliku (kod 2).

**Kodowanie.** Plik musi być UTF-8 bez BOM. Plik z BOM albo z bajtami spoza UTF-8 (np. zapisany w Windows-1250) to błąd pliku (kod 2, linia JSON `invalid` z `line: 0`), a nie ciche podmienienie polskich liter.

## Polecenia

Wszystkie z `npm run news:import -- ...`.

| Co robisz                       | Polecenie                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| Sama walidacja pliku (bez bazy) | `--dry-run --file <plik>` (bez `DATABASE_OPS_URL`)                                           |
| Podgląd z bazą (nic nie pisze)  | `--dry-run --file <plik>` (z `DATABASE_OPS_URL`)                                             |
| Zapis lokalny lub na pokazie    | `--file <plik> [--operator <etykieta> --reason <powód>]`                                     |
| Zapis na serwerze               | `--target server --confirm-host <host> --file <plik> --operator <etykieta> --reason <powód>` |

Podgląd z bazą wykonuje dokładnie te same wywołania co zapis i na końcu wycofuje transakcję, więc odmowy, które pokazuje (np. za dużo aktualności, zły stan), są prawdziwe. Nie zostawia ani aktualności, ani wpisu w dzienniku.

Bez `--target server` polecenie odmawia w produkcji (`NODE_ENV=production`) i na bazie spoza `localhost` (kod 3). `--operator` i `--reason` przyjmuje także bez `--target server` (pokaz je podaje; wpis w dzienniku powstaje przy każdym zapisie), a bez nich bierze nazwę użytkownika systemu i powód domyślny. Tryb serwera wymaga `--confirm-host` równego nazwie hosta z `BETTER_AUTH_URL`; zapis wymaga wtedy `--operator` i `--reason`. Organizacja to zawsze redakcja (`krajozbior-redakcja`, lista `NEWS_EDITORIAL_ORG_SLUGS`); `--org-slug` z inną wartością jest odmową.

## Wynik i kody wyjścia

Na wyjściu: po jednej linii na aktualność (`nowa | zmieniona | bez zmian | wycofana`, potem tytuł), a na końcu jedna linia JSON zaczynająca się od `{"outcome"` (bez treści aktualności). Skrypt wdrożenia rozpoznaje ją i pokazuje po polsku.

| Kod | Znaczenie                                        | Linia JSON                                                                                                                                   |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | gotowe, bez zmian albo podgląd                   | `{"outcome":"preview","lines":n,"states":{…}}` albo `{"outcome":"applied","lines":n,"results":{…}}`                                          |
| 2   | błąd pliku (nic nie zapisano)                    | `{"outcome":"invalid","errorCount":n,"errors":[{"line":n,"field":"…","message":"…"}]}`                                                       |
| 3   | odmowa domeny albo środowiska (nic nie zapisano) | `{"outcome":"rejected","code":"invalid_transition\|stale_link\|too_many_news\|slug_taken","line":n}` albo `{"outcome":"refused","code":"…"}` |
| 1   | awaria albo błędne wywołanie (nic nie zapisano)  | brak linii JSON; krótki komunikat na stderr, z klasą SQLSTATE                                                                                |

Liczniki: `created`, `updated`, `unchanged`, `withdrawn` (wycofanie liczy się jako `withdrawn`, nie jako `updated`). Kody odmowy `refused`: `production`, `non_local_database`, `host_mismatch`, `host_not_configured`, `organization_not_allowed`, `organization_not_found`. `slug_taken` oznacza, że równoległy zapis zajął adres między odczytem a zapisem; ponowne wgranie tego samego pliku wybiera adres od nowa. Kody 2 i 3 idą zawsze razem z linią JSON; błąd argumentów i brak bazy to kod 1 bez niej (skrypt wdrożenia pokazuje to jako awarię, nie jako błąd pliku).

## Dziennik operacji

Zapis wstawia wpis `news_import` jako `krajozbior_ops`, w tej samej transakcji co wywołanie `ops_put_news` (funkcja sama nie pisze do dziennika):

- jeden wpis `applied` na każdą aktualność ze skutkiem `created` albo `updated`; aktualność „bez zmian” nie zostawia wpisu;
- cel w `before_state` i `after_state` (`id`, `slug`, `status`, `organization_id`, `collection_id`, `place_id`), bez tytułu i treści; kolumna `details` pusta;
- odmowa wycofuje całą transakcję razem z wpisami `applied`, a polecenie dopisuje osobną, krótką transakcją jeden wpis `rejected` z kodem odmowy i `{ "id", "line" }` odrzuconej linii. Kod w dzienniku jest prawdziwy, także dla `slug_taken`;
- błąd pliku (kod 2) i awaria (kod 1) nie zostawiają wpisu.

## Dane demo

`npm run db:seed:demo` (tylko lokalnie) dodaje organizację redakcji i trzy aktualności demo tą samą drogą co polecenie (`src/features/news/infrastructure/seed-demo-news.ts`); powtórzenie niczego nie zmienia.
