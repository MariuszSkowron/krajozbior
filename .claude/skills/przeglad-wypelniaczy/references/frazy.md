# Frazy-wypełniacze w polskim interfejsie

Lista sygnałów, nie lista zakazów. Fraza jest ustaleniem dopiero wtedy, gdy po jej usunięciu zdanie nic nie traci albo gdy łamie immersję. Kod reguły (`F-nn`) wpisujesz w kolumnie „Reguła” raportu. Każda poprawka podlega bezpiecznikowi długości ze `SKILL.md` („Czego nie zgłaszasz”).

## F-01 Interfejs opisuje sam siebie

„Oto…”, „Poniżej znajdziesz…”, „Na tej stronie możesz…”, „W tym miejscu…”, „Ta sekcja pokazuje…”, „Witaj w…”, „Tutaj zobaczysz…”.

Przed: „Oto Twój album i kolekcje, które warto odkryć.” (aplikacja, `src/app/page.tsx:136`)
Po: usuń zdanie (album i kolekcje są tuż pod nim) albo, jeśli zostaje, daj fakt zamiast zapowiedzi: „14 odkrytych miejsc. Najbliżej końca: Wieże ciśnień Pomorza, 9/24.” `[POTRZEBNE: dane z podsumowania albumu]`

## F-02 Język systemu zamiast świata odkrywcy (łamie immersję)

system, operacja, żądanie, rekord, moduł, funkcjonalność, użytkownik, dane zostały zapisane, wystąpił błąd, kod błędu, serwer (poza tekstem o prywatności), „Coś poszło nie tak”. Słowa urzędowe i systemowe zgłasza tylko ten skill; `przeglad-tonu` ich nie dubluje.

„Sesja” to słowo powszechnie rozumiane (banki, sklepy). Samo w sobie nie jest ustaleniem; zgłaszasz najwyżej z wagą `niska`, a ważniejsze jest, czy komunikat mówi, po co się zalogować.
Przed: „Sesja wygasła. Zaloguj się ponownie.” (aplikacja, `src/app/places/[placeId]/visit-confirmation.tsx:39`)
Po: „Zaloguj się ponownie, żeby potwierdzić wizytę.” (Dopisane jest tylko wyjście; zdanie jest prawdziwe bez względu na to, dlaczego logowanie wygasło.)
Nie zastępuj „sesji” ogólnikiem w rodzaju „Minęło sporo czasu od logowania”: logowanie kończy się też po wylogowaniu na innym urządzeniu albo po usunięciu ciasteczek, więc taki tekst bywa nieprawdą i sam jest wypełniaczem.
Wyjątek: tekst o prywatności musi nazwać rzecz po imieniu („serwer OpenStreetMap widzi adres IP”); to uczciwość, nie wypełniacz.

## F-03 Zapowiedź przyszłości i stan budowy produktu

„wkrótce”, „pracujemy nad tym”, „gdy funkcja będzie gotowa”, „w kolejnej wersji”, „na razie”.

Przed: „Gdy strona profilu dla innych odkrywców będzie gotowa, zobaczą na niej imię, region i liczby, nigdy historię wizyt. Na razie nikt poza Tobą nie widzi profilu.” (aplikacja, `src/app/my/settings/profile-form.tsx:48`)
Po: „Teraz profil widzisz tylko Ty. Gdy go udostępnimy, inni odkrywcy zobaczą imię, region i liczby. Historii wizyt nie zobaczy nikt.” (Zapowiedź zostaje w jednym zdaniu, bo dotyczy decyzji o prywatności; usuwamy opowieść o „gotowej stronie”. Tekst jest krótszy od oryginału.)

## F-04 Puste otwieracze i dopowiedzenia

„Warto zauważyć, że”, „Należy pamiętać, że”, „Co ważne,”, „Pragniemy poinformować”, „Z przyjemnością informujemy”, „Chcielibyśmy”, „Krótko mówiąc”, „Innymi słowy”, „Podsumowując”.
Poprawka: usuń i zacznij od rzeczy.

## F-05 Puste wzmacniacze

„naprawdę”, „po prostu”, „właściwie”, „dosłownie”, „absolutnie”, „całkowicie”, „w pełni”, „niezwykle”.
Usuń, gdy nic nie wnoszą. **Nie usuwasz wszystkich przysłówków**: „Spróbuj ponownie”, „Odśwież stronę za chwilę”, „na stałe” niosą treść.

## F-06 Napuszona ważność (typowa w tekstach turystycznych)

„odgrywa kluczową rolę”, „stanowi świadectwo”, „bogate dziedzictwo”, „niezwykła historia”, „perła regionu”, „gratka dla miłośników”, „miejsce z duszą”, „przenieś się w czasie”, „pozwól się zaskoczyć”, „odkryj na nowo”.
Poprawka: fakt zamiast etykiety („wieża z 1905 roku, zbiornik na 300 m³”). W treściach kuratorów tylko w osobnej sekcji raportu.

## F-07 Otwieracze reklamowe

„W dzisiejszym zabieganym świecie”, „Niezależnie od tego, czy jesteś…, czy…”, „Powiedz »do widzenia«…”, „Zanurz się w…”, „Odkryj moc…”, „…na nowo”.

## F-08 Resztki czatu

„Mam nadzieję, że to pomoże”, „Daj znać, jeśli…”, „Świetne pytanie!”, „Oczywiście!”, „Chętnie pomogę”, „Czy chcesz, żebym…”.
Usuń zawsze: w interfejsie nikt nie rozmawia z asystentem.

## F-09 Wyjaśnianie oczywistego i pusty dopisek celu

„Kliknij przycisk poniżej, aby…”, „Wypełnij formularz, aby…”, „Kliknij tutaj”, „…, aby kontynuować”, „…, aby przejść dalej”.
Poprawka: przycisk sam mówi, co się stanie; tekst pomocniczy tylko wtedy, gdy odpowiada na realną wątpliwość. Sam spójnik „aby” nie jest błędem ani kalką; ustaleniem jest dopisek celu, który niczego nie mówi.
Przed: „Zaloguj się, aby kontynuować.” (aplikacja, `src/app/login/page.tsx:83`)
Po: „Zaloguj się.” albo usuń zdanie, jeśli nagłówek i przycisk już to mówią. Gdy ekran wie, po co odkrywca przyszedł, podaj ten cel zamiast „kontynuować” („Zaloguj się, aby potwierdzić wizytę.”).

## F-10 Ostrożne zastrzeżenia bez treści

„może”, „w niektórych przypadkach”, „potencjalnie”, „w miarę możliwości” bez wskazania, kiedy.
Zostaw, gdy niepewność jest prawdziwa i nazwana („Lokalizacja jest zbyt niedokładna (±150 m)”).

## Czego nie traktujesz jako wypełniacza (pominięte z baz angielskich)

- **Myślnik** („—”, „–”): w polszczyźnie poprawny znak; w krótkim tekście woli się kropkę, ale to sprawa stylu, nie wypełniacz.
- **Wszystkie przysłówki i strona bierna**: angielski zakaz „żadnych -ly” nie ma odpowiednika; oceniasz tylko puste wzmacniacze (F-05).
- **Trójki**: wyliczenie trzech rzeczy, gdy są trzy (np. „imię, region i liczby”), zostaje.
- **Krótkie potwierdzenia** („Zapisano.”, „Wylogowano.”): to nie dramatyczny fragment, tylko konwencja interfejsu.
