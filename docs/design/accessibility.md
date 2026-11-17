# Dostępność: kontrakt design systemu

## W skrócie

Dostępność jest częścią kontraktu każdego komponentu, a nie osobnym ulepszeniem. Komponent, który jej nie spełnia, jest niedokończony, tak samo jak komponent bez stanu błędu. Dokument podaje cel zgodności, szablon kontraktu komponentu i sposób weryfikacji. Nie deklaruje, że jakakolwiek reguła jest już sprawdzona; wyniki zapisuje się w `<docs>/.ai/runs/`.

Oznaczenia: **[Z]** wymaganie, **[P]** propozycja, **[Decyzja techniczna]** wybór projektowy.

## 1. Zasada nadrzędna

**[Decyzja techniczna]** Każdy komponent i wzorzec ma wypełniony kontrakt (sekcja 3) i nie trafia do `src/design-system/` bez niego. Zmiana wyglądu nie może osłabić kontraktu — dostępności nie poświęca się dla wyglądu. Dotyczy to też komponentów zbudowanych na natywnym HTML i na bibliotece.

Natywny element lub biblioteka dostarcza mechanikę (rola, stany, część klawiatury). Po naszej stronie zawsze zostają:

| Obszar | Odpowiedzialność |
| --- | --- |
| Semantyka produktu | właściwy element (przycisk czy link, lista czy tabela), hierarchia nagłówków i landmarków |
| Etykiety i nazwy | zrozumiała, unikalna w kontekście nazwa dostępna każdej kontrolki; zgodna z widoczną etykietą |
| Treść | czytelne komunikaty i teksty statusów, teksty alternatywne, brak odwołań zależnych od koloru lub położenia |
| Przepływ fokusu | gdzie ląduje fokus po otwarciu, zamknięciu, błędzie i zmianie trasy; brak zasłaniania fokusu przez stałe paski |
| Obsługa błędów | powiązanie błędu z polem, podsumowanie, zachowanie wpisanych danych |
| Stany | ładowanie, pusty, błąd, brak uprawnień, blokada podwójnego wysłania |
| Wygląd | kontrast, widoczny fokus, cele dotykowe, tryb forced colors |

## 2. Cel zgodności

**[Decyzja]** Standardem jest **WCAG 2.2 poziom AA** (zapisz w `<docs>/docs/decisions.md` przy zakładaniu projektu). Własne progi mogą być ostrzejsze (np. 44×44 px celu dotykowego).

## 3. Szablon kontraktu dostępności komponentu

| Pole | Treść |
| --- | --- |
| Element / rola | natywny element lub rola ARIA, z uzasadnieniem, gdy nie jest natywny |
| Nazwa dostępna | skąd pochodzi (widoczny tekst, `<label>`, `aria-labelledby`); czy jest unikalna |
| Klawiatura | klawisze, kolejność, wyjście; dla widgetów niestandardowych odwołanie do wzorca WAI-ARIA APG |
| Fokus | fokus początkowy, ruch po akcji, powrót, widoczność |
| Stany | atrybuty `aria-*` lub natywne dla stanów (wybrany, rozwinięty, nieaktywny, zajęty, błędny) i ich odpowiednik tekstowy |
| Komunikaty | co ogłasza czytnik ekranu i kiedy (region live, `role`) |
| Treść | wymagany tekst, teksty zastępcze, długie i zawinięte wartości |
| Kolor i kształt | znaczenie nie zależy od samego koloru; użyte tokeny |
| Cel dotykowy | rozmiar i odstępy |
| Ruch | zachowanie przy `prefers-reduced-motion` |
| Stany danych | domyślny, pusty, ładowanie, błąd, brak uprawnień |
| Test | jak weryfikowane (sekcja 5) |

**Definition of Done komponentu:** wypełniony kontrakt; działa wyłącznie klawiaturą; widoczny fokus; nazwa dostępna; nie zależy od hover ani samego koloru; działa przy 320 px szerokości i 200% powiększenia tekstu; udokumentowane stany danych; wykonana weryfikacja z sekcji 5. Brak punktu zapisuje się jako bloker w `<docs>/.ai/runs/`, nie pomija.

## 4. Reguły szczegółowe

- **Semantyczny HTML:** nagłówki po kolei, landmarki (`header`, `nav`, `main`, `footer`), listy dla list, przyciski dla akcji, linki dla nawigacji.
- **Klawiatura:** wszystko osiągalne i obsługiwane bez myszy; brak pułapek fokusu; kolejność zgodna z układem; `Esc` zamyka dialogi.
- **Fokus:** widoczny wskaźnik (token `focus.ring.*`), niezasłonięty i nieobcięty; po zamknięciu dialogu fokus wraca do wyzwalacza.
- **Etykiety:** każda kontrolka ma etykietę; placeholder nie jest etykietą; ikona bez tekstu ma nazwę dostępną.
- **Walidacja:** błąd powiązany z polem (`aria-describedby`), podsumowanie błędów na górze formularza z fokusem, wpisane dane zostają, komunikat wskazuje, jak poprawić.
- **Czytnik ekranu:** zmiany stanu ogłaszane regionem live (`role="status"`/`alert` oszczędnie); stan ładowania nie zostawia pustej strony.
- **Kontrast:** WCAG AA; status nigdy tylko kolorem, zawsze tekst oraz ikona lub kształt.
- **Cele dotykowe:** co najmniej 44×44 px (token `size.touch.min`), główna akcja ekranu większa (`size.touch.primary`); powiększaj strefę trafienia, nie samą ikonę; brak funkcji wymagającej precyzyjnego gestu lub hover.
- **Zdjęcia:** informacyjne mają tekst alternatywny opisujący treść, dekoracyjne pusty `alt`; autor zdjęcia prywatnego jest jedynym, który widzi jego opis.
- **Stany ładowania, pusty i błędu:** każdy ekran danych je ma; stan pusty mówi, co zrobić dalej; błąd nie ujawnia szczegółów technicznych.
- **Dialogi i popovery:** `<dialog>` modalny z pułapką fokusu w obrębie dialogu, `Esc`, nazwa dostępna; tooltip nigdy jako jedyne źródło ważnej informacji.
- **Ruch:** animacje wyłączane lub skracane przy `prefers-reduced-motion`.
- **Responsywność:** poprawne działanie od 320 px i przy 200% tekstu, bez przewijania w poziomie.

## 5. Weryfikacja

| Warstwa | Zakres |
| --- | --- |
| Statyczna | reguły `jsx-a11y` w lincie (sprawdź, że konfiguracja ESLint je zawiera) |
| Tokeny | test kontrastu par tokenów i zerowania ruchu (`tests/design-system/tokens.test.ts`) |
| Automatyczna | axe na historiach Storybook lub w E2E z włączonym JavaScriptem |
| Klawiatura | przepływ wyłącznie klawiaturą: kolejność, fokus, `Esc`, powrót fokusu (Playwright) |
| Ręczna | czytnik ekranu na telefonie i komputerze, 320 px, 200% tekstu, forced colors, reduced motion |
| Odmowa dostępu | opisy i alt danych prywatnych nie są ujawniane bez uprawnień (test integracyjny przy funkcji) |

Automaty wykrywają tylko część problemów (jakość nazw i tekstu alternatywnego oraz kolejność fokusu wymagają oceny człowieka), więc nie zastępują kontroli ręcznej. axe nie działa przy wyłączonym JavaScripcie — wariant bez JS sprawdzaj ręcznie.

## 6. Otwarte kwestie

Zapisuj w `<docs>/docs/decisions.md`.
