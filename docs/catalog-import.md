# Wgrywanie kolekcji z pliku (polecenie operatora)

## W skrócie

Polecenie `npm run catalog:import` wczytuje plik z zatwierdzonymi kolekcjami i miejscami do lokalnej bazy jednej organizacji jako szkice. Można je uruchamiać wielokrotnie: ten sam plik nie zmienia niczego drugi raz, a ręczne zmiany kuratora z panelu zostają. Publikacja kolekcji i usuwanie wgranych danych to osobne, jawne polecenia. Domyślnie polecenie jest przeznaczone dla operatora na jego komputerze i odmawia produkcji. Jedyna droga na serwer to jawny tryb `--target server` (sekcja „Wgrywanie na serwer”): tylko szkice, z potwierdzeniem hosta i wpisami w dzienniku operacji.

## Zasady bezpieczeństwa

- Polecenie odmawia w środowisku produkcyjnym (`NODE_ENV=production`) oraz gdy adres bazy (`DATABASE_URL`, `DATABASE_OPS_URL`) nie wskazuje na `localhost`. Sprawdza to przed jakimkolwiek połączeniem (kod wyjścia 3).
- Zapis idzie przez te same reguły dostępu co panel kuratora, jako rola `krajozbior_app` w kontekście konta wskazanego kuratora. Konto musi już istnieć (osoba najpierw loguje się sama) i należeć do zatwierdzonej organizacji.
- Wgrywanie pod jedną organizacją jest szeregowane blokadą, więc dwa równoczesne uruchomienia nie zdublują danych.
- Plik jest sprawdzany w całości, zanim cokolwiek trafi do bazy. Komunikaty o błędach podają tylko numer linii, ścieżkę pola i krótki kod, nigdy treść z pliku.
- Limity: plik do 8 MiB, najwyżej 200 kolekcji (limit listy organizacji) i 2000 miejsc w pliku, najwyżej 200 miejsc w jednej kolekcji.
- **Publikacja:** opcja `--publish` nadaje kolekcji adres publiczny i nie da się jej cofnąć jednym poleceniem. Używaj jej dopiero po scaleniu zmian do `main` i tylko za zgodą właściciela. Do tego czasu wgrywaj wyłącznie szkice.

## Przygotowanie

1. Lokalna baza po `npm run db:roles` i `npm run db:migrate`; zmienne `DATABASE_URL` i `DATABASE_OPS_URL` w `.env` wskazują lokalny serwer (nazwy zmiennych: `.env.example`).
2. Plik w formacie NDJSON (jeden obiekt JSON w linii, kodowanie UTF-8).
3. Slug organizacji i adres e-mail konta kuratora tej organizacji.

## Polecenia

Wszystkie z `npm run catalog:import -- ...`.

| Co robisz                            | Polecenie                                                            |
| ------------------------------------ | -------------------------------------------------------------------- |
| Sama walidacja pliku (bez bazy)      | `--dry-run --file <plik> [--profile full\|public]`                   |
| Podgląd stanu z bazą (nic nie pisze) | `--dry-run --file <plik> --org-slug <slug> --curator-email <e-mail>` |
| Wgranie szkiców                      | `--file <plik> --org-slug <slug> --curator-email <e-mail>`           |
| Podgląd publikacji (lista kolekcji)  | `... --publish --dry-run`                                            |
| Wgranie i publikacja                 | `... --publish`                                                      |
| Usunięcie wgranych danych            | `... --remove`                                                       |

Zawsze zacznij od walidacji i podglądu z bazą. Profil `public` przyjmuje tylko pola publicznego schematu; domyślny `full` dopuszcza też pola pomocnicze (patrz niżej).

### Wgranie

Kolekcje powstają jako szkice, a miejsca w kolejności z pliku. Przy ponownym uruchomieniu polecenie porównuje plik z bazą:

- bez zmian w pliku i w bazie: nic się nie dzieje;
- zmiana w pliku, szkic nietknięty w panelu: szkic jest aktualizowany;
- kolekcja lub miejsce zmienione ręcznie w panelu: zostaje tak, jak jest, a raport mówi `kept_manual_edit`;
- szkic usunięty w panelu: nie powstaje ponownie;
- kolekcja już opublikowana: jej skład i treść nie są zmieniane.

Kolekcja może wskazywać miejsce, które nie jest opisane w tym pliku (np. plik ogólnopolski odwołuje się do miejsc wgranych wcześniej z innego pliku). Takie miejsce musi już istnieć w bazie organizacji. Jeśli go nie ma, cały plik jest odrzucany bez zapisu (kod 2).

