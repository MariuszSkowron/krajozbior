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
  - **Wyjątek: link w zdaniu.** Link wewnątrz zdania lub podpisu (np. autor, źródło i licencja w krótkim podpisie zdjęcia, nazwa miejsca w tej samej linii) może zostać zwykłym linkiem w tekście, bez celu 44 px: WCAG 2.5.8 (Target Size Minimum, poziom AA) zwalnia linki w zdaniu z wymiaru 24 px. W zamian link ma dostępną nazwę, jest osiągalny klawiaturą, ma widoczny fokus i nie jest mniejszy niż wiersz tekstu; sprawdza to `expectCreditLinksUsable` w `e2e/credit-support.ts`. Samodzielny link lub przycisk poza zdaniem zachowuje 44 px.
- **Zdjęcia:** informacyjne mają tekst alternatywny opisujący treść, dekoracyjne pusty `alt`; autor zdjęcia prywatnego jest jedynym, który widzi jego opis.
- **Stany ładowania, pusty i błędu:** każdy ekran danych je ma; stan pusty mówi, co zrobić dalej; błąd nie ujawnia szczegółów technicznych.
- **Dialogi i popovery:** `<dialog>` modalny z pułapką fokusu w obrębie dialogu, `Esc`, nazwa dostępna; tooltip nigdy jako jedyne źródło ważnej informacji.
- **Ruch:** animacje wyłączane lub skracane przy `prefers-reduced-motion`.
- **Responsywność:** poprawne działanie od 320 px i przy 200% tekstu, bez przewijania w poziomie.

## 4a. Wygląd „nocny album”: reguły kontrastu, fokusu i linków

