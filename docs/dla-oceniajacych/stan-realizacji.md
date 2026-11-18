# Stan realizacji

## W skrócie

Działa pierwsza pełna ścieżka: kurator tworzy i publikuje kolekcję, gość ją ogląda, odkrywca zapisuje ją u siebie, potwierdza wizytę lokalizacją i widzi postęp, a test sprawdza, że kurator innej organizacji dostaje odmowę. W toku jest docelowy wygląd „nocnego albumu”. Pozostałe części pierwszej wersji (zdjęcia, karty legendarne, aktualności, profil i inne) przyjdą po konkursie. Stan na 18 listopada 2026 roku; aktualny stan pokazuje historia PR-ów.

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

## W toku

- Pozostałe dwa kroki wyglądu „nocny album”: nawigacja i wspólne elementy, potem przeniesienie wszystkich ekranów ścieżki z testem dostępności.
- Ta dokumentacja dla oceniających.
- Wizyta z przeszłości (zaznaczenie miejsc odwiedzonych przed założeniem konta, także wielu naraz) — po wyglądzie i dokumentacji, jeśli starczy czasu przed konkursem.

## Po konkursie (zakres pierwszej wersji)

Plan dzieli pierwszą wersję na epiki:

- **E1–E2:** organizacje, katalog i album odkrywcy (ścieżka konkursowa, zrobiona; po konkursie m.in. współzarządzanie kolekcją przez kilka organizacji i historia zmian miejsca).
- **E3:** wygląd „nocny album” (w toku).
- **E4:** zdjęcia oficjalne, okładki, zdjęcia odkrywców z moderacją kuratora.
- **E5:** zgłoszenia poprawek i problemów z miejscem, kolejka zgłoszeń kuratora.
- **E6:** wydarzenia, karty legendarne i skrytka.
- **E7:** aktualności od kuratorów.
- **E8:** własne kolekcje odkrywców.
- **E9:** profil, statystyki, ustawienia i usunięcie konta.
- **E10:** ekrany administratora i zespół organizacji.
- **E11:** uruchomienie pod publicznym adresem, regulamin i polityka prywatności.
- **E12:** strona główna, wyszukiwarka i mapa.
