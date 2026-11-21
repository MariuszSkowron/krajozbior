# Specyfikacja E12: Odkrywanie (wersja jawna)

## W skrócie

Przed tym epikiem strona startowa aplikacji była pustym szkieletem, a gość mógł trafić do kolekcji tylko z bezpośredniego linku. Specyfikacja zamienia ją na prawdziwą stronę główną: zalogowany odkrywca widzi swój album (liczby, ulubione kolekcje, ostatnie wizyty), a każdy, także gość, widzi kolekcje do odkrycia, wyszukiwarkę i, dopiero po kliknięciu, kolekcje w okolicy. Pozycja telefonu nie opuszcza przeglądarki. Strona kolekcji dostała filtr „odwiedzone / do odwiedzenia”, panel wybranego miejsca na komputerze i widok mapy OpenStreetMap. Do wersji konkursowej nie były potrzebne zmiany w bazie danych.

To jawne streszczenie pełnej specyfikacji, która leży w prywatnym repozytorium dokumentacji. Pominęliśmy w nim numery decyzji i pytań właściciela, harmonogram dzień po dniu oraz szczegóły ryzyk, które nie zostały jeszcze zamknięte.

| Pole               | Wartość                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| Epik i historyjki  | `docs#13`; `docs#79` (S1), `docs#80` (S2), `docs#81` (S3), `docs#82` (S4), zob. [Backlog](backlog.md) |
| Autor specyfikacji | Claude Opus (skill `om-spec-writing`)                                                                 |
| Przegląd           | Claude Sonnet, inny model niż autor; poprawki sprawdził kolejny, niezależny agent (Sonnet)            |
| Akceptacja         | właściciel, 18 listopada 2026 roku                                                                    |
| Wdrożenie          | PR #38, #39, #40, #41, #49 (historyjka S4 po konkursie)                                               |

Oznaczenia: **[Z]** wymaganie właściciela, **[P]** propozycja agenta (właściciel ją przyjął razem z całą specyfikacją), **decyzja techniczna** to wybór projektowy autora.

## 1. Problem i cel

Kogo dotyczy: gość (np. oceniający albo przypadkowy odwiedzający) oraz odkrywca na telefonie i komputerze. Epik nie dodaje nowych ról.

Cel: oceniający i odkrywca od pierwszego wejścia rozumieją produkt i znajdują kolekcje, a strona kolekcji wygląda i działa jak album z makiet.

Poza zakresem tego epiku (należy do innych): zapowiedź skrytki (E6), okładki kolekcji i zdjęcia miejsc (E4), „km w trasie” w podsumowaniu albumu (E9), imię w powitaniu (E9), własne kolekcje odkrywców w wynikach wyszukiwania (E8).

## 2. Wymagania

### S1. Strona główna

- **[Z]** Odkrywca widzi podsumowanie albumu, ulubione kolekcje, kolekcje w okolicy, ostatnio odwiedzone i wyszukiwarkę.
- **[Z]** „W okolicy” liczy się z lokalizacji, a pozycja nie jest zapisywana.
- **[Z]** „Ulubione kolekcje” to kolekcje zapisane przez odkrywcę, ostatnio używane na górze.
- **[Z]** Postęp jako liczba „9/24”, nie procent.
- **[Z]** Gość widzi krótkie przedstawienie produktu, wyszukiwarkę, „W okolicy” po kliknięciu i sześć ostatnio opublikowanych kolekcji z linkiem „Wszystkie kolekcje”.
- **[P]** „Ostatnio używana” kolekcja to późniejsza z dwóch dat: zapisu kolekcji i ostatniej własnej wizyty w którymkolwiek jej miejscu.
- **[P]** Sekcje osobiste pokazują tylko kolekcje i miejsca, które widzi gość, także wtedy, gdy odkrywca jest kuratorem i mógłby odczytać więcej (np. szkic własnej organizacji).
- **[P]** Podsumowanie albumu: liczba odkrytych miejsc (wizyty obu rodzajów, także w miejscach, które wypadły z kolekcji), liczba województw i liczba zapisanych kolekcji.
- **[P]** „Ostatnio odwiedzone”: pięć ostatnich wizyt; wizyta miejsca, którego nie ma już w żadnej publicznej kolekcji, zostaje na liście jako „Miejsce niedostępne w katalogu”, bez nazwy i linku, żeby lista zgadzała się z liczbą odkrytych miejsc.

