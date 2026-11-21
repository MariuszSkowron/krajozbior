# Stan realizacji

## W skrócie

Działa pełna ścieżka konkursowa: kurator tworzy i publikuje kolekcję, gość znajduje ją na stronie głównej albo w wyszukiwarce, odkrywca zapisuje ją u siebie, potwierdza wizytę lokalizacją (albo zapisuje wizytę z przeszłości) i widzi postęp, a testy sprawdzają, że kurator innej organizacji i inny odkrywca dostają odmowę. Doszły strona główna, wyszukiwarka, kolekcja jako album z mapą, profil ze statystykami, usunięcie konta oraz regulamin i polityka prywatności. Trwa przygotowanie do uruchomienia pod publicznym adresem. Stan na 21 listopada 2026 roku; aktualny stan pokazuje historia PR-ów (propozycji zmian w kodzie).

## Działa (scalone do `main`)

### Ścieżka konkursowa (epiki E1 i E2)

- Logowanie jednorazowym kodem z e-maila, z limitami prób; konta demonstracyjne do lokalnego uruchomienia.
- Organizacje kuratorskie i polecenie administratora nadające status kuratora, z dziennikiem operacji (PR #10, poprawka dziennika w PR #22).
- Katalog kolekcji i miejsc z publikacją, wycofaniem publikacji i usuwaniem szkiców (PR #11).
- Panel kuratora na komputerze: lista kolekcji, edytory kolekcji i miejsca, kolejność miejsc (PR #13).
- Publiczne strony kolekcji i miejsca dla gościa (PR #14).
- Album odkrywcy w bazie: zapisane kolekcje, wizyty, lista „Chcę zobaczyć” z regułami dostępu (PR #15).
- „Moje kolekcje” z postępem X/Y (PR #16).
- Potwierdzanie wizyty na miejscu lokalizacją, z obsługą „poza promieniem” i „zbyt niedokładnie”, oraz test E2E całej ścieżki (PR #17).
- Lista „Chcę zobaczyć” (PR #18).
- Limity długości list i liczby zapisów oraz bezpieczniejszy zapis do albumu (PR #27).
- Adres (slug) kolekcji powstaje z jej aktualnego tytułu przy pierwszej publikacji i potem się nie zmienia (PR #29).
- Wizyta z przeszłości, pojedyncza i wiele naraz (do 100 miejsc z jedną datą), z odznaką „Z przeszłości” i pierwszeństwem potwierdzenia na miejscu (PR #34).
- Test pilnujący, że współrzędne wizyty nie trafiają do logów ani do odpowiedzi błędu (PR #36).

### Wygląd „nocny album” (E3)

- Tokeny wyglądu, kroje i przełącznik motywu nocny/jasny (PR #25).
- Nawigacja (dolny pasek na telefonie, menu boczne na komputerze), menu kuratora i wspólne elementy (PR #28).
- Ekrany ścieżki w nowym wyglądzie z testem dostępności w obu motywach (PR #31).
- Przypięty przycisk wizyty na ekranie miejsca na telefonie (PR #32).

### Odkrywanie (E12)

- Strona główna: album odkrywcy i kolekcje do odkrycia (PR #38).
- Wyszukiwarka kolekcji i miejsc, niezależna od polskich znaków (PR #39).
- Kolekcje w okolicy, liczone w przeglądarce bez wysyłania pozycji (PR #40).
- Kolekcja jako album: filtr, siatka i panel miejsca (PR #41).
- Mapa na stronie kolekcji (PR #49).

### Profil (E9)

- Ekran profilu i wylogowanie (PR #42).
- Usunięcie konta z ekranu ustawień (PR #43).
- Imię, województwo i widoczność profilu (PR #50).
- Statystyki: odkryte miejsca, województwa, kolekcje i kilometry (PR #54).

### Kolekcje i przygotowanie do wdrożenia (E11)

- Wgrywanie gotowych kolekcji z pliku poleceniem operatora (PR #47, #53; opis: [docs/catalog-import.md](../catalog-import.md)).
- Obraz produkcyjny, konfiguracja serwera i trwały pokaz lokalny (PR #55; opis: [docs/deployment.md](../deployment.md)).
- Wysyłka kodów logowania e-mailem i kontrola konfiguracji przy starcie (PR #57).
- Regulamin, polityka prywatności, stopka i akceptacja regulaminu przy pierwszym logowaniu (PR #58, uzupełnienie polityki w PR #64).
- Zapisy w logach bez danych osobowych, limity przed otwarciem serwisu i limit czasu zapytań do bazy (PR #60, #61).

### Proces i zabezpieczenia

- Hook blokujący agentom zapis plików poleceniami terminala (PR #33).
- Strażnik bazy we wszystkich testach E2E (PR #35), stabilny pomiar wydajności wyszukiwarki (PR #51).
- Reguła lint i analiza CodeQL także dla szkiców PR (PR #44, #45, #48).
- Właściciel kodu domyślnie dla całego repozytorium i ochrona skilli agentów (PR #56).
- Publiczne notatki bezpieczeństwa (PR #63).

## W toku

- Uruchomienie aplikacji pod publicznym adresem; adres dopiszemy w [README](README.md) po uruchomieniu.
- Druga próba prompt injection przed konkursem; wynik trafi do [security-notes.md](../../security-notes.md).
- Wydanie 1.0 z listą zmian.

## Planowane (zakres pierwszej wersji)

Pełną listę epik ze stanem pokazuje [Backlog](backlog.md). Po wydaniu konkursowym przychodzą m.in.: zdjęcia z moderacją kuratora (E4), zgłoszenia poprawek (E5), wydarzenia i karty legendarne (E6), aktualności (E7), własne kolekcje odkrywców (E8), ekrany administratora i zespół organizacji (E10) oraz „Nowa w okolicy” i filtr „Moich kolekcji” (E12).