### Publikacja (`--publish`)

Po wgraniu publikowane są wyłącznie kolekcje z `"publish": true`, które są nieopublikowanymi szkicami, nie były edytowane ręcznie i mają co najmniej jedno miejsce. Publikacja używa tego samego przypadku użycia co przycisk w panelu (adres z tytułu, te same reguły). Kolekcja odrzucona przy publikacji zostaje szkicem, a reszta pliku jest przetwarzana dalej. `--publish --dry-run` wypisuje listę kolekcji, które zostałyby opublikowane (numer linii, klucz i tytuł), i niczego nie zmienia. Kolekcja wycofana z publikacji nie jest publikowana ponownie.

### Usunięcie (`--remove`)

Usuwa to, co wgrano, według kluczy z pliku, w jednej transakcji:

- szkice kolekcji są usuwane; kolekcja opublikowana lub kiedykolwiek wycofana zostaje (`kept_published`);
- miejsce jest usuwane tylko wtedy, gdy nie należy do żadnej kolekcji i nikt go nie odwiedził ani nie dodał do „Chcę zobaczyć”; w przeciwnym razie zostaje (`kept_in_collection` albo `kept_referenced`);
- klucze po rzeczach już nieistniejących (usuniętych w panelu) są sprzątane (`orphan_key_removed`);
- drugie uruchomienie nic nie zmienia (`noop`).

`--remove` nie ma podglądu z bazą, bo o tym, co zostaje, decydują wizyty niewidoczne dla kuratora. Sam `--remove --dry-run --file <plik>` bez flag organizacji sprawdza tylko plik. Opcji `--publish` i `--remove` nie łączy się.

## Wgrywanie na serwer (`--target server`)

Tryb dla operatora w kontenerze `ops` na serwerze (`docs/deployment.md`); uruchamia go skrypt wdrożenia właściciela, nie agent. Bez `--target server` obowiązują zasady lokalne z góry (odmowa produkcji i bazy poza `localhost`, kod 3).

```
npm run catalog:import -- --target server --confirm-host <host> --profile public \
  --file <plik> --org-slug <slug> --curator-email <adres> \
  --operator "<etykieta>" --reason "<powód>" [--dry-run | --remove]
```

- **Potwierdzenie hosta.** `--confirm-host` musi być równe nazwie hosta z `BETTER_AUTH_URL`; w terminalu polecenie dodatkowo prosi o jej przepisanie. Przy złym hoście albo braku `BETTER_AUTH_URL` odmawia przed połączeniem z bazą (kod 3).
- **Tylko profil `public` i tylko szkice.** Inny profil albo `--publish` kończą się odmową (kod 3): kolekcje publikuje właściciel w panelu kuratora (E11-Q5).
- **Dziennik operacji.** Wgranie i usunięcie wymagają `--operator` i `--reason` (jak inne polecenia operatora: bez adresu e-mail w powodzie). Polecenie zapisuje rolą `krajozbior_ops` wpis „rozpoczęcie” (operacja `catalog_import` albo `catalog_remove`; w `details`: identyfikator partii, skrót SHA-256 pliku, liczby kolekcji i miejsc) **przed** pierwszym zapisem, a po zakończeniu wpis z wynikiem (liczby wyników; odmowa lub awaria to wpis `rejected` z kodem `import_refused` albo `import_failed`). Gdy wpisu „rozpoczęcie” nie da się zapisać, nic nie jest wgrywane (kod 1). Do dziennika nie trafia ani adres e-mail, ani tytuł, ani klucz miejsca.
- **Podgląd** (`--dry-run`) wymaga potwierdzenia hosta, niczego nie zmienia i nie zostawia wpisu.
- **Raport** na serwerze idzie tylko na standardowe wyjście (drugi wiersz JSON z kluczem `report`), nie do pliku.
- **Zmienne w pliku operatora** (`ops.env`): polecenie wymaga trzech: `DATABASE_OPS_URL` (dziennik i wyszukanie konta kuratora), `DATABASE_URL` (rola `krajozbior_app`, tak jak aplikacja; przez nią idzie samo wgranie) i `BETTER_AUTH_URL` (host do potwierdzenia). Skrypt wdrożenia kładzie je w pliku operatora tylko na czas tego polecenia (`kz_ops_env_vars` w `scripts/ops/server/lib.sh`).
- **Uruchomienie przez właściciela:** `wdroz.ps1 -Import <plik>` (`docs/deployment.md`, „Wgrywanie kolekcji”) robi podgląd, pyta „tak/nie” i dopiero wtedy wgrywa; katalog z plikiem jest montowany do kontenera tylko do odczytu i usuwany po każdym poleceniu. Przez skrypt polecenie działa bez terminala, więc przepisywania hosta nie ma: barierami są flaga, potwierdzenie hosta (skrypt podaje nazwę hosta z `serwer.conf`) i pytanie skryptu.
- **Granica potwierdzenia hosta:** `--confirm-host` chroni przed pomyłką (zły serwer, zła baza w pliku zmiennych), nie przed celowym obejściem: kto ustawia środowisko, ustawia też `BETTER_AUTH_URL`. Granicą bezpieczeństwa pozostają hasła ról, które ma tylko właściciel (decyzja D-E11-4).
- **Dziennik i przerwane wgranie:** wpis rozpoczęcia ma `outcome = 'applied'` i `details.phase = 'start'`; wynik wgrania to osobny wpis z `details.phase = 'finish'`. Wpisy czyta się po `details.phase`, nie po samym `outcome`. Wgranie idzie transakcją na kolekcję, więc przerwanie w połowie zostawia część kolekcji jako szkice i wpis rozpoczęcia bez wpisu wyniku. Naprawa: powtórzyć to samo wgranie (jest powtarzalne — miejsca bez zmian zostają, podpisy źródeł się odświeżają).