### S2. Wyszukiwarka

- **[Z]** Po wpisaniu frazy widać pasujące opublikowane kolekcje i miejsca; szkice nie pojawiają się w wynikach.
- **[P]** Wyszukiwanie nie zależy od wielkości liter ani polskich znaków: „wieza” znajduje „Wieża”, „lodz” znajduje „Łódź”.
- **[P]** Fraza ma od 2 do 80 znaków; wyników najwyżej po 20 kolekcji i miejsc, z komunikatem, gdy jest ich więcej.
- **[P]** Strona wyszukiwarki bez frazy pokazuje wszystkie kolekcje alfabetycznie, z filtrem województwa.

### S3. Kolekcja jako album

- **[Z]** Kolekcja pokazuje region, opis, kuratora, datę aktualizacji i siatkę miejsc z filtrem stanu.
- **[Z]** Przełączenie na mapę pokazuje miejsca na podkładzie OpenStreetMap z podpisem źródła i linkiem do strony praw autorskich.
- **[Z]** Panel wybranego miejsca obok listy na komputerze; na telefonie karta prowadzi do strony miejsca.
- **[Z]** Na mapie odwiedzone miejsca różnią się kształtem i tekstem, nie tylko kolorem; lista kart zostaje widokiem domyślnym i pełnym zamiennikiem mapy.
- **[Z]** Zaznaczanie wielu wizyt z przeszłości na liście działa dalej.
- **[P]** Filtr ma trzy pozycje z liczbami: „Wszystkie (24)”, „Odwiedzone (9)”, „Do odwiedzenia (15)”, widzi go tylko zalogowany odkrywca i działa także bez JavaScriptu.

### S4. „Nowa w okolicy” i filtr „Moich kolekcji”

- **[Z]** Oznaczenie „Nowa w okolicy” i filtr „Moich kolekcji” według postępu. Termin: po konkursie, za zgodą właściciela.

## 3. Najważniejsze decyzje techniczne

