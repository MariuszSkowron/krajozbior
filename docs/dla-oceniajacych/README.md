# Dla oceniających

## W skrócie

Ten folder jest punktem wejścia dla osób, które oceniają Krajozbiór i nie znają projektu. Opisuje prostym językiem, czym jest aplikacja, jak chroni dane użytkowników, co zostało zaplanowane w specyfikacjach, jak powstaje kod (agenci AI z przeglądami i testami) i co już działa. Pełna dokumentacja projektu (decyzje właściciela, dzienniki pracy, notatki bezpieczeństwa) zostaje w osobnym, prywatnym repozytorium; tutaj są jej jawne streszczenia, napisane od nowa.

## Od czego zacząć

1. [Produkt](produkt.md): czym jest Krajozbiór, kto z niego korzysta i jakie reguły obowiązują.
2. [Stan realizacji](stan-realizacji.md): co już działa, co jest w toku i co przyjdzie później.
3. [Architektura i ochrona danych](architektura-i-dane.md): jak aplikacja jest zbudowana i kto widzi jakie dane.
4. [Specyfikacje](specyfikacje.md): streszczenie trzech specyfikacji, według których powstał dotychczasowy kod.
5. [Proces, przeglądy i bezpieczeństwo](proces-i-przeglady.md): jak pracują agenci AI, kto sprawdza ich zmiany i co wykazały przeglądy.

## Jak sprawdzić samodzielnie

- **Uruchomienie lokalne:** instrukcja w [README.md](../../README.md), sekcja „Uruchomienie lokalne”. Polecenie `npm run db:seed:demo` zakłada konta demonstracyjne (odkrywcy i kuratorzy dwóch organizacji), a strona logowania poza trybem produkcyjnym pokazuje ich listę.
- **Test całej ścieżki:** `e2e/competition-path.spec.ts` przechodzi drogę od utworzenia kolekcji przez kuratora do potwierdzenia wizyty przez odkrywcę i sprawdza, że kurator innej organizacji dostaje odmowę.
- **Testy odmowy dostępu:** katalog `tests/integration/` (na prawdziwej bazie PostgreSQL), np. `catalog-access.test.ts`, `visits-access.test.ts`, `album-access.test.ts`. Test `rls-coverage.test.ts` sprawdza, że każda tabela ma włączone reguły dostępu.
- **Historia zmian:** zakładka Pull requests na GitHubie. Każdy PR zaczyna się wprowadzeniem po polsku; zadania z prywatnego repozytorium są oznaczone jako `docs#N`.

## Czego tu nie ma i dlaczego

- Strategii biznesowej, planów komercyjnych i analiz rynku: to materiały właściciela.
- Szczegółów ustaleń bezpieczeństwa: publikujemy liczby i stan poprawek, nie opis słabości, które mogłyby jeszcze być otwarte.
- Danych osobowych, sekretów i informacji o infrastrukturze.

Dokumentacja opisuje stan z 18 listopada 2026 roku. Gdy opis i kod się różnią, rozstrzyga kod i testy.
