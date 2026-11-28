# Specyfikacje

## W skrócie

Każda większa zmiana zaczyna się od specyfikacji: opisu celu, wymagań, rozwiązania, testów i podziału pracy na małe PR-y (propozycje zmian w kodzie). Specyfikację pisze jeden model AI, a przegląda inny; pytania otwarte rozstrzyga właściciel, zanim powstanie kod. Poniżej są streszczenia specyfikacji, według których powstała ścieżka konkursowa, dziennik operacji i wygląd aplikacji. Specyfikacja epiku E12 („Odkrywanie”) ma osobny, dokładniejszy plik: [Specyfikacja E12](specyfikacja-e12-odkrywanie.md). Specyfikacje kolejnych epików (zdjęcia, zgłoszenia, wydarzenia, aktualności, własne kolekcje, profil, administracja, wdrożenie) też przeszły przegląd innego modelu, ale jeszcze nie mają jawnych streszczeń; sekcja [Kolejne specyfikacje i ich PR-y](#kolejne-specyfikacje-i-ich-pr-y) pokazuje przynajmniej, które PR-y z nich wynikają. Pełne wersje wszystkich specyfikacji są w prywatnym repozytorium dokumentacji, bo zawierają decyzje i plany właściciela.

Oznaczenia z pełnych specyfikacji: wymaganie właściciela, propozycja agenta (czeka na akceptację) i decyzja techniczna są zawsze rozdzielone.

## 1. Ścieżka konkursowa: organizacje, katalog kolekcji i album odkrywcy

**Cel.** Jedna pełna droga od początku do końca, z testem uprawnień:

1. Administrator nadaje organizacji status kuratora (polecenie operatora, bez ekranu).
2. Kurator tworzy szkic kolekcji, dodaje miejsca z promieniem potwierdzania, ustala kolejność i publikuje.
3. Gość ogląda opublikowaną kolekcję i stronę miejsca; szkic daje „nie znaleziono”.
4. Odkrywca zapisuje kolekcję i widzi ją w „Moich kolekcjach” z postępem 0/N.
5. Odkrywca na miejscu potwierdza wizytę lokalizacją i postęp rośnie do 1/N; poza promieniem widzi odległość i może zapisać miejsce na „Chcę zobaczyć”.
6. Kurator innej organizacji nie odczyta ani nie zmieni cudzego szkicu, żaden kurator nie widzi wizyt odkrywców, a odkrywca B nie widzi danych odkrywcy A.

**Model danych.** Dane kuratora (organizacje, członkostwa, kolekcje, miejsca, powiązania kolekcja–miejsce) i dane odkrywcy (zapisane kolekcje, wizyty, lista „Chcę zobaczyć”) łączą się tylko przez identyfikatory kolekcji i miejsc. Żadna tabela kuratora nie wskazuje odkrywcy, więc zasada „kurator nie widzi wizyt” wynika już z samego modelu, a reguły bazy jej pilnują. Tabela wizyt nie ma kolumn na współrzędne. Postęp nie jest zapisywany; liczy go zapytanie w kontekście odkrywcy.

**Najważniejsze decyzje techniczne.**

- Odległość i decyzję o wizycie liczy funkcja w bazie; przeglądarka przysyła tylko odczyt, który nie jest nigdzie zapisywany.
- Kurator edytuje treści swojej organizacji bezpośrednio, a baza pilnuje zakresu organizacji i listy dozwolonych pól.
- Nowa kolekcja jest zawsze szkicem; daty publikacji ustawia baza; kolekcji kiedykolwiek opublikowanej nie da się usunąć.
- Gość czyta przez osobny, tylko do odczytu kontekst bazy.
- Każdy zapis ma limit liczby prób w czasie.

**Testy, których nie wolno wyciąć.** Testy odmowy dostępu (organizacja A kontra B, odkrywca A kontra B, gość, kurator kontra wizyty), E2E z dwoma kontami, E2E całej ścieżki i przegląd bezpieczeństwa po zakończeniu.

**Podział pracy.** Osiem PR-ów obowiązkowych i jeden opcjonalny: organizacje i polecenie operatora; katalog kolekcji i miejsc; panel kuratora; strony publiczne; album w bazie; „Moje kolekcje”; wizyta na miejscu z testem całej ścieżki; „Chcę zobaczyć”; opcjonalnie wizyta z przeszłości. Specyfikacja wskazuje też, co wyciąć najpierw, gdy zabraknie czasu (zaczynając od wizyty z przeszłości), i czego nie wycinać nigdy (testów uprawnień).

**Poza zakresem tej specyfikacji:** zdjęcia i moderacja, zgłoszenia, wydarzenia i karty legendarne, aktualności, własne kolekcje odkrywców, profil, ekrany administratora, współzarządzanie kolekcją, mapa i wyszukiwarka. Zostają w zakresie pierwszej wersji, w kolejnych specyfikacjach.

**Przegląd specyfikacji.** Specyfikację napisał Opus, przejrzał Sonnet, a każdą rundę poprawek sprawdzał kolejny, niezależny agent (Sonnet albo Opus), aż do zatwierdzenia. Przed pierwszym PR-em osobny przegląd gotowości sprawdził, czy specyfikacja jest kompletna i zgodna z zasadami repozytorium.

## 2. Dziennik operacji odporny na rolę, która do niego zapisuje

**Cel.** Dziennik operacji to zapis tego, kto i dlaczego nadał komuś uprawnienia kuratora albo zawiesił organizację. Przegląd bezpieczeństwa wykazał, że wiarygodność dziennika da się poprawić. Właściciel zdecydował, że trzeba to zrobić przed konkursem.

**Rozwiązanie.** Codzienne polecenia administracyjne pracują na osobnym, słabszym koncie bazy: może ono tylko dopisywać wpisy. Czas wpisu i konto, które go zapisało, wypełnia baza. Nadanie albo odebranie roli administratora wymaga podania powodu i zostawia wpis; baza odrzuca zmianę roli bez takiego wpisu w tej samej transakcji. Pozostałe ryzyko (osoba z poświadczeniem migracji może świadomie zmienić schemat) jest opisane w [docs/data-isolation.md](../data-isolation.md) i zaakceptowane przez właściciela.

## 3. Wygląd „nocny album kolekcjonerski”

**Cel.** Ekrany, które już działają, mają wyglądać według design systemu właściciela, a ich działanie i testy zostają bez zmian.

**Rozwiązanie.** Tokeny wyglądu (kolory, kroje Instrument Serif, Geist i Geist Mono, odstępy, promienie, ruch) dla dwóch motywów z tych samych nazw: nocnego, w którym aplikacja zawsze startuje, i jasnego, włączanego przełącznikiem w nagłówku. Dostępność WCAG 2.2 AA w obu motywach jest wymaganiem: tam, gdzie wartość z design systemu nie spełniała kontrastu, specyfikacja proponowała poprawkę, a właściciel ją zatwierdzał. Praca jest podzielona na trzy PR-y: tokeny, kroje i przełącznik; nawigacja i wspólne elementy; przeniesienie ekranów z testem dostępności. Liczba tokenów ma górny limit, żeby system nie rozrastał się „na zapas”.

**Poza zakresem:** efekty kart legendarnych i skrytki, zdjęcia, pełne ustawienia wyglądu; przyjdą razem z funkcjami, które ich potrzebują.

Publiczny opis design systemu: [docs/design/](../design/README.md).

## Kolejne specyfikacje i ich PR-y

Specyfikacje kolejnych epików dzielą pracę na fazy. Kod fazy zaczyna się w tytule PR-a (np. `E4-2b`), więc z listy PR-ów widać, z której specyfikacji wynika każda zmiana. Poniżej fazy scalone do 28 listopada 2026 roku. Część zmian wynika nie ze specyfikacji epiku, tylko z decyzji właściciela po obejrzeniu aplikacji (oznaczenia `D-NN` w tytułach PR-ów, np. D-49 dla poprawek tekstów i ekranów, D-57 dla nowego wyglądu, D-58 dla poprawek po pokazie).

| Specyfikacja                      | Fazy i PR-y                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| E4. Zdjęcia                       | E4-0b1 (#81), E4-0a (#82), E4-2a (#86), E4-2b (#88), E4-2z (#89), E4-3 (#100)                             |
| E5. Zgłoszenia                    | E5-0 (#97)                                                                                                |
| E6. Wydarzenia i karty legendarne | E6-0 (#126), E6-4a (#128)                                                                                 |
| E7. Aktualności                   | E7-0 (#93), E7-R1 (#101), E7-R2a (#107), E7-R2b (#110), E7-R3 (#111)                                      |
| E8. Własne kolekcje               | E8-1a (#105)                                                                                              |
| E9. Profil i ustawienia           | motyw zapamiętany na koncie (#78), E9-6a (#95)                                                            |
| E10. Administrator                | E10-S0 (#103)                                                                                             |
| E12. Odkrywanie                   | E12-1–E12-6 (#38, #39, #40, #41, #49, #79); szczegóły: [Specyfikacja E12](specyfikacja-e12-odkrywanie.md) |