## Kody wyjścia

| Kod | Znaczenie                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Gotowe, bez zmian albo sam podgląd                                                                                                                       |
| 1   | Awaria (np. brak połączenia); dane zapisane wcześniej zostają, polecenie można ponowić                                                                   |
| 2   | Błąd wejścia: argumenty, plik nie przeszedł walidacji, za duży plik, miejsca spoza pliku, których nie ma w bazie                                         |
| 3   | Odmowa: organizacja niedostępna, brak konta kuratora, środowisko produkcyjne lub nielokalna baza, odmowa przy wgraniu kolekcji, publikacji albo usuwaniu |

Na standardowe wyjście trafia podsumowanie w JSON (liczby i klucze, a w podglądzie publikacji także tytuły kolekcji; bez adresów e-mail), a na wyjście błędów krótkie wskazówki po polsku. Przy wgraniu, publikacji i usunięciu szczegółowy raport (wyniki dla każdej kolekcji i miejsca) zapisuje się do `.ai/tmp/catalog-import/` (katalog ignorowany przez git).

## Format pliku

Plik składa się z linii, z których każda to obiekt JSON z polem `type`. Kolejność: najpierw `batch`, potem wszystkie `collection`, potem `place`. Pusty wiersz jest pomijany.

- **`batch`** (jedna linia, pierwsza): `schema` (`krajozbior.curation/1`), `batch_id`, `created_at` (data i czas ISO) oraz `sources`, czyli lista pozycji atrybucji (`key`, `label`, `license`, `license_url` z `creativecommons.org`, opcjonalnie `url`, `data_date`).
- **`collection`**: `import_key` (zaczyna się od `col:`), `title` (do 120 znaków), `summary` (do 280), `region` (kod z listy niżej), `places` (klucze miejsc, 1 do 200, bez powtórzeń), opcjonalnie `publish` (domyślnie `false`) i `review.status` równe `approved`.
- **`place`**: `import_key` (nie zaczyna się od `col:`), `name` (do 120), `location` (`lat`, `lon` w granicach Polski, `visit_radius_m` od 50 do 2000), `admin` (`region` oraz opcjonalnie `powiat`, `gmina`, `locality`), `address` (do 200), `description` (`text` do 4000, `method`: `template` albo `curator`, `sources`), opcjonalnie `wikipedia_pl`, `access` (`note`, `warning`), `attribution` (co najmniej jeden klucz źródła; miejsce bez podpisu źródła loader odrzuca), `retrieved_at` i `review.status` (`approved` albo `approved_in_collection`). Każde miejsce musi występować w jakiejś kolekcji.
- **`import_key`**: małe litery, dwukropek, potem litery, cyfry, `_` lub `-` (np. `col:nazwa`, `ext:ABC-0001`). Klucze są unikalne osobno dla kolekcji i miejsc.
- **`access.restriction`** (E1-S11): opcjonalne, jedna z wartości `none` (domyślnie), `private`, `fenced`, `ruin`. Miejsce z wartością inną niż `none` pokazuje odkrywcy ostrzeżenie o zakazie wchodzenia na teren; punkt potwierdzenia wizyty ustaw wtedy w przestrzeni publicznej (np. przy drodze). Pole jest częścią treści miejsca: ponowne wgranie zmienia je w nietkniętym miejscu, a w miejscu edytowanym ręcznie w panelu zostaje wartość z panelu (`kept_manual_edit`). Nieznana wartość odrzuca plik (kod 2).
- **`access_info`**: loader skleja `access.note`, pustą linię i `access.warning` w jedno pole „Dostępność”; puste części są pomijane; razem do 1000 znaków.
- **`image`** (oba profile, od E4-2a): opis zdjęcia z Wikimedia Commons (`commons_file`, `title`, `page_url`, `width`, `author_text`, `license_short`, `license_url` i pozostałe pola) z adresami tylko z dozwolonych serwisów. Loader zapisuje z niego wiersz zdjęcia w stanie `pending_fetch` (bez pliku; plik pobiera `photos:fetch`). Adres pliku z `file_url` nie jest używany ani zapisywany. Licencję wyznacza reguła z sekcji „Zdjęcia z Commons” niżej.
- **Pola dodatkowe profilu `full`**: `source_refs`, `review.flags` oraz `notes`. `notes` to wyłącznie dane pomocnicze dla przeglądającego: loader ich nie czyta, nie zapisuje i nie wypisuje, a w błędach pojawia się tylko słowo `notes`. Profil `public` tych pól nie dopuszcza.
- Znaki `<` i zero w tekście są odrzucane. Adresy muszą używać `https`; dozwolone serwery artykułów, zdjęć i licencji są zapisane w walidatorze (`src/features/catalog/domain/import-file.ts`).

