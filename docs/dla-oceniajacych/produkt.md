# Produkt

## W skrócie

Ten plik opisuje produkt: problem, użytkowników, reguły, zakres pierwszej wersji i MVP. Krajozbiór to album odwiedzonych miejsc. Odkrywca zbiera miejsca w tematycznych kolekcjach (np. „Wieże ciśnień Pomorza”), potwierdza wizytę lokalizacją telefonu i widzi postęp jako liczbę zebranych miejsc, np. 9/24. Gotowe kolekcje przygotowują kuratorzy: gminy, PTTK, organizacje turystyczne i lokalni przewodnicy. Pierwsza wersja działa w przeglądarce na telefonie i komputerze.

## Jaki problem rozwiązuje

Krajozbiór traktuje zbieranie miejsc jak osobisty dziennik: co odwiedziłem, kiedy i ile zostało mi do skończenia kolekcji. Kolekcje kuratorów prowadzą do mało znanych obiektów w małych miejscowościach, takich jak wieże ciśnień, kapliczki czy stare dworce.

## Dla kogo

- **Turysta weekendowy:** chce szybko znaleźć ciekawe miejsca w okolicy, bez skomplikowanego startu.
- **Kolekcjoner:** chce skończyć kolekcję w całości i oczekuje, że aplikacja nie zawiedzie w terenie.
- **Pasjonat:** czyta opisy i ceni rzetelne treści bardziej niż grywalizację.
- **Kurator instytucjonalny i społecznościowy:** gmina, oddział PTTK, organizacja turystyczna, przewodnik albo historyk; chce prosto pokazać lokalne dziedzictwo i mieć kontrolę nad tym, jak jest przedstawione.

## Kto korzysta

- **Gość** (bez konta) ogląda opublikowane kolekcje i miejsca. Zapis kolekcji, wizyta i lista „Chcę zobaczyć” wymagają konta; przycisk prowadzi do logowania, a po nim z powrotem na tę samą stronę.
- **Odkrywca** zakłada konto sam, logując się jednorazowym kodem z e-maila (bez hasła). Zapisuje kolekcje, potwierdza wizyty i prowadzi listę „Chcę zobaczyć”. Nie widzi cudzych prywatnych danych.
- **Kurator** to członek organizacji kuratorskiej. Organizacja (gmina, PTTK, lokalna lub regionalna organizacja turystyczna) albo osoba (przewodnik, historyk) zostaje kuratorem dopiero po akceptacji administratora; zwykłe konto nie może samo nadać sobie tej roli. Kurator tworzy i publikuje kolekcje i miejsca swojej organizacji w panelu na komputerze. Nie widzi, kto odwiedził jakie miejsce, i nie zmieni treści innej organizacji.
- **Administrator** nadaje status kuratora. W aplikacji nie ma wglądu w prywatne dane odkrywców.

## Najważniejsze reguły

- **Dwa rodzaje wizyty.** Wizyta na miejscu jest potwierdzana lokalizacją urządzenia: liczy się, gdy odkrywca jest w promieniu ustawionym przez kuratora (od 50 m do 2 km, domyślnie 200 m), a odczyt lokalizacji jest dokładny co najmniej do 150 m. Wizytę z przeszłości odkrywca zaznacza sam, także z laptopa: na ekranie miejsca przyciskiem „Zapisz wizytę z przeszłości”, a na stronie kolekcji w trybie „Zaznacz odwiedzone” (do 100 miejsc naraz, z jedną datą). Data może być dokładnym dniem, miesiącem, rokiem albo „nie pamiętam”; taka wizyta ma odznakę „Z przeszłości”, można ją usunąć, a późniejsze potwierdzenie na miejscu ma pierwszeństwo. Oba rodzaje liczą się do postępu.
- **Poza promieniem** aplikacja nie potwierdza wizyty, tylko pokazuje odległość („Jesteś 6,2 km od miejsca”) i proponuje ponowne sprawdzenie, zapis na liście „Chcę zobaczyć” albo zapisanie wizyty z przeszłości. Przy zbyt niedokładnym odczycie prosi o próbę na zewnątrz albo proponuje zapisanie wizyty z przeszłości.
- **Prywatność lokalizacji.** Aplikacja nie zapisuje położenia telefonu ani dokładności odczytu, tylko to, które miejsce odwiedzono, kiedy (czas serwera) i jakim rodzajem wizyty. Współrzędne nie trafiają do logów. Zgoda przeglądarki na lokalizację obejmuje całą aplikację, a nie pojedynczą funkcję. To świadomy kompromis na rzecz prostej konfiguracji; lokalizacja jest używana tylko przy potwierdzaniu wizyty i nie jest zapisywana.
- **Świadomie przyjęte ryzyko.** Lokalizację zgłaszaną przez urządzenie da się podrobić, więc potwierdzenie wizyty opiera się na zaufaniu do odkrywcy. Przyjęliśmy to ryzyko świadomie: wizyta nie daje dziś żadnej nagrody materialnej, a odkrywca i tak może sam zaznaczyć wizytę z przeszłości.
- **Postęp** pokazujemy jako liczbę odwiedzonych z liczby wszystkich (9/24), nie procentem. Liczą się miejsca, które są obecnie w kolekcji.
- **Jedno miejsce w wielu kolekcjach.** Jedna wizyta zalicza miejsce we wszystkich kolekcjach, w których ono jest.
- **Wizyty nie znikają.** Gdy kurator usunie miejsce z kolekcji albo wycofa publikację, wizyty i zapisy odkrywców zostają. Kolekcji, która była kiedykolwiek opublikowana, nie da się usunąć.
- **Zdjęcia odkrywców** (w planie): można je dodać dopiero po wizycie, a inni widzą je po akceptacji kuratora. Zdjęcia na licencjach Creative Commons mają przy sobie autora, źródło i licencję.
- **Karty legendarne** (w planie): za udział w wydarzeniu zorganizowanym przez kuratora odkrywca dostaje wyjątkową kartę, którą ogląda w swojej skrytce.

