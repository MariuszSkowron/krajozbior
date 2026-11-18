# Architektura

## W skrócie

Jedna aplikacja Next.js z PostgreSQL, bez osobnych usług. Dane chronią dwie bariery: kontrola uprawnień na serwerze i reguły bazy (RLS). Kod dzieli się na routing (`src/app`), logikę funkcji (`src/features`), wspólny interfejs (`src/design-system`) i infrastrukturę (`src/lib`). Dokument opisuje kierunek; nie dowodzi, że każdy element jest wdrożony — stan ustalaj z kodu, migracji i testów.

## Kierunek

**Decyzja techniczna:** pojedyncza aplikacja Next.js App Router (wersja 16) z React 19 i TypeScript `strict`, PostgreSQL 17, MikroORM (migracje i połączenie), Zod, zmienne CSS i CSS Modules (bez Tailwind CSS i bez biblioteki komponentów; zob. `docs/design/ui-foundation.md`). Jeden kod aplikacji, bez monorepo i bez kontenera DI. Granice modułów i jawne parametry funkcji wystarczą na skalę małego zespołu.

Build i praca nad UI nie wymagają działającej bazy. PostgreSQL jest potrzebny funkcjom z trwałymi danymi; lokalnie można użyć Docker Compose (`compose.yaml`), nigdy jako wymogu wdrożenia.

## Granice aplikacji

- `src/app` — routing, układy, strony i cienkie Route Handlers. Komponent serwerowy jest domyślny; komponent klienta powstaje tylko tam, gdzie potrzebna jest interakcja przeglądarkowa.
- `src/features` — pionowe obszary produktu i ich logika (domena, przypadki użycia, adaptery). Powstają razem z funkcją, nie „na zapas”. Szkielet zawiera obszar tożsamości (logowanie).
- `src/design-system` — tokeny, motyw, komponenty i wzorce (`tokens`, `theme`, `components`, `patterns`), bez reguł domenowych; zob. `docs/design/architecture.md`.
- `src/lib` — infrastruktura wspólna: konfiguracja, baza, walidacja, nagłówki bezpieczeństwa, logowanie błędów.
- `tests`, `e2e` — testy poza kodem produkcyjnym.

Route Handler odbiera żądanie, waliduje wejście (Zod), identyfikuje aktora, wywołuje przypadek użycia i mapuje wynik na odpowiedź HTTP. Reguły domeny nie należą do JSX ani do komponentów klienckich. Zależności (repozytorium, zegar, magazyn plików) przekazuje się jawnie.

## Baza danych

PostgreSQL jest źródłem prawdy. MikroORM odpowiada za migracje oraz połączenie i transakcję aplikacji z kontekstem użytkownika dla RLS (`src/lib/db/user-context.ts`). **Decyzja techniczna (odziedziczona z poprzedniego projektu):** brak encji ORM; zapytania to jawny, parametryzowany SQL (`em.execute`, dla danych prywatnych w transakcji z kontekstem użytkownika). Wprowadzenie encji wymaga wpisu w `<docs>/docs/decisions.md`. Build nie łączy się z bazą; połączenie powstaje przy pierwszej operacji.

Schemat zmienia się wyłącznie wersjonowanymi migracjami (`npm run db:migration:create`, `npm run db:migrate`). Ograniczenia relacyjne, unikalności i indeksy odzwierciedlają reguły domeny. RLS jest warstwą izolacji rekordów osobistych i uzupełnia, a nie zastępuje, autoryzację serwerową. Klasy danych, role bazy i polityki: `docs/data-isolation.md`.

Cztery role bazy: `krajozbior_owner` (migracje, właściciel obiektów), `krajozbior_app` (aplikacja, bez `BYPASSRLS`), `krajozbior_auth` (wyłącznie schemat `auth`), `krajozbior_ops` (operacje administracyjne). Tworzy je `npm run db:roles`.

## Uwierzytelnianie i autoryzacja

Logowanie realizuje better-auth z PostgreSQL (schemat `auth`), kodem jednorazowym wysyłanym na e-mail. Dostawca jest ukryty za granicą po stronie serwera (`src/features/identity`), więc domeny nie zależą od jego API. Nie implementujemy własnej kryptografii. Każde żądanie wrażliwe sprawdza sesję oraz właściciela rekordu lub rolę. Interfejs jedynie odzwierciedla uprawnienia; nie jest granicą bezpieczeństwa.

## Bezpieczeństwo aplikacji

Nagłówki bezpieczeństwa (CSP, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) ustawia `next.config.ts` przez `src/lib/security-headers.ts`. Konfigurację środowiska waliduje `src/lib/config/env.ts`. Błędy do użytkownika mają stabilne kody i bezpieczne komunikaty; szczegóły trafiają tylko do logu serwera (`src/lib/log-failure.ts`).

## Wymagania projektu wpływające na architekturę

Wynikają z ankiety przy zakładaniu projektu; szczegóły i uzasadnienia są w `<docs>/docs/product.md` i `<docs>/docs/decisions.md`.

- **[Z]** Aplikacja webowa z osobnymi układami na komputer i telefon; telefon jest używany w terenie. Natywna aplikacja mobilna nie należy do pierwszej wersji.
- **[Z]** Rejestracja publiczna: każdy zakłada konto kodem z e-maila. Rola kuratora (członek organizacji) i rola administratora nie powstają przy rejestracji; nadaje je administrator, a kurator zaprasza członków organizacji e-mailem.
- **[Z]** Role z zakresem: kurator ma uprawnienia tylko do kolekcji swojej organizacji, a w kolekcji współzarządzanej tylko w przyznanym zakresie. Kurator nie widzi prywatnych odwiedzin użytkowników. Każda taka reguła potrzebuje RLS i testu odmowy dostępu (`docs/data-isolation.md`).
- **[Z]** Produkt przyjmuje zdjęcia od użytkowników (JPG, PNG, do 20 MB), więc potrzebny jest magazyn plików poza bazą. Zdjęcie przed akceptacją jest prywatne, a plik nie może być dostępny pod publicznym adresem.
- **[Z]** Potwierdzenie wizyty korzysta z lokalizacji urządzenia (API geolokalizacji przeglądarki). Odległość od miejsca sprawdza serwer, nie tylko przeglądarka. **[P]** Pozycji urządzenia nie zapisujemy, tylko wynik sprawdzenia.
- **[Z]** Dwa motywy (nocny domyślny i jasny) z jednych tokenów, WCAG 2.2 AA, `prefers-reduced-motion` wyłącza animacje.

## Otwarte decyzje

Zbierane w `<docs>/docs/decisions.md`. Przy starcie projektu otwarte są: dostawca wdrożenia, wysyłka e-maili produkcyjnych, magazyn zdjęć i podkład mapy.
