# Lista wizualna i dostępność

Druga i trzecia lista kontrolna skilla `przeglad-ux` (krok 5), po zasadach właściciela. Lista wizualna pochodzi z `visual-checklist.md` skilla `web-design-reviewer` (MIT), skrócona i dostosowana: projekt używa tokenów CSS z `src/design-system/tokens/tokens.css` i CSS Modules, więc „spójność” oznacza zgodność z tokenami i komponentami design systemu. Dostępność streszcza `docs/design/accessibility.md`; przy rozbieżności wygrywa ten dokument.

## 1. Układ

- [ ] Brak poziomego przewijania strony (telefon 390 px i 320 px, komputer 1440 px).
- [ ] Treść nie wychodzi poza kontener; obrazy, tabele i długie adresy mieszczą się albo przewijają się w swoim polu.
- [ ] Elementy nie nachodzą na siebie, także przy otwartym menu i dolnym pasku nawigacji.
- [ ] Wyrównanie siatki kart jest równe; ikony i tekst są wyrównane w pionie.
- [ ] Etykiety formularzy stoją przy swoich polach.
- [ ] Odstępy między podobnymi elementami są takie same (te same tokeny odstępów).

## 2. Typografia

- [ ] Tekst główny czytelny na telefonie (ok. 16 px), wysokość wiersza ok. 1,5.
- [ ] Długość wiersza na komputerze ok. 40–80 znaków (ale patrz Z-10: wąska kolumna z pustymi bokami to problem układu, nie typografii).
- [ ] Hierarchia nagłówków widoczna na pierwszy rzut oka.
- [ ] Długie polskie słowa i nazwy własne zawijają się bez ucinania; wielokropek tylko tam, gdzie pełna treść jest dostępna (np. po wejściu w kartę).
- [ ] Polskie znaki (ą, ę, ł, ż, ź) wyświetlają się fontem projektu, bez zamiany na font zastępczy.

## 3. Kolor i spójność

- [ ] Kolory, cienie i zaokrąglenia wyglądają jak z design systemu; brak „obcych” szarości i niebieskich (por. Z-11).
- [ ] Błąd, ostrzeżenie i sukces mają wszędzie ten sam wygląd.
- [ ] Najechanie i wciśnięcie są widoczne, ale karty z odznaką stanu nie zmieniają tła po najechaniu (reguła tła, `accessibility.md` 4a).
- [ ] Oba motywy (nocny i jasny) są czytelne; nic nie „znika” po przełączeniu.

## 4. Responsywność

- [ ] Telefon to osobny wzorzec ekranu, nie zwężona strona komputera (`docs/architecture.md`: osobne układy na komputer i telefon).
- [ ] Cele dotykowe co najmniej 44 × 44 px, główna akcja większa.
- [ ] Dolny pasek nawigacji nie zasłania treści ani elementu z fokusem.
- [ ] Przy szerokościach pośrednich (ok. 768 i 1024 px) układ się nie łamie.
- [ ] Na komputerze treść ma sensowną maksymalną szerokość i wykorzystuje ekran (Z-10).

## 5. Elementy interaktywne

- [ ] Przyciski: stan zwykły, najechanie, fokus, wciśnięcie, nieaktywny, zajęty (ładowanie) — rozróżnialne.
- [ ] Blokada podwójnego wysłania: drugi szybki klik nie tworzy drugiego zapisu.
- [ ] Linki w tekście mają podkreślenie; linki w nawigacji i karty-linki rozpoznaje się po kształcie.
- [ ] Pola: wyraźny obrys, etykieta (placeholder nie jest etykietą), błąd przy polu, wpisane dane zostają po błędzie.
- [ ] Akcje nieodwracalne (usunięcie konta, usunięcie miejsca z kolekcji) pytają o potwierdzenie konkretnym tekstem.

## 6. Obrazy i mapa

- [ ] Zdjęcia zachowują proporcje i mają stan „brak zdjęcia”.
- [ ] Podpis autora i licencji zdjęcia jest widoczny tam, gdzie wymaga go źródło.
- [ ] Mapa ładuje się dopiero po decyzji użytkownika (prywatność, OpenStreetMap) i nie przewija strony przy przeciąganiu na telefonie.

## 7. Stany danych

- [ ] Pusty: mówi, co zrobić dalej (np. „Zapisz pierwszą kolekcję”), nie zostawia pustej ramki.
- [ ] Ładowanie: nie ma pustej strony ani skoku układu po załadowaniu.
- [ ] Błąd: zrozumiały, bez szczegółów technicznych, z drogą wyjścia (ponów, wróć).
- [ ] Brak uprawnień: jasny komunikat zamiast pustego ekranu lub błędu technicznego.
- [ ] Długa treść: bardzo długa nazwa kolekcji, opis, 50+ miejsc na liście.

## Dostępność (WCAG 2.2 AA, skrót `docs/design/accessibility.md`)

- [ ] Cała ścieżka zadania wykonalna samą klawiaturą; kolejność fokusu zgodna z układem; brak pułapek; `Esc` zamyka dialog i fokus wraca do wyzwalacza.
- [ ] Fokus widoczny (obwódka `color.border.focus`), niezasłonięty przez dolny pasek.
- [ ] Pierwszy Tab na stronie trafia na „Przejdź do treści”; na kolekcji link pomijający mapę działa.
- [ ] Każda kontrolka ma nazwę dostępną zgodną z widocznym napisem; przycisk z samą ikoną ma nazwę.
- [ ] Nagłówki po kolei, landmarki (`header`, `nav`, `main`, `footer`).
- [ ] Kontrast tekstu co najmniej 4,5:1 (duży tekst 3:1), obrys pól 3:1; w obu motywach.
- [ ] Status nigdy samym kolorem: zawsze tekst oraz ikona lub kształt.
- [ ] Zmiany stanu po akcji ogłaszane regionem `status` (np. „Zapisano”), bez nadmiaru `alert`.
- [ ] Zdjęcia informacyjne mają tekst alternatywny, dekoracyjne pusty `alt`.
- [ ] Przy 320 px i powiększeniu tekstu do 200% nic się nie ucina i nie ma przewijania w poziomie.
- [ ] Przy `prefers-reduced-motion: reduce` animacje są wyłączone.

**Elementy dostępności rozpoznaj, zanim uznasz coś za zbędne.** Linki pomijające („Przejdź do treści”, „Pomiń mapę”), teksty tylko dla czytnika ekranu i regiony `status` są obowiązkowe. Ustalenie dotyczy wtedy wyglądu (np. „widoczny stale, powinien pokazywać się dopiero przy fokusie”), a rozwiązanie to ukrycie wizualne, nie usunięcie (Z-13).

Automatyczne narzędzia (axe) wykrywają tylko część problemów. Jeśli uruchamiasz axe w specu przejścia, wynik to dodatkowy dowód, nie zamiennik sprawdzenia klawiaturą.
