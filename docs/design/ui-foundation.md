# UI foundation

## W skrócie

Fundamentem interfejsu jest React 19, natywny HTML i tokeny CSS. Dokument zapisuje, jak decydować, czy do projektu dodać bibliotekę UI, i co sprawdzić przed jej użyciem. Domyślna odpowiedź brzmi: nie dodawaj, dopóki zatwierdzona funkcja tego nie wymaga.

## 1. Założenia

- React 19 jest twardym wymaganiem; biblioteka niezgodna z nim odpada, nawet jeśli jest popularna.
- Natywne elementy (`button`, `input`, `select`, `dialog`, `progress`, `details`) dają klawiaturę, fokus i semantykę za darmo i są pierwszym wyborem.
- Tożsamość wizualna powstaje przez tokeny i motyw, nie przez nadpisywanie stylów wewnętrznych cudzych komponentów.
- Dostępność jest kontraktem komponentu (`accessibility.md`); biblioteka nie zdejmuje z nas tej odpowiedzialności.

## 2. Stan obecny szkieletu

Zweryfikuj w repozytorium (`package.json`, `src/design-system/`), zamiast ufać tej liście: tokeny (dwa motywy: nocny i jasny) w `src/design-system/tokens`, style bazowe, przyciski i pola w `theme`, kroje z plików w `src/design-system/fonts` (Geist, Geist Mono, Instrument Serif; źródła i licencje w `README.md` tamże), ikony liniowe rysowane w repozytorium w `src/design-system/icons` (5 sztuk, bez biblioteki ikon), komponenty produktu w `src/design-system/components` (`CollectionCard`, `CollectionProgress`, `StatusBadge`), historie Storybook „Foundation” (z przełącznikiem „Motyw”), komponentów i kontrolek natywnych, brak biblioteki komponentów, brak Tailwind CSS i CSS-in-JS.

## 3. Kiedy rozważyć bibliotekę

Tylko wtedy, gdy zatwierdzona funkcja wymaga złożonego widgetu, którego poprawna dostępność jest kosztowna do napisania (np. popover z pozycjonowaniem, zakładki z pełną obsługą klawiatury, kombinowane pole wyboru). Jeden widget bez biblioteki to zwykle mniej kosztów niż nowa zależność.

## 4. Procedura przed dodaniem biblioteki

1. Wpis w `<docs>/docs/decisions.md`: potrzeba, alternatywy (natywny HTML, własna implementacja), ocena kosztu utrzymania.
2. Sprawdź faktycznie zainstalowaną wersję i zgodność z React 19: `package.json`, lockfile, `node_modules`, a następnie **uruchom** komponent w repozytorium (historia Storybook i test) — sama deklaracja peer deps nie wystarcza.
3. Wybierz bibliotekę bez stylów (headless), żeby wygląd pozostał po stronie tokenów.
4. Sprawdź licencję i rozmiar paczki.
5. Opakuj widget komponentem produktu z kontraktem dostępności; testuj go tak samo jak komponent natywny.

## 5. Odrzucone z założenia

Biblioteki z wbudowaną identyfikacją wizualną, które trzeba „odmalowywać”, oraz rozwiązania CSS-in-JS i Tailwind CSS (wymagałyby decyzji o zmianie podejścia do stylowania).