### Kody województw (`region`)

`dolnoslaskie`, `kujawsko_pomorskie`, `lubelskie`, `lubuskie`, `lodzkie`, `malopolskie`, `mazowieckie`, `opolskie`, `podkarpackie`, `podlaskie`, `pomorskie`, `slaskie`, `swietokrzyskie`, `warminsko_mazurskie`, `wielkopolskie`, `zachodniopomorskie`.

## Wyniki w raporcie

Wgranie: dla kolekcji `created`, `updated`, `noop`, `kept_manual_edit`, `kept_manual_delete`, `skipped_already_published`, `refused`; dla składu kolekcji (listy jej miejsc) `synced`, `noop`, `kept_manual_edit`, `kept_manual_delete` i `skipped_already_published`; dla publikacji `published`, `skipped_already_published`, `kept_manual_edit`, `refused`. Usuwanie: `removed`, `orphan_key_removed`, `kept_published`, `kept_in_collection`, `kept_referenced`, `noop`.

## Zdjęcia z Commons (E4-2a)

**Wgranie bloku `image`.** Dla miejsca z blokiem `image` loader tworzy wiersz zdjęcia (`source_kind = commons_import`, `file_state = pending_fetch`, bez pliku, na końcu listy zdjęć miejsca), z podpisem: autor, tytuł, strona pliku w Commons, kod i dokładna nazwa licencji, adres licencji. Wynik dla zdjęcia (raport: `photos` przy miejscu; podsumowanie: `photoResults`): `created`, `updated`, `noop`, `removed` (blok zniknął z pliku albo zmieniła się nazwa pliku w Commons), `kept_manual_edit` (kurator zmienił wiersz), `kept_manual_delete` (kurator usunął zdjęcie, więc nie wraca), `skipped_unknown_license`. Klucz zdjęcia w `catalog_import_keys` ma rodzaj `photo` i postać `img:` plus skrót z klucza miejsca i nazwy pliku. W dzienniku operacji wpis wyniku ma liczby `photos_created`, `photos_updated`, `photos_removed`, `photos_kept_manual`, `photos_skipped_unknown_license`.

**Reguła licencji.** Adres z pliku nie jest porównywany dosłownie: po przycięciu i zamianie `http://` na `https://` host musi być `creativecommons.org`; odcinane są fragment, zapytanie, końcowy `/` i końcowy segment `deed.<język>` albo `legalcode`; z reszty czytana jest rodzina, wersja i opcjonalny kraj. Rodzina i wersja muszą zgadzać się z `license_short` (przycięty, pojedyncze spacje, wielkie litery). Kraj (dwie litery, tylko wersje 2.0, 2.5, 3.0) musi być w obu miejscach albo w żadnym. Przyjmowane: CC0 1.0, domena publiczna, CC BY i CC BY-SA 2.0, 2.5, 3.0, 4.0 (także wersje krajowe, np. „CC BY-SA 3.0 PL”). Reszta (NC, ND, GFDL, sprzeczność, obcy host) daje `skipped_unknown_license` i wiersz nie powstaje. Do bazy trafia adres kanoniczny z kodu i kraju, nigdy tekst z pliku.

