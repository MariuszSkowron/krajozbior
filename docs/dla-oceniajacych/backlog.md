# Backlog

## W skrócie

Plan całej pierwszej wersji Krajozbioru jest podzielony na 12 dużych części (epików). Każdy epik dzieli się na historyjki, czyli pojedyncze rzeczy, które użytkownik od razu zauważy, a każda historyjka ma kryteria akceptacji w postaci zdań „KIEDY zrobię X, WTEDY zobaczę Y”. Poniżej jest lista epików z ich stanem oraz jeden epik rozpisany w całości: E12 „Odkrywanie”, dla którego istnieje [jawna specyfikacja](specyfikacja-e12-odkrywanie.md) z przeglądem i pięć scalonych PR-ów.

Zadania prowadzimy w prywatnym repozytorium; w tym repozytorium oznaczamy je jako `docs#N`. Backlog przygotował agent (skill `om-backlog`) na podstawie opisu produktu i makiet ekranów, a właściciel go zaakceptował. Oznaczenia: **[Z]** wymaganie właściciela, **[P]** propozycja agenta, którą właściciel musi przyjąć.

## Epiki

Stan na 21 listopada 2026 roku. Numery z `#` to PR-y w tym repozytorium.

| Epik                                       | Co obejmuje                                                                               | Stan                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| E1. Organizacje i katalog kolekcji         | organizacje kuratorskie, kolekcje i miejsca, publikacja, panel kuratora, strony publiczne | ścieżka konkursowa scalona (#10, #11, #13, #14, #29); współzarządzanie i historia zmian w planie |
| E2. Album odkrywcy                         | zapis kolekcji, wizyta na miejscu i z przeszłości, postęp, „Chcę zobaczyć”                | scalone (#15–#18, #34, #36)                                                                      |
| E3. Wygląd „nocny album”                   | tokeny, dwa motywy, nawigacja, wspólne elementy, dostępność                               | ekrany ścieżki scalone (#25, #28, #31, #32)                                                      |
| E4. Zdjęcia                                | zdjęcia oficjalne, okładki, zdjęcia odkrywców z moderacją kuratora                        | specyfikacja napisana; po wydaniu konkursowym                                                    |
| E5. Zgłoszenia poprawek i problemów        | zgłoszenia odkrywców, kolejka kuratora                                                    | specyfikacja napisana; w planie                                                                  |
| E6. Wydarzenia, karty legendarne i skrytka | wydarzenia kuratora i wyjątkowe karty za udział                                           | specyfikacja napisana; w planie                                                                  |
| E7. Aktualności                            | wiadomości od kuratorów                                                                   | specyfikacja napisana; w planie                                                                  |
| E8. Własne kolekcje odkrywców              | kolekcje prywatne i publiczne po akceptacji administratora                                | specyfikacja napisana; w planie                                                                  |
| E9. Profil, statystyki i ustawienia        | profil, statystyki, wylogowanie, usunięcie konta                                          | częściowo scalone (#42, #43, #50, #54)                                                           |
| E10. Administrator i zespół organizacji    | ekrany administratora, zapraszanie zespołu                                                | specyfikacja napisana; w planie                                                                  |
| E11. Wdrożenie                             | serwer, wysyłka e-maili, regulamin i polityka prywatności, ta dokumentacja                | w toku (#55, #57, #58, #60, #61, #63, #64)                                                       |
| E12. Odkrywanie                            | strona główna, wyszukiwarka, kolekcja jako album, mapa                                    | trzy z czterech historyjek scalone (#38–#41, #49); czwarta po konkursie                          |

Poza epikami jest lista rzeczy odłożonych na później (m.in. aplikacja na Androida) i rzeczy, których świadomie nie robimy ([Produkt](produkt.md), „Czego nie robimy”).

## E12. Odkrywanie: strona główna, wyszukiwarka, mapa

Zadanie: `docs#13`. Cel: odkrywca i gość od pierwszego wejścia rozumieją produkt i znajdują kolekcje, a strona kolekcji działa jak album z makiet. Epik pochodzi z makiet ekranów („strona główna”, „kolekcja z wybranym miejscem”) i opisu produktu. Agent zaproponował go jako osobny epik, bo te ekrany nie mieściły się w żadnej innej; właściciel to przyjął.

Dla wszystkich historyjek obowiązuje: interfejs po polsku, projekt najpierw na telefon, dostępność WCAG 2.2 na poziomie AA w obu motywach, test odmowy dostępu przy danych prywatnych.

### E12-S1. Strona główna (`docs#79`)

Kryteria akceptacji **[Z]**:

1. KIEDY odkrywca otworzy stronę główną, WTEDY widzi podsumowanie albumu, zapowiedź skrytki, ulubione kolekcje, kolekcje w okolicy, ostatnio odwiedzone i wyszukiwarkę.
2. KIEDY „W okolicy” liczy się z lokalizacji, WTEDY pozycja nie jest zapisywana.
3. KIEDY strona główna pokazuje „ulubione kolekcje”, WTEDY są to kolekcje zapisane przez odkrywcę, ostatnio używane na górze; osobnego oznaczenia „ulubiona” nie ma.

Stan: kryteria 1 (bez zapowiedzi skrytki) i 3 w #38, wyszukiwarka w #39, kryterium 2 w #40. Zapowiedź skrytki przyjdzie z epikiem E6, bo bez wydarzeń nie ma czego zapowiadać.

### E12-S2. Wyszukiwarka miejsc i kolekcji (`docs#80`)

Kryterium akceptacji **[Z]**: KIEDY wpiszę frazę, WTEDY widzę pasujące opublikowane kolekcje i miejsca; szkice i cudze prywatne dane nie pojawiają się w wynikach.

Stan: scalone w #39. Wyszukiwanie nie zależy od wielkości liter ani polskich znaków („lodz” znajduje „Łódź”), a bez frazy strona pokazuje wszystkie kolekcje z filtrem województwa.

### E12-S3. Kolekcja jako album: siatka, filtr, panel miejsca, mapa (`docs#81`)

Kryteria akceptacji **[Z]**:

1. KIEDY otwieram kolekcję, WTEDY widzę okładkę, region, opis, kuratora, datę aktualizacji i siatkę miejsc z filtrem stanu (odwiedzone / do odwiedzenia).
2. KIEDY przełączam widok kart na mapę, WTEDY widzę miejsca na mapie na podkładzie OpenStreetMap z podpisem źródła.

Stan: kryterium 1 (bez okładki) i panel wybranego miejsca w #41, kryterium 2 w #49. Okładki przyjdą z epikiem E4 (zdjęcia); do tego czasu kolekcja ma tło z design systemu.

### E12-S4. „Nowa w okolicy” i filtr „Moich kolekcji” (`docs#82`)

Kryterium akceptacji **[Z]**: KIEDY w pobliżu pojawi się nowa kolekcja, WTEDY ma oznaczenie „Nowa w okolicy”; filtr „Moich kolekcji” działa po stanie postępu.

Stan: po konkursie, za zgodą właściciela. Dziś wszystkie kolekcje są nowe, więc oznaczenie niczego by nie mówiło. Specyfikacja opisuje już regułę (pierwsza publikacja najwyżej 30 dni temu i miejsce najwyżej 50 km od odkrywcy).

## Jak powstał podział na PR-y

Specyfikacja epiku dzieli pracę na sześć małych PR-ów, każdy zostawia działającą aplikację bez martwych linków. Szczegóły i wyniki przeglądów: [Specyfikacja E12](specyfikacja-e12-odkrywanie.md#podział-na-pr-y).
