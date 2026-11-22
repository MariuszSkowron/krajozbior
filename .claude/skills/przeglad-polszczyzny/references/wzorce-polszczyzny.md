# Wzorce błędów polszczyzny w interfejsie

Każdy wzorzec ma numer (`PL-nn`), który wpisujesz w kolumnie „Reguła” raportu. Przykłady „Przed” oznaczone `(aplikacja)` pochodzą z kodu Krajozbioru; pozostałe są wzorcowe. Wzorce oznaczone **zalecenie stylu** nie są normą językową: zgłaszasz je zawsze z wagą `niska`. Każda propozycja podlega bezpiecznikowi długości ze `SKILL.md` („Granice redakcji”).

## A. Kalki składniowe

**PL-01 — przeniesiony do `przeglad-wypelniaczy` (F-09).** Spójnik „aby” lub „żeby” z bezokolicznikiem to rodzima polska konstrukcja, nie kalka. Pusty dopisek celu („…, aby kontynuować”) ocenia `przeglad-wypelniaczy`.

**PL-02 Strona bierna i bezosobowe „-no/-to” tam, gdzie jest wykonawca.** Polszczyzna woli stronę czynną i 2. osobę.
Przed: „Nowe konto zakłada się pierwszym logowaniem.” (aplikacja, `src/app/login/page.tsx:93`)
Po: „Konto założysz przy pierwszym logowaniu.”
Wyjątek: krótkie potwierdzenia „Zapisano.”, „Wylogowano.” są naturalne.

**PL-03 Ciąg rzeczowników zamiast czasownika (nominalizacja).** „Dokonaj weryfikacji”, „w celu potwierdzenia”, „realizacja zapisu”.
Po: „Sprawdź”, „żeby potwierdzić”, „zapisujemy”.

**PL-04 Rzeczownik jako przydawka przed rzeczownikiem.** Angielskie „collection progress” przeniesione dosłownie: polski stawia określenie rzeczownikowe po rzeczowniku, w dopełniaczu. Szyk przymiotnika („kolekcje lokalne”, „lokalne kolekcje”) nie jest tu błędem.
Przed: „Kolekcja postęp” Po: „Postęp kolekcji”

**PL-05 Biernik zamiast dopełniacza po przeczeniu.** Po „nie” dopełnienie idzie w dopełniaczu.
Przed: „Bez zgody nie potwierdzisz wizytę.” Po: „Bez zgody nie potwierdzisz wizyty.”

**PL-06 Zaimek dzierżawczy nadmiarowy (kalka „your”).** „Wpisz swój adres e-mail w swoim formularzu.”
Po: „Wpisz adres e-mail.” Zostaw „Twój” tam, gdzie odróżnia prywatne od publicznego („Twój postęp”, „Twoje wizyty”).

## B. Kalki leksykalne i frazeologiczne

**PL-07 Spolszczony żargon.** zaadresować → rozwiązać; dedykowany → przeznaczony dla, osobny; aplikować → złożyć wniosek; supportować → wspierać; kontent → treść; feedback → uwagi; lokacja → miejsce.

**PL-08 Wyrażenia z angielskiego dosłownie.** „Zrób różnicę”, „na koniec dnia” w znaczeniu „ostatecznie”. Zalecenie stylu: „wspierane przeglądarki” (lepiej: „przeglądarki, które obsługują…”). Nie zgłaszasz wyrażeń, które słowniki notują jako poprawne („mieć sens”, „w międzyczasie”).

**PL-09 Fałszywi przyjaciele.** aktualnie (= obecnie, nie „actually”, czyli „właściwie”), ewentualnie (= w razie potrzeby, nie „eventually”, czyli „w końcu”), kontrola (= sprawdzenie, nie „control”, czyli „sterowanie”).

**PL-10 Pleonazmy i tautologie.** „Policzyć liczby”, „cofnąć się do tyłu”, „aktualna wersja na dziś”.
Przed: „Nie udało się teraz policzyć Twoich liczb.” (aplikacja, `src/app/my/page.tsx:87`)
Po: „Nie udało się teraz wczytać podsumowania.” (Zdanie „Odśwież stronę za chwilę.” jest już w kodzie obok.)

## C. Interpunkcja i zapis

**PL-11 Przecinek przed spójnikiem zdania podrzędnego i przed imiesłowowym równoważnikiem zdania.** Przed „że”, „który”, „gdy”, „aby”, „żeby”, „jeśli”, „bo” i przed równoważnikiem na „-ąc”, „-wszy” brak przecinka to błąd.
Wyjątek: przy spójnikach złożonych i spójnikach poprzedzonych partykułą przecinek stoi przed całym wyrażeniem, nie w środku: „, mimo że”, „, chyba że”, „, zwłaszcza że”, „, podczas gdy”, „, nawet jeśli”, „, tylko że”. Zapis „mimo, że” to błąd.
Przecinek przed pojedynczym „i”, „lub”, „albo” w zwykłym wyliczeniu to także błąd.