- **Bez nowego modułu i bez zmian w bazie.** Odczyty publiczne (lista kolekcji, wyszukiwarka, punkty środkowe dla „W okolicy”, współrzędne miejsc) trafiły do modułu katalogu i zawsze działają w kontekście gościa, więc zalogowany kurator widzi tam dokładnie to co gość. Odczyty prywatne (podsumowanie, ulubione, ostatnie wizyty) trafiły do modułu albumu i działają w kontekście użytkownika.
- **Jawny filtr publiczności w odczytach prywatnych.** Reguły bazy przepuszczają kuratorowi szkice jego organizacji, więc każde zapytanie strony głównej ma własny warunek „kolekcja opublikowana przez zatwierdzoną organizację”. Reguły dostępu w bazie są drugą, niezależną warstwą.
- **Polskie znaki bez rozszerzeń bazy.** Tekst i fraza są sprowadzane do liter bez znaków diakrytycznych tą samą tabelą znaków w bazie i w kodzie aplikacji; wspólny test na prawdziwej bazie porównuje oba wyniki. Wyszukiwanie ma limit czasu, a jego wydajność zmierzono na danych syntetycznych (200 kolekcji, 5 000 miejsc).
- **Stan widoku w adresie strony.** Filtr, wybrane miejsce i widok mapy to parametry adresu: działają bez JavaScriptu, link można udostępnić, a przycisk „Wstecz” działa.
- **Panel miejsca jako ulepszenie.** Karta jest zwykłym linkiem do strony miejsca; na komputerze mały skrypt zamienia kliknięcie na otwarcie panelu.
- **„W okolicy” liczone w przeglądarce.** Serwer wysyła publiczną listę kolekcji z punktem środkowym ich miejsc, a odległość liczy przeglądarka. Lokalizację aplikacja odczytuje wyłącznie po kliknięciu „Pokaż kolekcje w okolicy”, także wtedy, gdy przeglądarka ma już zgodę.
- **Mapa: biblioteka Leaflet, ładowana dopiero po wybraniu widoku mapy.** Kafelki z serwera OpenStreetMap; testy i agenci nigdy nie łączą się z tym serwerem (kafelki są w testach podstawiane). Przy przełączniku mapy jest zdanie, że po jej włączeniu przeglądarka łączy się z serwerem OpenStreetMap; opisuje to też polityka prywatności (#64).

## 4. Dane, prywatność i uprawnienia

- Dane publiczne: kolekcje, miejsca, ich współrzędne i wyniki wyszukiwania; zawsze w kontekście gościa.
- Dane prywatne: zapisane kolekcje, wizyty i podsumowanie albumu; tylko własne wiersze odkrywcy.
- Pozycja urządzenia nie trafia na serwer, do adresu strony, logów ani pamięci przeglądarki.
- Nowe tabele i migracje: brak.

Wymagane testy odmowy dostępu (wszystkie istnieją w repozytorium):

- [`tests/integration/home-album-access.test.ts`](../../tests/integration/home-album-access.test.ts): odkrywca B nie widzi wizyt ani zapisanych kolekcji odkrywcy A w żadnej sekcji strony głównej; kurator nie widzi w sekcjach osobistych swojego szkicu ani wycofanej kolekcji; część publiczna jest identyczna dla gościa i kuratora.
- [`tests/integration/search-access.test.ts`](../../tests/integration/search-access.test.ts): szkic, kolekcja wycofana i kolekcja zawieszonej organizacji nie występują w wynikach, także dla kuratora, który je przygotował; znaki specjalne we frazie nie zwracają wszystkiego.
- [`tests/integration/public-read-access.test.ts`](../../tests/integration/public-read-access.test.ts): nowe odczyty publiczne nie ujawniają szkiców ani miejsc spoza publicznych kolekcji.

## 5. Kryteria akceptacji (sprawdzane testami)

- Gość na stronie głównej widzi przedstawienie produktu, wyszukiwarkę, przycisk „Pokaż kolekcje w okolicy” i kolekcje demo ([`e2e/home.spec.ts`](../../e2e/home.spec.ts)); żaden link strony głównej nie prowadzi do nieistniejącej strony.
- Odkrywca B nie widzi danych odkrywcy A na stronie głównej (integracja i E2E z dwoma kontami).
- „wieza” znajduje „Wieża…”, „lodz” znajduje „Łódź”, a szkic kuratora nie pojawia się nawet zalogowanemu kuratorowi ([`e2e/search.spec.ts`](../../e2e/search.spec.ts)).
- „W okolicy” z udawaną lokalizacją nie odczytuje pozycji przed kliknięciem, a po kliknięciu pokazuje kolekcję z odległością; żadne żądanie sieciowe ani wpis w konsoli nie zawiera współrzędnych ([`e2e/nearby.spec.ts`](../../e2e/nearby.spec.ts)).
- Filtr kolekcji działa bez JavaScriptu i nie psuje zaznaczania wizyt z przeszłości; na komputerze kliknięcie karty otwiera panel, na telefonie prowadzi do strony miejsca ([`e2e/collection-album.spec.ts`](../../e2e/collection-album.spec.ts)).
- Mapa pokazuje znaczniki wszystkich miejsc i podpis źródła, a znaczniki są osiągalne klawiszem Tab ([`e2e/collection-map.spec.ts`](../../e2e/collection-map.spec.ts)).
- Automatyczny test dostępności (axe) przechodzi na stronie głównej, wyszukiwarce i stronie kolekcji w obu motywach.

## Podział na PR-y

Każdy PR zostawia działającą aplikację bez martwych linków i był scalany osobno, po pełnym CI i przeglądzie.

| Krok  | Zakres                                                                   | Historyjka       | PR           |
| ----- | ------------------------------------------------------------------------ | ---------------- | ------------ |
| E12-1 | strona główna: sekcje gościa i odkrywcy                                  | S1 (kryt. 1 i 3) | #38          |
| E12-2 | wyszukiwarka, „Wszystkie kolekcje”, pole wyszukiwania na stronie głównej | S2, S1           | #39          |
| E12-3 | „W okolicy” liczone w przeglądarce                                       | S1 (kryt. 2)     | #40          |
| E12-4 | kolekcja jako album: nagłówek, filtr, siatka, panel miejsca              | S3 (kryt. 1)     | #41          |
| E12-5 | widok mapy                                                               | S3 (kryt. 2)     | #49          |
| E12-6 | „Moje kolekcje”: filtr postępu, „Nowa w okolicy”                         | S4               | po konkursie |

Specyfikacja określiła też kolejność cięcia przy braku czasu (najpierw mapa, potem panel miejsca) i zasadę, że każde cięcie wymaga zgody właściciela. Cięcie nie było potrzebne.

## Przegląd specyfikacji

**Recenzent:** Claude Sonnet, inny model niż autor (Opus). **Werdykt:** prośba o zmiany przed pierwszym PR-em.

- **0 uwag blokujących.**
- **2 ważne.** (1) Zapytania osobistych sekcji strony głównej nie miały jawnego warunku publiczności, więc kurator mógłby zobaczyć tam własny szkic albo wycofaną kolekcję, a lista ostatnich wizyt mogłaby rozjechać się z ich liczbą. (2) Pierwszy PR zostawiałby martwy link do wyszukiwarki, która powstawała dopiero w drugim, a harmonogram nie miał punktu decyzji o cięciu.
- **6 średnich**, m.in.: wyszukiwanie polskich znaków zależne od ustawień językowych bazy, pomiar wydajności na zbyt małych danych, odczyt lokalizacji bez gestu użytkownika przy wcześniej udzielonej zgodzie, wymagania serwera kafelków mapy.
- **6 drobnych**, m.in. numeracja pytań i jedno zdanie o nagłówkach.

**Co poprawiono:** autor przyjął wszystkie uwagi. Dodał jawny warunek publiczności w każdym zapytaniu prywatnym z testami przypadków kuratora, usunął martwe linki z pierwszego PR-a, ustalił odczyt lokalizacji wyłącznie po kliknięciu, sprowadzanie polskich znaków niezależne od ustawień bazy oraz pomiar na danych syntetycznych. Dwie poprawki przyjął w innym wariancie niż proponowany i uzasadnił to w specyfikacji.

**Weryfikacja poprawek:** kolejny, niezależny agent (Sonnet) zatwierdził specyfikację; wszystkie uwagi uznał za rozwiązane i zostawił trzy drobne zalecenia na później.

## Przeglądy PR-ów epiku

Każdy PR epiku miał przegląd poziomu A (dane prywatne i zakres dostępu; zob. [Proces](proces-i-przeglady.md)) wykonany przez agenta Opus, innego niż autor, z osobną oceną bezpieczeństwa i izolacji danych. Poprawki po przeglądzie sprawdzał kolejny, niezależny agent.

| PR  | Zakres              | Pierwszy przegląd                                                    | Po poprawkach                                                                                                                                                       |
| --- | ------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #38 | strona główna       | zatwierdzony; 0 blokujących, 0 ważnych, 4 drobne, 7 kosmetycznych    | drobne poprawione (m.in. liczenie województw tylko z publicznych kolekcji, pomiar czasu strony); weryfikacja: zatwierdzony                                          |
| #39 | wyszukiwarka        | zatwierdzony; 0 blokujących, 0 ważnych, 6 drobnych, 4 kosmetyczne    | drobne poprawione (m.in. limit czasu na całe wyszukiwanie, odmiana nazw województw); weryfikacja: zatwierdzony                                                      |
| #40 | „W okolicy”         | zatwierdzony; 0 blokujących, 0 ważnych, 3 drobne, 4 kosmetyczne      | własny limit czasu odczytu lokalizacji z testem regresji; weryfikacja: zatwierdzony                                                                                 |
| #41 | kolekcja jako album | zatwierdzony; 0 blokujących, 0 ważnych, 2 drobne, 3 kosmetyczne      | panel nie pokazuje przycisku listy, gdy nie udało się wczytać wizyt (z testem regresji)                                                                             |
| #49 | mapa                | prośba o zmiany; 0 blokujących, 2 średnie, 5 drobnych, 2 kosmetyczne | poprawione przed scaleniem: obszar mapy liczony zawsze z całej kolekcji (ważne dla prywatności) i obsługa klawiatury w okienku znacznika; weryfikacja: zatwierdzony |

Każdy przegląd zawiera osobną ocenę bezpieczeństwa i izolacji danych; we wszystkich pięciu PR-ach ta ocena przeszła albo jej uwagi poprawiono przed scaleniem.
