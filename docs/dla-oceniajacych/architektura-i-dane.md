# Architektura i ochrona danych

## W skrócie

Krajozbiór to jedna aplikacja (Next.js z React 19 i TypeScript) z bazą PostgreSQL 17, bez osobnych usług. Dane użytkowników chronią dwie niezależne bariery: serwer sprawdza, kto wysyła żądanie i co mu wolno, a sama baza danych ma reguły dostępu do wierszy (RLS), które obowiązują nawet wtedy, gdyby kod aplikacji się pomylił. Każda taka reguła ma test, który próbuje ją obejść i oczekuje odmowy.

Pełne dokumenty techniczne: [docs/architecture.md](../architecture.md) (budowa aplikacji) i [docs/data-isolation.md](../data-isolation.md) (klasy danych, role bazy, macierz reguł, wymagane testy). Ten plik je streszcza.

## Budowa aplikacji

- `src/app`: strony i trasy API. Trasa sprawdza dane wejściowe, ustala, kto pyta, i wywołuje przypadek użycia.
- `src/features`: obszary produktu z własną logiką: tożsamość (logowanie), organizacje, katalog (kolekcje i miejsca), album, wizyty, „Chcę zobaczyć”. Reguły domeny są czystymi funkcjami z pełnym pokryciem testami.
- `src/design-system`: tokeny wyglądu, motywy i wspólne elementy interfejsu, bez reguł domeny.
- `src/lib`: baza, konfiguracja, nagłówki bezpieczeństwa, logowanie błędów.

Zapytania do bazy to jawny SQL z parametrami. Schemat zmienia się tylko wersjonowanymi migracjami.

## Logowanie

Konto zakłada każdy, logując się jednorazowym kodem wysłanym na e-mail. Logowanie i prośby o kod mają limity prób. Rola kuratora nie powstaje przy rejestracji: nadaje ją administrator osobnym poleceniem, a każde nadanie lub odebranie zostawia wpis w dzienniku operacji.

## Kto widzi jakie dane

Dane dzielimy na klasy:

- **Publiczne:** opublikowane kolekcje i miejsca zatwierdzonych organizacji. Widzi je każdy, także gość.
- **Dane kuratora:** szkice kolekcji i członkostwa w organizacji. Widzą je tylko członkowie tej organizacji.
- **Prywatne odkrywcy:** zapisane kolekcje, historia wizyt, lista „Chcę zobaczyć”. Widzi je wyłącznie właściciel konta; kurator nie ma do nich żadnej drogi, także dla miejsc własnej organizacji.
- **Systemowe:** dziennik operacji administracyjnych. Aplikacja nie ma do niego dostępu.

Szkic i nieistniejąca kolekcja dają tę samą odpowiedź „nie znaleziono”, więc z zewnątrz nie da się nawet ustalić, że szkic istnieje.

## Role w bazie danych

Aplikacja łączy się z bazą jako rola bez uprawnień administracyjnych i bez możliwości pominięcia reguł dostępu. Osobne role mają: logowanie (tylko własny schemat), polecenia administracyjne (tylko to, czego potrzebują) i migracje (właściciel tabel, używany wyłącznie przy wdrażaniu zmian schematu). Przy każdej transakcji aplikacja ustawia w bazie, w czyim imieniu działa, a reguły dostępu porównują z tym każdy wiersz.

## Ważniejsze rozwiązania

- **Decyzję o wizycie podejmuje baza.** Odległość od miejsca i dokładność odczytu sprawdza funkcja w bazie danych, nie przeglądarka. Wizyty „na miejscu” nie da się zapisać z pominięciem tej funkcji.
- **Kurator zmienia tylko swoje.** Reguły bazy pozwalają kuratorowi zmieniać kolekcje i miejsca jego organizacji i tylko wybrane pola; daty publikacji wylicza baza.
- **Dziennik operacji tylko do dopisywania.** Dziennik zapisuje osobna rola, która może dodawać wpisy, ale nie może ich zmienić ani wyłączyć ochrony. Zmiana roli konta na administratora bez wpisu w dzienniku jest odrzucana przez bazę.
- **Bez pamięci podręcznej dla danych prywatnych.** Strony i odpowiedzi z danymi odkrywcy mają nagłówek zakazujący zapisu w pamięci podręcznej, a zapisy sprawdzają pochodzenie żądania.
- **Nagłówki bezpieczeństwa** (polityka treści, HSTS i inne) ustawia jedno miejsce w kodzie, a test E2E sprawdza, że są obecne.

## Jak to jest sprawdzane

- Testy integracyjne na prawdziwej bazie PostgreSQL w katalogu `tests/integration/` sprawdzają odmowy dostępu: kurator organizacji B kontra szkic organizacji A, odkrywca B kontra dane odkrywcy A, gość kontra treści nieopublikowane, kurator kontra wizyty odkrywców.
- `tests/integration/rls-coverage.test.ts` po wszystkich migracjach sprawdza, że każda tabela ma włączone i wymuszone reguły dostępu.
- Testy E2E w przeglądarce (`e2e/`) przechodzą ścieżki z dwoma kontami i automatyczny test dostępności.
- CI uruchamia przy każdej zmianie formatowanie, lint, typy, testy jednostkowe z progiem pokrycia, build, testy integracyjne, E2E, skan sekretów i analizę kodu (CodeQL). Opis: [docs/testing.md](../testing.md).
