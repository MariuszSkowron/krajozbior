# Zasady właściciela Z-1…Z-13

Główna lista kontrolna skilla `przeglad-ux` (krok 5) i nakładki przeglądu UX jednego PR. Zasady ustalił właściciel produktu 22.11.2026 po przejściu aplikacji. Sprawdzasz je na każdym ekranie ścieżki, a w raporcie powołujesz się na numer (np. „łamie Z-3”).

Przykłady pokazują, jakiego rodzaju ustaleń oczekujemy; to opisy typowych przypadków, nie lista błędów do odhaczenia. Jeśli opisany przypadek jest już naprawiony, nie zgłaszaj go; jeśli wrócił albo jest naprawiony tylko częściowo, zgłoś to wprost.

| Nr | Zasada | Jak sprawdzić | Przykład z ekranów |
|---|---|---|---|
| Z-1 | Nie pytamy dwa razy o to samo. | Przejdź każdy formularz wielokrokowy do końca. Czy któreś pole lub decyzja powtarza się w kolejnym kroku albo na kolejnym ekranie? | Formularz logowania prosi o e-mail drugi raz w następnym kroku. |
| Z-2 | Każda akcja zmienia widoczny stan tam, gdzie użytkownik patrzy. | Po kliknięciu akcji nie przewijaj i nie przechodź gdzie indziej: czy w miejscu kliknięcia widać, że coś się stało (zmieniony przycisk, znacznik, komunikat obok)? | Po zapisaniu wcześniejszej wizyty przycisk wygląda tak samo jak przed kliknięciem. |
| Z-3 | Po zapisaniu formularz się zamyka, a użytkownik wraca tam, skąd przyszedł, i widzi potwierdzenie. | Zapisz każdy formularz edycji. Gdzie lądujesz? Czy widzisz komunikat przy zmienionym elemencie? | Po zapisaniu zmian w miejscu formularz edycji zostaje otwarty. |
| Z-4 | Filtr ani zakładka nie przewijają strony. | Przewiń do filtra lub zakładek, kliknij każdą opcję i porównaj położenie przewinięcia przed i po (zrzut obu stanów). | Filtr miejsc odwiedzonych przenosi na górę strony. |
| Z-5 | Jedna funkcja ma jedno miejsce; dwie sekcje nie robią tego samego. | Wypisz sekcje ekranu i ich cel jednym zdaniem. Dwie sekcje o tym samym celu albo blok, który należy do innego ekranu, to ustalenie. | Blok z nowościami w okolicy stoi na ekranie zapisanych kolekcji; dwie sekcje strony głównej polecają kolekcje według tego samego klucza. |
| Z-6 | Bez paneli i etykiet, które nic użytkownikowi nie mówią. | Dla każdego panelu i etykiety zapytaj: co użytkownik z tym zrobi? Jeśli nic, to szum. | Karta „Wybrane miejsce” bez akcji; ogólny napis „Użytkownik” w nagłówku. |
| Z-7 | Ekran mówi językiem roli: kurator nie widzi współrzędnych, odkrywca nie widzi pojęć technicznych. | Szukaj nazw z kodu lub bazy, identyfikatorów, współrzędnych, jednostek technicznych, angielskich wartości słownikowych w widoku danej roli. | Formularz nowego miejsca każe kuratorowi wpisać szerokość i długość geograficzną oraz promień w metrach. |
| Z-8 | Rola jest jasna od zalogowania. | Zaloguj się każdą rolą. Dokąd trafiasz? Czy nagłówek i profil mówią to samo o tym, kim jesteś? | Profil kuratora podaje ogólną rolę użytkownika, a nagłówek pokazuje panel kuratora. |
| Z-9 | Formularz sprawdza sensowność danych, nie tylko ich format. | Wpisz dane poprawne w formacie, ale sprzeczne (miasto z innego województwa, data z przyszłości, miejsce spoza regionu). Czy formularz reaguje? | Formularz przyjmuje miasto z województwem, w którym to miasto nie leży; kolekcja regionalna przyjmuje miejsce z innego regionu. |
| Z-10 | Na komputerze wykorzystujemy szerokość ekranu. | Przy 1440 px zmierz, ile szerokości zajmuje treść. Wąska kolumna z pustymi pasami po bokach i „ściśniętym” tekstem to ustalenie. | Strona główna na szerokim ekranie z dużymi pustymi marginesami. |
| Z-11 | Linki i przyciski wyglądają jak w design systemie, nigdy jak domyślne w przeglądarce. | Szukaj linków w domyślnym niebieskim kolorze z podkreśleniem, przycisków z szarym tłem systemu. Porównaj z historiami komponentów w plikach `*.stories.tsx`. | Link do listy wszystkich kolekcji w domyślnym stylu przeglądarki. |
| Z-12 | Widoki powiązane (lista i mapa) są razem, gdy mieszczą się na ekranie. | Gdzie użytkownik musi przełączać między dwoma widokami tych samych danych, sprawdź, czy przy 1440 px zmieściłyby się obok siebie. | Przełącznik „Karty / Mapa” w kolekcji na szerokim ekranie. |
| Z-13 | Ułatwienia dostępności zostają, ale nie zaśmiecają widoku. | Zauważ elementy dla klawiatury i czytnika ekranu widoczne stale. Proponuj ukrycie wizualne z pokazaniem przy fokusie, nigdy usunięcie. | Link „Pomiń mapę” widoczny cały czas, także bez fokusu. |

## Jak nie nadużywać listy

- Zasada musi pasować do obserwacji, a nie odwrotnie. Gdy ustalenie nie pasuje do żadnej zasady, przypisz je do listy wizualnej lub dostępności, a nie naginaj.
- Z-10 i Z-12 nie dotyczą panelu kuratora na telefonie (panel jest tylko na komputer, `docs/design/accessibility.md`) ani ekranów, które na telefonie mają osobny wzorzec.
- Z-7 nie oznacza ukrywania danych przed kuratorem: współrzędne mogą zostać w zwiniętej części „zaawansowane”, jeśli wymaga ich specyfikacja.
