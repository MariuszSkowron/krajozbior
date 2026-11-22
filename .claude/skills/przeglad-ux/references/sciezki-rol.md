# Ścieżki ról i warianty ekranu

Zadania do wykonania w krokach 3–4 skilla `przeglad-ux`. Lista tras odpowiada stanowi `src/app/` z 22.11.2026; przed przeglądem porównaj ją z `src/app/**/page.tsx` i dopisz nowe trasy do mapy pokrycia (krok 1 skilla).

## Zasada przejścia

- Każdą ścieżkę zaczynasz od strony startowej (`/`) albo od `/login`, nie od głębokiego adresu.
- Wcielasz się w role i persony opisane w `<docs>/docs/product.md`, sekcja „Użytkownicy i role”: ich cele, cierpliwość i znajomość pojęć. Bez dostępu do tego pliku poproś zlecającego o opis odbiorców zamiast zgadywać.
- Po każdej akcji, która zmienia dane, wróć na poprzedni ekran i sprawdź, czy pokazuje nowy stan bez odświeżania (lista, licznik, znacznik).
- Licz kliknięcia i ślepe zaułki; zapisz je przy ustaleniu.
- Akcji nieodwracalnych (usunięcie konta) nie kończysz na koncie, którego używają inne ścieżki; sprawdzasz ekran i potwierdzenie, a zatwierdzasz tylko na koncie przeznaczonym do tego w specu.

## Gość (bez logowania)

| Zadanie | Trasy |
|---|---|
| Zrozumieć w 10 sekund, czym jest aplikacja, i znaleźć ciekawą kolekcję | `/` |
| Wyszukać miejsce lub kolekcję po nazwie (także z literówką i bez polskich znaków) | `/search` |
| Obejrzeć kolekcję: postęp, filtr stanu, mapa | `/collections/[slug]` |
| Otworzyć miejsce: zdjęcia, opis, dostęp, ostrzeżenie o terenie prywatnym | `/places/[placeId]` |
| Spróbować zapisać kolekcję lub potwierdzić wizytę — czy zaproszenie do logowania jest jasne i wraca do tego samego miejsca? | jw. → `/login` |
| Znaleźć zasady, regulamin, politykę prywatności, źródła danych | `/zasady`, `/regulamin`, `/polityka-prywatnosci`, `/zrodla`, `/oswiadczenie-o-zdjeciach` |

## Odkrywca (`user@demo.krajozbior.local`; drugie konto `user2@…` do porównań)

| Zadanie | Trasy |
|---|---|
| Zalogować się i od razu wiedzieć, kim jestem i co dalej (Z-1, Z-8) | `/login` → `/` |
| Zapisać kolekcję i znaleźć ją w „Moich kolekcjach” | `/collections/[slug]`, `/my/collections` |
| Zaznaczyć wizytę z przeszłości i zobaczyć zmianę stanu i postępu (Z-2) | `/places/[placeId]`, `/collections/[slug]` |
| Potwierdzić wizytę na miejscu (lokalizacja ustawiona w przeglądarce po nadaniu uprawnienia `geolocation`: w promieniu i poza nim; odmowa dostępu: kontekst bez uprawnienia) | `/places/[placeId]` |
| Dodać miejsce do „Chcę zobaczyć” i je stamtąd usunąć | `/places/[placeId]`, `/my/want-to-see` |
| Przefiltrować kolekcję (odwiedzone, nieodwiedzone) bez utraty miejsca na stronie (Z-4) | `/collections/[slug]` |
| Zmienić profil, motyw i ustawienia; sprawdzić, co widać w nagłówku (Z-6) | `/my`, `/my/settings` |
| Przejść do usuwania konta i przeczytać potwierdzenie (bez zatwierdzania na wspólnym koncie) | `/my/delete-account` |
| Wylogować się i sprawdzić, dokąd trafiam | dowolna |

## Kurator (`curator-a@demo.krajozbior.local`)

Panel kuratora jest tylko na komputer (`docs/design/accessibility.md`): ścieżkę przechodzisz przy 1440 px, a przy 390 px sprawdzasz tylko, czy telefon dostaje sensowny komunikat zamiast połamanego panelu.

| Zadanie | Trasy |
|---|---|
| Zalogować się i trafić do panelu; nagłówek i profil mówią „kurator” i organizację (Z-8) | `/login` → `/curator` |
| Utworzyć kolekcję i ją opublikować | `/curator/collections/new`, `/curator/collections/[collectionId]` |
| Dodać nowe miejsce, podając adres jak człowiek, nie współrzędne (Z-7, Z-9) | `/curator/collections/[collectionId]/places/new` |
| Poprawić opis istniejącego miejsca i zapisać; gdzie ląduję, co widzę (Z-3) | `/curator/collections/[collectionId]/places/[placeId]` |
| Dodać do kolekcji miejsce spoza jej regionu (Z-9) | `/curator/collections/[collectionId]` |
| Obejrzeć opublikowaną kolekcję oczami odkrywcy | `/collections/[slug]` |

## Administrator (`admin@demo.krajozbior.local`)

Na 22.11.2026 w `src/app/` nie ma tras administratora. Sprawdź tylko logowanie, nagłówek i to, co administrator widzi na ekranach wspólnych (czy rola jest jasna, Z-8). Jeśli pojawiły się trasy administratora, dopisz je do mapy pokrycia i przejdź jak kuratora.

## Warianty

Każdy ekran ze ścieżek sprawdzasz w wariantach poniżej. Nie musisz mnożyć pełnych ścieżek: pełna ścieżka raz (telefon, motyw nocny dla odkrywcy; komputer, motyw jasny dla kuratora), a pozostałe warianty jako zrzuty kluczowych ekranów.

| Wariant | Ustawienie | Na co patrzeć |
|---|---|---|
| Telefon | 390 × 844 px, dotyk | osobny wzorzec ekranu, dolny pasek, cele dotykowe, brak przewijania w poziomie |
| Wąski telefon | 320 px, tekst 200% | ucinanie, zawijanie etykiet paska |
| Komputer | 1440 × 900 px | wykorzystanie szerokości (Z-10), lista i mapa razem (Z-12) |
| Motyw nocny i jasny | przełącznik motywu w nagłówku (także dla gościa) albo ciasteczko `krajozbior-theme=light` (`references/srodowisko-i-przejscie.md`, „Warianty w specu”); emulacja `prefers-color-scheme` nie działa w tej aplikacji | kontrast, odznaki na kartach, nic nie znika |
| Pusty | konto bez zapisanych kolekcji, bez wizyt, pusta lista „Chcę zobaczyć”, wyszukiwanie bez wyników | czy ekran mówi, co zrobić dalej |
| Błąd | nieistniejący adres (`/collections/nie-ma`), przerwane żądanie (emulacja offline w specu), zły kod lub hasło | zrozumiały komunikat, droga wyjścia |
| Ładowanie | spowolniona sieć w specu | brak pustej strony i skoku układu |
| Długa treść | najdłuższa nazwa i opis w danych demo; kolekcja z największą liczbą miejsc | zawijanie, ucinanie, wydajność listy |
| Klawiatura | sam Tab, Shift+Tab, Enter, Spacja, Esc | kolejność, fokus widoczny i niezasłonięty, „Przejdź do treści”, „Pomiń mapę” |
| Ograniczony ruch | `reducedMotion: "reduce"` | brak animacji |

Jeśli danych do wariantu nie ma w seedzie demo (np. kolekcji z 50+ miejscami), nie dopisuj ich do bazy na siłę: zapisz w raporcie „nie sprawdzono, brak danych” i zaproponuj fiksturę.