- **Reguła tła (D-22, Q5).** W jasnym motywie tekst w kolorze akcentu (`color.text.accent`) i zieleń stanu (`color.feedback.success`) stoją tylko na `color.surface.canvas` lub `color.surface.card`, a odznaka `success` tylko na karcie. Na `surface.tint` i `surface.hover` mają poniżej 4,5:1. Wiersze i karty z odznaką stanu albo tekstem akcentem nie zmieniają tła po najechaniu (najechanie to obrys `color.border.strong` i cień); aktywna pozycja menu na `surface.tint` ma tekst `color.text.strong`. Pary dozwolone i niedozwolone są w `tests/design-system/tokens.test.ts`.
- **Fokus (D-22, Q4).** Przyciski i linki: obwódka 2 px w kolorze `color.border.focus` (równa `color.text.accent`) z odstępem 2 px; nie kolorem `color.brand.accent` (2,73:1 na `surface.tint` w jasnym). Pola formularzy: obrys akcentem i pierścień 3 px przy 15% oraz przezroczysty `outline` dla trybu wymuszonych kolorów.
- **Obrys pól (D-22, Q3).** Pola tekstowe, pola wyboru i listy mają obrys `color.text.meta` (co najmniej 3:1 na tle pola i karty); `color.border.default` ma poniżej 3:1 i służy tylko przyciskom, które rozpoznaje się po napisie. Tekst zastępczy ma kolor `color.text.meta`.
- **Linki w tekście (WCAG 1.4.1).** Link w akapicie ma stałe podkreślenie 1 px (2 px po najechaniu i przy fokusie), bo sam kolor akcentu nie wystarcza (2,23:1 względem tekstu w nocnym). Podkreślenie wyłącza tylko klasa elementu rozpoznawalnego po kształcie i położeniu (nawigacja, karta będąca linkiem, link stylowany jak przycisk), nigdy ogólna reguła `a`.
- **Fokus nie może być zasłonięty (WCAG 2.4.11).** Przypięty pasek lub przycisk przy dolnej krawędzi nie może zakryć elementu z fokusem: wysokość paska to zmienna CSS, a `html` ma `scroll-padding-bottom` równy tej wysokości tylko wtedy, gdy pasek jest widoczny; treść ma też dolny `padding`. Przypięty nagłówek wymagałby `scroll-padding-top` z tą samą zasadą. Sprawdza to test E2E `e2e/shell.spec.ts` (Tab przez treść przy 390 × 844 w obu motywach, `elementFromPoint`; axe tego nie wykrywa). Zmienna `--shell-bottom-bar-height` i reguła stoją w `src/app/app-shell.module.css` (E3-2a). Przy tekście powiększonym do 200% etykiety paska zawijają się i pasek rośnie ponad swoje minimum (50 px plus wcięcie ekranu), więc `MainNav` mierzy pasek (`ResizeObserver`) i ustawia zmienną na jego rzeczywistą wysokość; stałe minimum działa tylko do pierwszego pomiaru. Dowód: test E2E „rezerwa pod pasek nadąża za jego wysokością” (320 px, `font-size: 200%`).
- **Dolny pasek nawigacji (D-23).** Napis aktywnej pozycji ma kolor `color.text.strong`, a akcentem są tylko ikona i kropka; akcentowy napis na półprzezroczystym tle `color.surface.glass` spadałby poniżej 4,5:1 nad elementem o przeciwnej jasności. Bez `backdrop-filter` pasek ma pełne tło `color.surface.canvas` (`@supports not`). Pasek ma `min-height`, nie `height`, żeby etykieta mogła urosnąć przy powiększeniu tekstu do 200% (rezerwę pod pasek opisuje punkt „Fokus nie może być zasłonięty”). Cel dotykowy pozycji: co najmniej 44 × 44 px. Reguła `@supports not` ma test jednostkowy na źródle CSS (`tests/app/shell/shell-css.test.ts`): Chromium w E2E obsługuje `backdrop-filter`, więc tej ścieżki nie da się tam wywołać.
- **Kolejność fokusu paska na telefonie (świadomy kompromis).** `MainNav` stoi w DOM przed `<main>`, więc na telefonie klawisz Tab trafia na dolny pasek (widoczny na dole ekranu) przed treścią, a „kolejność zgodna z układem” jest tam naruszona. Zostaje tak, bo ten sam DOM obsługuje komputer, gdzie menu boczne leży przed treścią i taka kolejność jest właściwa; osobna kolejność dla telefonu wymagałaby dwóch kopii menu albo przestawiania DOM skryptem. Łagodzi to link „Przejdź do treści” (`#tresc`, pierwszy fokus strony, `src/app/layout.tsx`), który omija nawigację. Sprawdzenie ręczne w QA.
- **Klawiatura ekranowa.** Nie ma reguły chowającej dolny pasek przy fokusie w polu formularza: na telefonie zalogowany odkrywca nie ma dziś pól w treści (formularze logowania są bez paska, panel kuratora jest tylko na komputer). Pierwszy ekran z polem edycji na telefonie rozstrzyga to razem ze swoją specyfikacją (E4 i dalej).
- **Ruch.** Przy `prefers-reduced-motion: reduce` jedna reguła w `theme.css` (`*, *::before, *::after` z `!important`) wyłącza animacje i przejścia, a token czasu spada do `0ms`. Wejście sekcji (przezroczystość i przesunięcie 12 px, 800 ms) i uniesienie karty to czysty CSS ze stanem końcowym w regule bazowej. Przy `prefers-reduced-motion` stany `:hover` i `:active` karty nadal zmieniają jej położenie (uniesienie, wciśnięcie), ale bez przejścia, czyli natychmiast i bez animacji. Test axe liczy kontrast po końcu animacji (`document.getAnimations()`), bo w jej trakcie treść jest przygaszona; `e2e/appearance.spec.ts` uruchamia axe z `reducedMotion: "reduce"` i osobno sprawdza, że animacje kończą się stanem końcowym.
- **Reguła tła na ekranach (E3-2b).** Odznaka stanu stoi tylko na karcie (`color.surface.card`): tabela kolekcji kuratora, stan wizyty na stronie miejsca i wiersze listy „Chcę zobaczyć” są na kartach; odznaka w nagłówku ekranu ma podkład w kolorze karty. Wiersze listy i karty nie zmieniają tła po najechaniu, zmienia się obrys (test E2E „wiersz listy z linkiem nie zmienia tła po najechaniu”).

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
