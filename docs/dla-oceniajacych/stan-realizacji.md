# Stan realizacji

## W skrócie

Działa pierwsza pełna ścieżka: kurator tworzy i publikuje kolekcję, gość ją ogląda, odkrywca zapisuje ją u siebie, potwierdza wizytę lokalizacją (albo zapisuje wizytę z przeszłości) i widzi postęp, a test sprawdza, że kurator innej organizacji dostaje odmowę. Wygląd „nocnego albumu” jest wdrożony na ekranach ścieżki. Pozostałe części pierwszej wersji (zdjęcia, karty legendarne, aktualności, profil i inne) są w planie. Stan na 18 listopada 2026 roku; aktualny stan pokazuje historia PR-ów (propozycji zmian w kodzie).

## Działa (scalone do `main`)

- Logowanie jednorazowym kodem z e-maila, z limitami prób; konta demonstracyjne do lokalnego uruchomienia.
- Organizacje kuratorskie i polecenie administratora nadające status kuratora, z dziennikiem operacji (PR #10, poprawka dziennika w PR #22).
- Katalog kolekcji i miejsc z publikacją, wycofaniem publikacji i usuwaniem szkiców (PR #11).
- Panel kuratora na komputerze: lista kolekcji, edytory kolekcji i miejsca, kolejność miejsc (PR #13).
- Publiczne strony kolekcji i miejsca dla gościa (PR #14).
- Album odkrywcy w bazie: zapisane kolekcje, wizyty, lista „Chcę zobaczyć” z regułami dostępu (PR #15).
- „Moje kolekcje” z postępem X/Y (PR #16).
- Potwierdzanie wizyty na miejscu lokalizacją, z obsługą „poza promieniem” i „zbyt niedokładnie”, oraz test E2E całej ścieżki (PR #17).
- Lista „Chcę zobaczyć” (PR #18).
- Tokeny wyglądu, kroje i przełącznik motywu nocny/jasny (PR #25).
- Drobne poprawki bezpieczeństwa: limity długości list i liczby zapisów oraz bezpieczniejszy zapis do albumu, wykonywany jednym poleceniem bazy z warunkiem (PR #27).
- Nowa nawigacja „nocnego albumu” (dolny pasek na telefonie, menu boczne na komputerze), menu kuratora i wspólne elementy: karta kolekcji, odznaka statusu i pasek postępu (PR #28, krok E3-2a).
- Adres (slug) kolekcji powstaje z jej aktualnego tytułu przy pierwszej publikacji i potem się nie zmienia, więc udostępnione linki działają dalej (PR #29).

- Ekrany ścieżki w wyglądzie „nocny album” z testem dostępności w obu motywach (PR #31, krok E3-2b).
- Przypięty przycisk wizyty na ekranie miejsca na telefonie: „Potwierdź wizytę”, po wizycie „Odwiedzone”; zastępuje tam dolny pasek nawigacji (PR #32).
- Wizyta z przeszłości, pojedyncza i wiele naraz (do 100 miejsc z jedną datą), z odznaką „Z przeszłości”, usuwaniem i pierwszeństwem potwierdzenia na miejscu; to ostatni element ścieżki konkursowej (PR #34).
- Hook blokujący agentom zapis plików poleceniami terminala (PR #33, zob. [Proces](proces-i-przeglady.md)).

## W toku

- Test automatyczny wizyty z przeszłości w pełnej ścieżce E2E (docs#106).
- Ta dokumentacja dla oceniających.

## Planowane (zakres pierwszej wersji)

Plan dzieli pierwszą wersję na epiki:

- **E1–E2:** organizacje, katalog i album odkrywcy (ścieżka konkursowa, zrobiona, z wizytą z przeszłości; w planie m.in. współzarządzanie kolekcją przez kilka organizacji i historia zmian miejsca).
- **E3:** wygląd „nocny album” (ekrany ścieżki gotowe).
- **E4:** zdjęcia oficjalne, okładki, zdjęcia odkrywców z moderacją kuratora.
- **E5:** zgłoszenia poprawek i problemów z miejscem, kolejka zgłoszeń kuratora.
- **E6:** wydarzenia, karty legendarne i skrytka.
- **E7:** aktualności od kuratorów.
- **E8:** własne kolekcje odkrywców.
- **E9:** profil, statystyki, ustawienia i usunięcie konta.
- **E10:** ekrany administratora i zespół organizacji.
- **E11:** uruchomienie pod publicznym adresem, regulamin i polityka prywatności.
- **E12:** strona główna, wyszukiwarka i mapa.