**Pobieranie: `npm run photos:fetch`.** Polecenie operatora (rola `krajozbior_ops`, `DATABASE_OPS_URL`; wymaga `MEDIA_ROOT`):

```
npm run photos:fetch -- --operator "<etykieta>" --reason "<powód>" [--limit <n>] [--org-slug <slug>] [--retry-failed] [--refetch-missing]
```

- Adres miniatury buduje samo z nazwy pliku w Commons: `https://upload.wikimedia.org/wikipedia/commons/thumb/{a}/{ab}/{nazwa}/{szerokość}px-{nazwa}`; szerokość to największy standardowy krok (20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920) nie większy niż `min(1920, szerokość oryginału)`. Oryginału nie pobiera.
- Tylko `https` i host `upload.wikimedia.org`; przekierowań nie śledzi automatycznie, każdy krok (najwyżej 3) musi leżeć na tym samym hoście. Limit 20 MB i 30 s na plik, najwyżej 1 żądanie na sekundę, `429` i `503` czekają według `Retry-After` (najwyżej 5 minut). `User-Agent` zawiera ogólną nazwę klienta i adres strony „Źródła danych”.
- **Kontrola wersji pliku przed pobraniem.** Każdy może wgrać na Commons nową wersję pod tą samą nazwą, a miniatura zawsze pochodzi z wersji bieżącej. Dlatego tuż przed pobraniem polecenie pyta API Commons (`https://commons.wikimedia.org/w/api.php`, `prop=imageinfo`, bez `redirects=1`, bez śledzenia przekierowań, limit odpowiedzi 1 MB, 30 s, ten sam `User-Agent`; zapytanie idzie do innego hosta niż pobieranie, więc nie wymaga dodatkowej przerwy) o czas wgrania bieżącej wersji, szerokość oryginału i licencję. Zdjęcie dostaje od razu `fetch_failed` (bez kolejnych prób) z jednym z kodów w `reasons`: `file_changed` (bieżąca wersja nowsza niż `retrieved_at` wiersza, inna szerokość niż `source_width` albo brak `retrieved_at`), `file_gone` (strony nie ma, nazwa pliku jest przekierowaniem albo odpowiedź nie ma dokładnie jednej wersji), `license_changed` (licencja z API po tej samej regule normalizacji ma inny kod niż `license_code` wiersza albo jest nierozpoznana). Awaria samego zapytania (`api_error`) to zwykła nieudana próba (do trzech). Przy wątpliwości zdjęcia nie pobiera; miejsce pokazuje się wtedy bez zdjęcia. Prawowita poprawka pliku na Commons też jest odrzucana, dopóki kolekcja nie zostanie przygotowana i wgrana ponownie. Rola `krajozbior_ops` czyta w tym celu dwie dodatkowe kolumny: `retrieved_at` i `license_code`.
- Typ po zawartości (JPEG, PNG); obróbka biblioteką zdjęć w procesie potomnym (budżet 300 KB, bez progu krótszego boku dla Commons, bez powiększania). Na dysku zostaje tylko przetworzona kopia (`main` i `w400`).
- Jedna próba na wiersz w jednym przebiegu; trzecia nieudana próba daje `fetch_failed` (zdjęcie niewidoczne). `--retry-failed` bierze też takie wiersze, `--refetch-missing` przestawia wiersze `ready` bez pliku na dysku z powrotem na `pending_fetch`.
- Wspólna blokada doradcza w bazie: drugie uruchomienie w czasie pierwszego kończy się kodem 3 („Poprzednie pobieranie jeszcze trwa”). Strażnik wolnego miejsca (`MEDIA_MIN_FREE_PERCENT`) wstrzymuje przebieg.
- Na końcu jeden wiersz JSON (`fetched`, `failed`, `skipped`, `remaining`, `reasons`) i wpis `photos_fetch` w dzienniku operacji (same liczby i kody powodów). Kody wyjścia: 0 gotowe, 1 awaria, 2 błąd argumentów, 3 poprzednie pobieranie trwa.

## Testy

Fikstury są w `tests/fixtures/curation/` (dane fikcyjne). Test z bazą: `npm run test:integration -- tests/integration/catalog-import.test.ts` (zasady uruchamiania: `docs/testing.md`). Tryb serwera: `tests/features/catalog/application/catalog-import-server.test.ts` (jednostkowy: odmowy przed połączeniem, kolejność wpisów) i `tests/integration/catalog-import-server.test.ts` (dwa wpisy po wgraniu, brak wpisu po podglądzie i odmowie, brak wgrania przy awarii dziennika, odmowa zapisu dziennika dla innych ról).