**PL-12 Cudzysłów.** Polski „…”, nie "…" ani “…”. Nazwy list i przycisków przywoływane w zdaniu stoją w cudzysłowie.
Przed: „Zaloguj się, aby potwierdzić wizytę lub zapisać na Chcę zobaczyć” (aplikacja, `src/app/places/[placeId]/page.tsx:145`)
Po: Zaloguj się, aby potwierdzić wizytę lub zapisać na „Chcę zobaczyć”. (Tak już pisze `want-to-see-button.tsx:69`.)

**PL-13 Kropka na końcu.** Zdanie pełne kończy kropka; etykieta, przycisk, nagłówek i pozycja menu nie. Jednolicie w obrębie ekranu.

**PL-14 Wielka litera.** Wielka litera tylko na początku etykiety i nazwy przycisku; polszczyzna nie pisze każdego wyrazu wielką literą (nie „Zapisz Kolekcję”). Zalecenie stylu (zasada domowa [P], `docs/design/voice-and-tone.md`): „Ty”, „Twój”, „Ci” wielką literą, konsekwentnie w całej aplikacji; to zwyczaj grzecznościowy, nie obowiązek. Etykiety w kroju mono dostają wersaliki przez CSS, nie w tekście.

**PL-15 Myślnik i dywiz.** Myślnik w zdaniu (pauza „—” lub półpauza „–”) stoi ze spacjami po obu stronach; dywiz w złożeniach bez spacji („e-mail”, „biało-czerwony”). Myślnika nie usuwamy jako „śladu AI”: w polszczyźnie jest poprawny; w krótkim tekście interfejsu wolimy kropkę.

**PL-16 Wielokropek.** Po urwanym wyrazie bez spacji („Ładowanie…”). W aplikacji zapisujemy go jednym znakiem „…” (zasada domowa).

## D. Odmiana i liczby

**PL-17 Liczebnik z rzeczownikiem.** Reguła ogólna: 1 → „miejsce”; liczba kończąca się na 2, 3 lub 4, z wyjątkiem liczb kończących się na 12, 13 i 14 → „miejsca” (2, 23, 104 miejsca); każda inna liczba → „miejsc” (0, 5, 12, 21, 25, 113 miejsc). Tak samo „kolekcja/kolekcje/kolekcji”, „wizyta/wizyty/wizyt”, „minuta/minuty/minut”. Sprawdź każdą liczbę wstawianą zmienną: czy przechodzi przez funkcję odmiany (wzór: `formatPlaceCount`)? Szablon `${n} miejsc` to błąd dla n = 1–4.

**PL-18 Zapis liczb i jednostek.** „6,2 km” (przecinek dziesiętny), spacja między liczbą a jednostką, w aplikacji spacja twarda („200 m”). Liczby od 10 000 dzielisz spacją na grupy po trzy cyfry („12 500”); czterocyfrowe wolno zapisać ze spacją albo bez („1250” lub „1 250”), byle jednolicie w aplikacji. Procent ukończenia zamiast „9/24” to sprawa tonu (odeślij do `przeglad-tonu`).

**PL-19 Daty i godziny.** 8.11.2026, 22:40; w listach 08.11 · Tczew. Miesiąc słownie w dopełniaczu („8 listopada”), w mianowniku tylko bez dnia („marzec 2019”). Bez zapisu „08/11/2026”, „2026-11-08” w interfejsie.

## E. Forma grzecznościowa i rodzaj

**PL-20 Czasownik w czasie przeszłym zakłada płeć.** „Byłeś”, „zapisałeś”, „odwiedziłeś” wykluczają kobiety; „byłeś/aś” jest nieczytelne.
Przed: „Byłem tu wcześniej” i „Kiedy tu byłeś?” (aplikacja, `src/app/places/[placeId]/past-visit.tsx:113`, `:128`)
Po: „Wcześniejsza wizyta” i „Kiedy to było?”.
Przed: „zaznaczysz miejsca, w których już byłeś” (aplikacja, `src/app/page.tsx:122`)
Po: „zaznaczysz miejsca już odwiedzone”.
Sposoby: czas teraźniejszy lub przyszły („potwierdzisz”, „zaznaczysz”), rzeczownik („Twoja wizyta”), forma bezosobowa („Zapisano”).

**PL-21 Mieszanie form.** „Ty” i „Państwo” albo „Ty” i bezosobowe „Należy” na jednym ekranie. Do odkrywcy zawsze „Ty”.

**PL-22 Forma czasownika w przyciskach.** Przycisk: bezokolicznik albo 2. osoba trybu rozkazującego, jednolicie na ekranie („Zapisz profil”, „Usuń konto”). Wzorzec z design systemu dopuszcza 1. osobę dla deklaracji odkrywcy („Potwierdzam wizytę”) — nie mieszaj obu w jednej grupie przycisków.

## F. Spójność nazw

**PL-23 Jedno pojęcie, jedna nazwa.** Porównaj ze „Słownikiem produktu” w `docs/design/voice-and-tone.md`. Rotowanie synonimów („lista”, „zbiór”, „kolekcja”) myli odkrywcę.

**PL-24 Nazwa ekranu i przycisku zgodna z nawigacją.** Link „Profil” prowadzi do ekranu „Profil”, nie „Konto”. Tytuł strony (`metadata.title`) zgodny z `h1`.