## Zakres pierwszej wersji

Pierwsza wersja obejmuje wszystkie ekrany z makiet właściciela: album i kolekcje, stronę miejsca z potwierdzaniem wizyty, listę „Chcę zobaczyć”, zdjęcia z moderacją, zgłoszenia poprawek, wydarzenia i karty legendarne, aktualności, własne kolekcje odkrywców (prywatne i publiczne po akceptacji administratora), profil i ustawienia oraz pełny panel kuratora. Podział na epiki i historyjki opisuje [Backlog](backlog.md), a to, co już działa, [Stan realizacji](stan-realizacji.md).

Później przyjdzie m.in. aplikacja na Androida.

## MVP: wersja konkursowa

Najmniejsza wersja, która pokazuje sens produktu od początku do końca, to jedna pełna ścieżka z kontrolą uprawnień:

1. Administrator nadaje organizacji status kuratora.
2. Kurator tworzy kolekcję z miejscami, ustala promień potwierdzania i ją publikuje.
3. Gość znajduje kolekcję na stronie głównej albo w wyszukiwarce i ogląda ją bez konta.
4. Odkrywca zakłada konto kodem z e-maila, akceptuje regulamin, zapisuje kolekcję i widzi postęp 0/N.
5. Odkrywca potwierdza wizytę lokalizacją na miejscu albo zaznacza wizytę z przeszłości, a postęp rośnie.
6. Kurator innej organizacji ani inny odkrywca nie widzą jego danych.

Do wersji konkursowej należą też strona główna z albumem, wyszukiwarka, kolekcja jako album z mapą, lista „Chcę zobaczyć”, profil ze statystykami, usunięcie konta, regulamin i polityka prywatności. Zdjęcia, zgłoszenia, wydarzenia i karty legendarne, aktualności, własne kolekcje odkrywców i ekrany administratora przychodzą w kolejnych wydaniach. Przed konkursem weszły ich najprostsze części: zdjęcia miejsc z Wikimedia Commons, odnośnik „Zgłoś naruszenie”, aktualności pisane przez zespół Krajozbioru i prywatne kolekcje odkrywców ([Stan realizacji](stan-realizacji.md)).

## Czego nie robimy

- Ocen miejsc gwiazdkami ani punktami.
- Emoji w treściach i interfejsie.

## Wygląd i dostępność

Kierunek wizualny to „nocny album kolekcjonerski”: ciemny motyw domyślny, jasny motyw z tych samych tokenów, jeden pomarańczowy akcent i perłowy połysk zarezerwowany dla kart legendarnych. Interfejs jest po polsku i zwraca się do odkrywcy na „Ty”. Obowiązuje standard dostępności WCAG 2.2 na poziomie AA w obu motywach, a ustawienie „ogranicz ruch” w systemie wyłącza animacje. Telefon to osobne układy ekranów do użycia w terenie; na ekranie miejsca główny przycisk („Potwierdzam wizytę”, potem „Odwiedzone”) jest przypięty do dolnej krawędzi, więc zawsze jest pod kciukiem, także po przewinięciu opisu; panel kuratora jest projektowany na komputer. Szczegóły: [docs/design/](../design/README.md).
