# Struktury-wypełniacze

Kształt zdania zdradza wypełniacz częściej niż pojedyncze słowo. Kod reguły (`S-nn`) wpisujesz w kolumnie „Reguła” raportu. Każda poprawka podlega bezpiecznikowi długości ze `SKILL.md` („Czego nie zgłaszasz”).

## S-01 Kontrast-objawienie

„To nie X, to Y.”, „Nie chodzi o X, lecz o Y.”, „To więcej niż X.”, „Nie tylko X, ale i Y.”
Przed: „Krajozbiór to nie zwykła lista miejsc. To Twój album.”
Po: „Krajozbiór to album odwiedzonych miejsc.”

## S-02 Lista zaprzeczeń

„Bez X, bez Y, bez Z.”, „Żadnych X. Żadnych Y.”
Poprawka: powiedz, co jest. Jedno zaprzeczenie zostaje, gdy odpowiada na realną obawę („Nie zapisujemy, gdzie jesteś”).

## S-03 Doklejony ogon

Zdanie kończy się imiesłowem albo „co/dzięki czemu” z pustą korzyścią: „…, co pozwala w pełni cieszyć się odkrywaniem”, „…, zapewniając niezapomniane wrażenia”.
Poprawka: zakończ na fakcie. Ogon zostaje, gdy dodaje nowy fakt.

## S-04 Pytanie z natychmiastową odpowiedzią i dwukropek-objawienie

„Efekt? 24 miejsca w albumie.”, „Najlepsze: działa offline.”
Poprawka: zwykłe zdanie. Pytanie zostaje, gdy pyta odkrywcę o dane („Kiedy to było?”).

## S-05 Nagłówek powtórzony w pierwszym zdaniu

Nagłówek „Miejsca w kolekcji”, pod nim „W tej kolekcji znajdziesz następujące miejsca:”.
Poprawka: usuń zdanie.

## S-06 Podwójny komunikat

Ten sam fakt w etykiecie, tekście pomocniczym i komunikacie stanu; przy błędzie pola komunikat ogólny powtarza komunikat przy polu.
Poprawka: jedno miejsce na fakt. Uwaga: dla czytnika ekranu komunikat ogólny z nazwą pola bywa celowy (np. `src/app/my/settings/profile-form.tsx`, zestaw „Imię: wpisz…”). Sprawdź, czy tekst jest widoczny, czy tylko czytany; dostępność rozstrzyga `przeglad-ux`.

## S-07 Fałszywe sprawstwo

Rzecz robi to, co robi człowiek: „Aplikacja chce wiedzieć, gdzie jesteś”, „Mapa zaprasza do odkrywania”, „Kolekcja czeka na Ciebie”.
Poprawka: nazwij wykonawcę — odkrywcę („Potwierdzisz wizytę na miejscu”), przeglądarkę („Przeglądarka zapyta o zgodę”) albo nas („Nie zapisujemy…”).

## S-08 Zdanie przenośne (test „pasuje do każdej firmy”)

Zdanie, które bez zmian pasowałoby do aplikacji bankowej, sklepu albo innej aplikacji turystycznej: „Dziękujemy, że jesteś z nami”, „Twoja wygoda jest dla nas najważniejsza”, „Odkrywaj więcej”, „Wszystko w jednym miejscu”.
Poprawka: usuń albo zastąp faktem, który pasuje tylko do Krajozbioru (miejsce, kolekcja, kurator, postęp). To najważniejszy test tego skilla.

## S-09 Puenta-aforyzm na końcu

„Bo każde miejsce ma swoją historię.”, „Podróż zaczyna się od pierwszego kroku.”
Poprawka: usuń; zakończ na ostatnim konkretnym zdaniu albo na następnym kroku.

## S-10 Tłumaczenie tego, co odkrywca już wie

Komunikat powtarza całe tło, zanim powie, co zrobić; ekran potwierdzenia opowiada, co odkrywca przed chwilą zrobił.
Poprawka: najpierw skutek albo decyzja, potem najwyżej jeden fakt, którego odkrywca nie ma.

## S-11 Ozdobne formatowanie

Pogrubienia rozsiane w zdaniu, nagłówek nad jednym zdaniem, lista tam, gdzie wystarczą dwa zdania, emoji (zakazane w produkcie [Z]).

## S-12 Zgadywanie i zastrzeżenia o wiedzy

W treściach generowanych (opis miejsca, podpowiedź): „Prawdopodobnie zbudowano ją w XIX wieku”, „Brak szczegółowych informacji, ale…”.
Poprawka: podaj, co mówi źródło, albo usuń zdanie. Nie zgaduj dat ani faktów.
