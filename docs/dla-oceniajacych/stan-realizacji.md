# Stan realizacji

## W skrócie

Ten plik mówi, co w Krajozbiorze już działa (każdy punkt to scalony PR, czyli zmiana w kodzie, którą można otworzyć na GitHubie), co jest w toku i co przyjdzie później. Działa pełna ścieżka konkursowa: kurator tworzy i publikuje kolekcję, gość znajduje ją na stronie głównej albo w wyszukiwarce, odkrywca zakłada konto, zapisuje kolekcję, potwierdza wizytę lokalizacją (albo zapisuje wizytę z przeszłości) i widzi postęp, a testy sprawdzają, że kurator innej organizacji i inny odkrywca dostają odmowę. Wokół tej ścieżki działają też zdjęcia miejsc z Wikimedia Commons, aktualności redakcji, własne prywatne kolekcje odkrywców, profil ze statystykami i usunięcie konta. Stan na 28 listopada 2026 roku; pełna, bieżąca lista scalonych zmian jest w [historii PR-ów repozytorium](https://github.com/MariuszSkowron/krajozbior/pulls?q=is%3Apr+is%3Amerged).

Epiki (E1–E12) i ich historyjki opisuje [Backlog](backlog.md); listę zmian w formie dziennika: [CHANGELOG.md](../../CHANGELOG.md).

## Działa (scalone do `main`)

### Ścieżka konkursowa (E1 i E2)

- Logowanie jednorazowym kodem z e-maila, z limitami prób; konta demonstracyjne do lokalnego uruchomienia.
- Organizacje kuratorskie i polecenie administratora nadające status kuratora, z dziennikiem operacji (#10, poprawka dziennika w #22).
- Katalog kolekcji i miejsc z publikacją, wycofaniem publikacji i usuwaniem szkiców (#11).
- Panel kuratora na komputerze: lista kolekcji, edytory kolekcji i miejsca, kolejność miejsc (#13).
- Publiczne strony kolekcji i miejsca dla gościa (#14).
- Album odkrywcy w bazie: zapisane kolekcje, wizyty, lista „Chcę zobaczyć” z regułami dostępu (#15).
- „Moje kolekcje” z postępem X/Y (#16).
- Potwierdzanie wizyty na miejscu lokalizacją, z obsługą „poza promieniem” i „zbyt niedokładnie”, oraz test E2E całej ścieżki (#17).
- Lista „Chcę zobaczyć” (#18).
- Limity długości list i liczby zapisów oraz bezpieczniejszy zapis do albumu (#27).
- Adres (slug) kolekcji powstaje z jej aktualnego tytułu przy pierwszej publikacji i potem się nie zmienia (#29).
- Wizyta z przeszłości, pojedyncza i wiele naraz (do 100 miejsc z jedną datą), z odznaką „Z przeszłości” i pierwszeństwem potwierdzenia na miejscu (#34).
- Test pilnujący, że współrzędne wizyty nie trafiają do logów ani do odpowiedzi błędu (#36).
- Ostrzeżenie przy miejscu prywatnym, ogrodzonym lub w ruinie: kurator ustawia „Wejście na teren”, a odkrywca widzi prośbę, by nie wchodzić (#85).

### Panel kuratora po uwagach właściciela (E1)

- Pinezka na mapie zamiast wpisywania współrzędnych i komunikat po zapisie miejsca (#109).
- Kurator po zalogowaniu trafia do swojego panelu (#121).
- Publikacja nie gubi niezapisanego tekstu, a zapis tuż po publikacji nie zgłasza fałszywego konfliktu (#120, #124).
- Ostrzeżenie o niezapisanych zmianach, link do publicznej strony kolekcji, liczba zapisów kolekcji i wyszukiwanie adresu (#137).

### Wygląd (E3 i nowy wygląd z decyzji D-57)

- Tokeny wyglądu, kroje i przełącznik motywu nocny/jasny (#25), motyw zapamiętany na koncie (#78).
- Nawigacja (dolny pasek na telefonie, menu boczne na komputerze), menu kuratora i wspólne elementy (#28).
- Ekrany ścieżki w nowym wyglądzie z testem dostępności w obu motywach (#31) i przypięty przycisk wizyty na telefonie (#32).
- Wspólna rama strony do 1440 px (#127).
- Nowy wygląd strony kolekcji (okładka ze zdjęciem, duży postęp i kafelki miejsc, #129), strony miejsca (dwie kolumny i karty kolekcji, #130) i strony głównej (baner ze zdjęciem na całą szerokość, #132, losowanym z listy wybranych miejsc, #133).

### Pierwszy kontakt i ścieżka po wizycie (decyzja D-58, poprawki po pokazie)

- Teksty bez form zależnych od płci, spójne nazwy i daty (#98), jaśniejszy stan wizyty na stronie miejsca (#106), prostsza strona kolekcji (#108), poprawki po przeglądzie całej aplikacji (#122, #125).
- Logowanie kodem w dwóch krokach (#104), nagłówek z imieniem i opisem roli (#115).
- Wejścia „Zaloguj się” i „Załóż konto”, ekran Start dla nowej osoby i test E2E „złotej ścieżki” (#134).
- Po wizycie od razu odświeżony postęp, podpowiedź „Co dalej” i jeden stan „Kolekcja kompletna” (#135).
- Krótkie podpisy zdjęć, przycisk „Pokaż najbliższe” i drobne poprawki (#136).

### Zdjęcia miejsc z Wikimedia Commons (E4, część przed konkursem)

- Przygotowanie: miejsce na zdjęcia na serwerze (#81), bezpieczne zmniejszanie zdjęć i usuwanie z nich metadanych (#82), dane, licencje i pobieranie (#86, #89, #91).
- Zdjęcie na stronie miejsca z podpisem autora i licencji (#88), okładka kolekcji ze zdjęcia, także w podglądzie linku (#100), miniatury na kartach miejsc (#123).
- Podpisy źródeł danych przy miejscach i strona „Źródła danych” (#71).

### Zgłoszenia i kontakt (E5 i E9, pierwsze kroki)

- Odnośnik „Zgłoś naruszenie” w stopce i na stronie miejsca, otwierający gotową wiadomość e-mail (#97).
- Odnośnik „Napisz do nas” w Profilu (#95).

### Aktualności redakcji (E7, wersja przed konkursem)

- Zasady treści i stanów aktualności (#93), tabela z regułami dostępu i funkcją operatora (#101).
- Wgrywanie aktualności z pliku (#107) i tryb w skrypcie wdrożenia (#110).
- Strony aktualności dla odkrywców i gości (#111), ze zdjęciem miejsca lub kolekcji (#138).

### Własne kolekcje odkrywców (E8, pierwszy krok)

- Prywatna kolekcja odkrywcy z miejscami z katalogu, widoczna tylko dla autora, z postępem X/Y w „Moich kolekcjach” (#105).

### Profil (E9)

- Ekran profilu i wylogowanie (#42), usunięcie konta z ekranu ustawień (#43).
- Imię, województwo i widoczność profilu (#50), statystyki: odkryte miejsca, województwa, kolekcje i kilometry (#54).

### Odkrywanie (E12)

- Strona główna: album odkrywcy i kolekcje do odkrycia (#38), od #114 jedna sekcja kolekcji.
- Wyszukiwarka kolekcji i miejsc, niezależna od polskich znaków (#39).
- Kolekcje w okolicy, liczone w przeglądarce bez wysyłania pozycji (#40).
- Kolekcja jako album: filtr, siatka i panel miejsca (#41), mapa na stronie kolekcji (#49, #131).
- Oznaczenie „Nowa w okolicy” i filtr „Moich kolekcji” według postępu (#79, uproszczony w #112).

### Wdrożenie i dane (E11)

- Wgrywanie gotowych kolekcji z pliku poleceniem operatora (#47, #53; opis: [docs/catalog-import.md](../catalog-import.md)), także na serwer jednym poleceniem właściciela (#74, #77).
- Obraz produkcyjny, konfiguracja serwera i trwały pokaz lokalny (#55), wdrożenie jednym poleceniem z powrotem do poprzedniej wersji (#62; opis: [docs/deployment.md](../deployment.md)).
- Wysyłka kodów logowania e-mailem i kontrola konfiguracji przy starcie (#57).
- Regulamin, polityka prywatności, stopka i akceptacja regulaminu przy pierwszym logowaniu (#58, uzupełnienia polityki w #64 i #102).
- Logi bez danych osobowych, limity przed otwarciem serwisu, limit czasu zapytań, limity wielkości formularzy i usuwanie wygasłych sesji (#60, #61, #76, #83, #84, #90).

### Przygotowanie kolejnych epików (jeszcze niewidoczne dla użytkowników)

- Karty legendarne (E6): reguły czasu wydarzeń (#126) oraz karta i scena odsłonięcia w katalogu komponentów (#128).
- Administrator (E10): próba weryfikacji dwuetapowej z zasadami sesji administratora, sam test (#103).

### Proces i zabezpieczenia

- Hooki: blokada zapisu plików poleceniami terminala (#33) oraz zdalnego dostępu i kluczy (#59).
- Statusy przeglądu ustawia właściciel jednym poleceniem; agent nie ma już na to zgody (#66, #70).
- Właściciel kodu domyślnie dla całego repozytorium i ochrona skilli agentów (#56).
- Cztery skille przeglądu tekstów i ekranów oraz zasada przeglądu zmian widocznych dla użytkownika (#96).
- Strażnik bazy we wszystkich testach E2E (#35), testy z bazą na kilku stanowiskach naraz (#67, #80), stabilniejsze testy (#51, #72, #73, #75, #87, #94, #99, #113, #118, #119).
- Reguła lint i analiza CodeQL także dla szkiców PR (#44, #45, #48).
- Publiczne notatki bezpieczeństwa i wynik powtórzonej próby prompt injection (#63, #65).
- Jedna wersja zasad przeglądów, testów i statusów dla agentów (#139).

### Po pokazie: zgłoszenia, krainy, powody do powrotu i bezpieczeństwo logowania

- Stabilny test filtra „Moich kolekcji” i wyglądu listy „Chcę zobaczyć” (#140).
- Wyższy dzienny limit kodów logowania na adres IP, komunikat po jego wyczerpaniu i liczba zapisów kolekcji „mniej niż 3” (#141, D-62); osobne dzienne pule kodów, limit 5 kodów na skrzynkę i trzecie wyjście na ekranie kodu (#147, D-61, D-64).
- Potwierdzenie wizyty działa też w starszych przeglądarkach, a odnośniki do autorów zdjęć mają `rel="ugc nofollow"` (#142).
- Adresy kontaktowe w domenie krajozbior.pl, plik `security.txt` i ostrzeżenie w e-mailu z kodem (#143).
- Kolejka zgłoszeń problemów z miejscami w panelu kuratora (#144) oraz formularz zgłoszenia dla odkrywcy, „Moje zgłoszenia” i limity (#149).
- Kolekcje obejmujące kilka województw (krainy): filtr, wyszukiwanie, karty i import (#145, D-63).
- Jeden punkt wejścia dla oceniających, aktualny stan realizacji i spis „co wynika z czego” (#146).
- Ekran Start z powodami do powrotu: miejsce dnia, nowe kolekcje, aktualności i „co zostało” (#148, D-58).
- Odmowa akceptacji regulaminu usuwa konto od razu, a konta bez akceptacji znikają po 7 dniach (#150, D-67).

## W toku

Otwarte PR-y (stan na 28 listopada 2026 roku, aktualna lista jest w [zakładce PR-ów](https://github.com/MariuszSkowron/krajozbior/pulls)):

- Dokumenty prawne w wersji 1.1 (regulamin, polityka prywatności, zasady, oświadczenie), strona załącznika nr 2 `/umowa-powierzenia`, pasek „Wersja konkursowa”, blok „Zostań kuratorem — w przygotowaniu” i włączone zgłoszenia problemów z miejscami we wdrożeniu (#151, D-66, D-67).

Poza PR-ami: uruchomienie aplikacji pod publicznym adresem (adres dopiszemy w [Dla oceniających](README.md)) i oznaczenie wydania 1.0.0 ([CHANGELOG.md](../../CHANGELOG.md)).

## Planowane (zakres pierwszej wersji)

Po wydaniu konkursowym przychodzą m.in.: zdjęcia odkrywców z moderacją kuratora (E4), zgłoszenia poprawek z kolejką kuratora (E5), wydarzenia, karty legendarne i skrytka (E6), aktualności pisane przez kuratorów (E7), publiczne kolekcje odkrywców po akceptacji administratora (E8), ekrany administratora i zespół organizacji (E10). Stan każdego epiku: [Backlog](backlog.md).
