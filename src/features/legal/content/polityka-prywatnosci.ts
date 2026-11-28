// Polityka prywatności: tekst publiczny, wersja 1.1 (obowiązuje od 28 listopada 2026 r.), pierwsza
// obowiązująca wersja. Wyłączone śledzenie wiadomości w Brevo potwierdził właściciel 22.11.2026
// (D-49 pkt 8). Test w tests/features/legal/legal-content.test.ts pilnuje, żeby żaden znacznik
// roboczy nie trafił do ruchu publicznego.
import { CONTACT_ADDRESSES as ADDRESS } from "../domain/legal-pages";

export const POLITYKA_PRYWATNOSCI = `
## 1. Kto odpowiada za Twoje dane

W tej polityce „RODO” oznacza rozporządzenie Parlamentu Europejskiego i Rady (UE) 2016/679 z 27 kwietnia 2016 r. w sprawie ochrony osób fizycznych w związku z przetwarzaniem danych osobowych i w sprawie swobodnego przepływu takich danych.

Administratorem Twoich danych osobowych jest Mariusz Skowron, adres do doręczeń: ul. Urzędnicza 42, 91-304 Łódź („my”, „administrator”).

We wszystkich sprawach dotyczących danych osobowych napisz do nas: **${ADDRESS.privacy}**.

Nie wyznaczyliśmy inspektora ochrony danych, ponieważ nie wymaga tego od nas art. 37 RODO.

## 2. Kogo dotyczy ta polityka

Polityka opisuje, jak przetwarzamy dane osób, które korzystają z serwisu Krajozbiór (dalej „serwis”), dostępnego pod adresem https://krajozbior.pl. Dotyczy:

- gości, czyli osób, które oglądają serwis bez konta;
- odkrywców, czyli osób z kontem;
- kuratorów, czyli organizacji i osób prowadzących kolekcje oraz członków ich zespołów, także osób zgłoszonych do zespołu na prośbę organizacji;
- osób, które zgłaszają nam treści, składają reklamacje albo piszą do nas w innej sprawie;
- osób, które są widoczne na zdjęciach albo zostały wskazane w zgłoszeniach, oraz autorów zdjęć z Wikimedia Commons, które pokazujemy przy miejscach.

## 3. Jakie dane przetwarzamy, po co i na jakiej podstawie

Część opisanych niżej danych zaczniemy przetwarzać dopiero po uruchomieniu funkcji, której dotyczą. Dziś nie działają jeszcze: dodawanie zdjęć przez odkrywców (razem ze zgodą na użycie zdjęcia w promocji), profil widoczny dla innych odkrywców, karty legendarne, powiadomienia w serwisie i wniosek „Zostań kuratorem” (do jego uruchomienia o status prosi się e-mailem). Wiersze o tych funkcjach oznaczamy dopiskiem „po uruchomieniu funkcji”. O uruchomieniu każdej z nich poinformujemy w serwisie.

| Dane | Po co | Podstawa prawna (RODO) |
| --- | --- | --- |
| adres e-mail | założenie konta, logowanie jednorazowym kodem, wiadomości dotyczące konta (np. o zmianie regulaminu) | wykonanie umowy (art. 6 ust. 1 lit. b) |
| adres e-mail konta, na którym nie zaakceptowano jeszcze regulaminu (konto powstaje po wpisaniu kodu z e-maila, a regulamin pokazujemy zaraz potem) | dokończenie zakładania konta | działania przed zawarciem umowy, podjęte na Twoje żądanie (art. 6 ust. 1 lit. b) |
| jednorazowy kod logowania | logowanie | wykonanie umowy (art. 6 ust. 1 lit. b) |
| sesja logowania: jej identyfikator, czas rozpoczęcia i wygaśnięcia oraz rodzaj przeglądarki, z której się zalogowano (bez adresu IP) | utrzymanie zalogowania i wylogowanie na wszystkich urządzeniach | wykonanie umowy (art. 6 ust. 1 lit. b) |
| wersja zaakceptowanego regulaminu i czas akceptacji | potwierdzenie akceptacji regulaminu | wykonanie umowy (art. 6 ust. 1 lit. b); w razie sporu lub blokady konta — nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f) |
| imię, inicjał nazwiska, województwo, ustawienie widoczności profilu | prowadzenie profilu i — po uruchomieniu funkcji — pokazywanie go innym odkrywcom, jeśli tak ustawisz | wykonanie umowy (art. 6 ust. 1 lit. b) |
| wizyty: miejsce, data i godzina, rodzaj wizyty, a przy wizycie z przeszłości podana przez Ciebie data | prowadzenie albumu, liczenie postępu w kolekcjach i statystyk (np. „km w trasie”), a po uruchomieniu funkcji także kart legendarnych | wykonanie umowy (art. 6 ust. 1 lit. b) |
| pozycja urządzenia i jej dokładność (tylko na chwilę, punkt 4) | sprawdzenie, czy jesteś w pobliżu miejsca | wykonanie umowy (art. 6 ust. 1 lit. b) |
| zdjęcia, które dodajesz, Twój wybór podpisu i oświadczenie o prawach do zdjęcia (z wersją i datą) — po uruchomieniu funkcji | moderacja i pokazywanie zdjęć w serwisie, dowód udzielenia licencji | wykonanie umowy (art. 6 ust. 1 lit. b); przechowywanie oświadczenia — nasz prawnie uzasadniony interes w obronie przed roszczeniami (art. 6 ust. 1 lit. f) |
| zdjęcie i ewentualny podpis w materiałach promujących serwis (tylko jeśli się na to zgodzisz) — po uruchomieniu funkcji | promocja serwisu, np. w mediach społecznościowych i prezentacjach | Twoja zgoda (art. 6 ust. 1 lit. a); przechowywanie dowodu zgody — nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f) |
| zapisane kolekcje, własne kolekcje (widoczne tylko dla Ciebie), lista „Chcę zobaczyć” | prowadzenie Twoich kolekcji i list | wykonanie umowy (art. 6 ust. 1 lit. b) |
| zgłoszenia problemów z miejscem: którego miejsca dotyczy zgłoszenie, rodzaj problemu, Twój opis, czas wysłania oraz decyzja kuratora z uzasadnieniem | przekazanie zgłoszenia kuratorowi kolekcji, poprawienie danych o miejscu, pokazanie Ci wyniku w „Moich zgłoszeniach” | wykonanie umowy (art. 6 ust. 1 lit. b) |
| powiadomienia w serwisie — po uruchomieniu funkcji | informowanie o sprawach konta i kolekcji | wykonanie umowy (art. 6 ust. 1 lit. b) |
| adres e-mail oraz wybrane kolekcje w celu wysyłki zapowiedzi wydarzeń kuratorów — po uruchomieniu funkcji | informowanie o wydarzeniach | Twoja zgoda (art. 6 ust. 1 lit. a RODO oraz art. 398 Prawa komunikacji elektronicznej) |
| dane kuratora oraz — po uruchomieniu funkcji — osoby, która składa wniosek „Zostań kuratorem”: imię, e-mail, nazwa i rodzaj organizacji, funkcja w organizacji, podany we wniosku kontakt i adres strony internetowej, decyzja o wniosku, rola i uprawnienia w organizacji | rozpatrzenie wniosku, nadanie uprawnień członkom zespołu, zarządzanie kolekcjami | wykonanie umowy (art. 6 ust. 1 lit. b); wobec członków zespołu zgłoszonych przez organizację (dane otrzymane od organizacji, art. 14 RODO) — nasz prawnie uzasadniony interes w obsłudze organizacji kuratorskiej (art. 6 ust. 1 lit. f) |
| liczniki prób logowania, wysyłki kodów i potwierdzania wizyt: adres IP, identyfikator konta oraz nieodwracalny skrót adresu e-mail (HMAC-SHA256) | ochrona przed przejmowaniem kont i nadużyciami (w tym zapobieganie ponownej rejestracji kont zablokowanych za naruszenia) | nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f) |
| dziennik operacji: kto i kiedy wykonał ważną czynność (np. nadał uprawnienia, zmienił kolekcję, usunął konto) i czego dotyczyła | bezpieczeństwo serwisu, wykrywanie nadużyć, dochodzenie roszczeń i obrona przed nimi | nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f) |
| dane techniczne: adres IP, rodzaj przeglądarki, czas żądania, zapisy błędów | utrzymanie i zabezpieczenie serwisu | nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f) |
| zgłoszenia treści, reklamacje, odwołania, wiadomości do nas (imię, nazwisko, e-mail, treść) oraz nasze decyzje i ich uzasadnienia | rozpatrzenie sprawy, wykonanie obowiązków z aktu o usługach cyfrowych i RODO, obrona przed roszczeniami | obowiązek prawny (art. 6 ust. 1 lit. c); nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f) |
| wizerunek i inne dane osób widocznych na zdjęciach albo wskazanych w zgłoszeniach | moderacja i publikacja zdjęć, rozpatrzenie zgłoszeń | nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f); ze względu na brak danych kontaktowych i niewspółmiernie duży wysiłek stosujemy zwolnienie z art. 14 ust. 5 lit. b RODO |
| imię i nazwisko albo pseudonim autora zdjęcia z Wikimedia Commons (punkt 5) | podanie autora zgodnie z licencją zdjęcia | nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f) |

Podanie adresu e-mail jest warunkiem założenia konta. Pozostałe dane podajesz dobrowolnie; bez nich nie skorzystasz z części funkcji (np. bez dostępu do lokalizacji nie potwierdzisz wizyty na miejscu).

Jeżeli dane członka zespołu kuratora otrzymujemy bezpośrednio od organizacji kuratorskiej (imię, adres e-mail, funkcja w organizacji), obowiązek informacyjny z art. 14 RODO spełniamy w pierwszej wiadomości e-mail wysyłanej do tej osoby.

Jeśli przetwarzamy dane na podstawie naszego prawnie uzasadnionego interesu, możesz poprosić o informację, jak oceniliśmy, że Twoje prawa i wolności nie przeważają nad tym interesem.

## 4. Lokalizacja Twojego urządzenia

- O dostęp do lokalizacji pyta Twoja przeglądarka. Możesz odmówić albo w każdej chwili cofnąć to pozwolenie w ustawieniach przeglądarki.
- Przy potwierdzaniu wizyty przeglądarka wysyła nam jednorazowo Twoją pozycję i jej dokładność. Serwer oblicza odległość od miejsca i od razu odrzuca pozycję. **Nie zapisujemy współrzędnych Twojego urządzenia ani w bazie danych, ani w zapisach błędów.**
- Jeśli jesteś w pobliżu miejsca, zapisujemy wizytę: miejsce, datę i godzinę. Taki zapis pokazuje więc Twoją obecność w okolicy tego miejsca o tej godzinie, choć nie zawiera współrzędnych urządzenia. Nieudanej próby nie zapisujemy jako wizyty; zwiększamy tylko licznik prób, który chroni przed nadużyciami i wygasa najpóźniej po 2 dniach.
- Gdy wybierzesz „Pokaż najbliższe” na stronie głównej, odległość liczy Twoja przeglądarka; pozycja nie trafia wtedy do nas.

## 5. Zdjęcia

Dodawanie zdjęć przez odkrywców uruchomimy później; do tego czasu pierwsze sześć punktów poniżej nie ma zastosowania. Dziś przy miejscach pokazujemy wyłącznie zdjęcia z Wikimedia Commons (ostatni punkt).

- Zanim zapiszemy zdjęcie, usuwamy z pliku dane zapisane przez aparat (metadane), w tym współrzędne GPS.
- Do czasu decyzji zdjęcie widzisz Ty, kurator uprawniony do moderacji kolekcji i administrator serwisu.
- Po akceptacji zdjęcie widzą wszyscy, także osoby bez konta. **Domyślnie publikujemy je bez podpisu.** Jeśli przy dodawaniu zaznaczysz „Podpisz zdjęcie moim imieniem i inicjałem nazwiska”, przy zdjęciu pojawi się Twoje imię i — jeśli jest w Twoim profilu — inicjał nazwiska, niezależnie od tego, czy Twój profil jest widoczny.
- Jeśli zgodzisz się na to osobno, możemy pokazać zdjęcie w materiałach promujących serwis. Zgodę możesz w każdej chwili cofnąć; zaprzestaniemy dalszego wykorzystywania zdjęcia w nowych materiałach, a z materiałów pozostających pod naszą kontrolą usuniemy Twój podpis.
- Zdjęcie można dodać tylko po wizycie, więc podpisane zdjęcie pokazuje innym Twoją wizytę w tym miejscu.
- Zasady korzystania ze zdjęć opisują regulamin i oświadczenie o prawach do zdjęcia.
- Przy zdjęciach miejsc z Wikimedia Commons pokazujemy imię i nazwisko albo pseudonim autora w postaci podanej w opisie pliku w Commons, bo wymaga tego licencja zdjęcia (nasz prawnie uzasadniony interes, art. 6 ust. 1 lit. f RODO; ze względu na brak danych kontaktowych i dużą liczbę autorów stosujemy zwolnienie z indywidualnego obowiązku informacyjnego na podstawie art. 14 ust. 5 lit. b RODO). Dane autora przechowujemy wyłącznie przez czas pokazywania zdjęcia w serwisie. Jeśli jesteś autorem i nie chcesz, żebyśmy pokazywali Twoje zdjęcie, napisz do nas — zdejmiemy je.

## 6. Kto widzi Twoje dane

- **Inni zalogowani odkrywcy** — po uruchomieniu widocznego profilu — zobaczą Twoje imię, inicjał nazwiska, województwo i liczby w profilu (np. liczbę odkrytych miejsc, kart legendarnych, „km w trasie”) tylko wtedy, gdy ustawisz profil jako widoczny. Dziś profilu nie widzi nikt poza Tobą. Goście nie widzą profili.
- **Twoich wizyt (miejsc i dat) nie pokazujemy innym.** Wyjątki, które wynikają z Twoich wyborów: podpisane zdjęcie (punkt 5) oraz liczby w widocznym profilu — oba po uruchomieniu tych funkcji.
- **Kuratorzy** nie widzą, kto odwiedził które miejsce ani kto zapisał ich kolekcję; widzą tylko łączną liczbę zapisów kolekcji, a przy bardzo małych liczbach samą informację „mniej niż 3”. Gdy wyślesz zgłoszenie problemu z miejscem, kurator kolekcji zobaczy przy nim Twoje imię i inicjał nazwiska (np. „Anna K.”), bez adresu e-mail; mówimy o tym w formularzu przed wysłaniem. Po uruchomieniu zdjęć odkrywców kurator zobaczy też zdjęcia wysłane do jego kolekcji. Ty przy decyzji widzisz nazwę organizacji, nie nazwisko kuratora. Kuratorami są organizacje (np. gminy, oddziały PTTK, organizacje turystyczne) i osoby zatwierdzone przez nas oraz członkowie ich zespołów.
- **Administrator serwisu** ma dostęp do danych w zakresie potrzebnym do utrzymania serwisu, moderacji i rozpatrywania zgłoszeń.
- **Firmy przetwarzające dane na nasze zlecenie** (podmioty przetwarzające) na podstawie umowy powierzenia:
  - netcup GmbH, Emmy-Noether-Straße 10, 76131 Karlsruhe, Niemcy — serwer: baza danych, zdjęcia i kopie zapasowe w centrum danych w Norymberdze;
  - Brevo SAS, 17 rue Salneuve, 75017 Paryż, Francja — wysyłka e-maili z kodami logowania i innych wiadomości dotyczących konta. Wyłączamy w nim śledzenie otwarć wiadomości i kliknięć w linki;
  - Hostido.pl Gałązka spółka jawna, ul. Kartuska 5, 80-103 Gdańsk — obsługa skrzynek pocztowych w domenie krajozbior.pl (kontakt@, zgloszenia@, reklamacje@, prywatnosc@, bezpieczenstwo@, partnerzy@), na które przychodzą wiadomości od Ciebie.
- **Organy publiczne**, jeśli zażądają danych na podstawie przepisów prawa.

Nie sprzedajemy Twoich danych i nie przekazujemy ich do celów reklamowych.

## 7. Mapa i OpenStreetMap

Na stronie kolekcji domyślnie widać listę miejsc. Gdy wybierzesz widok „Mapa”, Twoja przeglądarka pobiera fragmenty mapy bezpośrednio z serwerów OpenStreetMap Foundation (St John's Innovation Centre, Cowley Road, Cambridge, CB4 0WS, Wielka Brytania). Przekazuje im wtedy Twój adres IP, informacje o przeglądarce, adres strony, z której pochodzi żądanie, i oglądany obszar.

Za samo uruchomienie widoku mapy i przekazanie tych danych odpowiadamy jako współadministratorzy razem z OpenStreetMap Foundation (art. 26 RODO); podstawą jest nasz prawnie uzasadniony interes w pokazaniu miejsc na mapie (art. 6 ust. 1 lit. f RODO). W ramach tego współadministrowania Krajozbiór odpowiada za zapewnienie Ci przejrzystej informacji w niniejszej polityce prywatności oraz za ładowanie mapy dopiero po Twoim wyraźnym wyborze widoku „Mapa”, natomiast OpenStreetMap Foundation samodzielnie odpowiada za obsługę serwerów map, dalsze przetwarzanie danych po ich otrzymaniu oraz rozpatrywanie żądań kierowanych bezpośrednio do Fundacji, zgodnie ze swoją polityką prywatności: <https://osmfoundation.org/wiki/Privacy_Policy>.

Wobec Wielkiej Brytanii Komisja Europejska stwierdziła odpowiedni stopień ochrony danych (decyzja obowiązuje do 27 grudnia 2031 r.). OpenStreetMap Foundation dostarcza fragmenty mapy przez globalną sieć serwerów pośredniczących (według jej informacji korzysta z usług firmy Fastly), więc Twoje dane mogą trafić także do państw poza Wielką Brytanią. OpenStreetMap Foundation nie podaje listy tych państw ani zabezpieczeń takiego przekazania.

Jeśli nie chcesz przekazywać tych danych, nie wybieraj widoku „Mapa”; lista miejsc zawiera te same informacje.

To samo dzieje się w edytorze miejsca w panelu kuratora, gdy kurator wybierze „Pokaż mapę”. Kurator, który nie chce przekazywać tych danych, nie wybiera „Pokaż mapę” i ustawia położenie miejsca, wpisując współrzędne w polach formularza albo wyszukując adres.

Wyszukiwanie adresu w edytorze miejsca korzysta z usługi Nominatim, którą także prowadzi OpenStreetMap Foundation. Zapytanie wysyła nasz serwer, a nie przeglądarka kuratora, i zawiera wyłącznie wpisany tekst adresu. Do usługi nie trafiają adres IP kuratora, informacje o jego przeglądarce ani dane konta.

## 8. Przekazywanie danych poza Europejski Obszar Gospodarczy

Nasz serwer i kopie zapasowe znajdują się w Niemczech. Poza Europejski Obszar Gospodarczy dane mogą trafić w dwóch sytuacjach:

- gdy wybierzesz widok „Mapa” albo, jako kurator, „Pokaż mapę” w edytorze miejsca (punkt 7);
- przy wysyłce e-maili: Brevo korzysta z podwykonawców, z których część ma siedzibę lub serwery w Stanach Zjednoczonych (np. Cloudflare — ochrona i przyspieszanie ruchu sieciowego, Zendesk — obsługa zgłoszeń). Podstawą przekazania jest decyzja Komisji Europejskiej o odpowiednim stopniu ochrony danych w ramach EU-US Data Privacy Framework (wobec firm, które do niego przystąpiły) oraz standardowe klauzule umowne zatwierdzone przez Komisję Europejską. Aktualną listę podwykonawców Brevo podaje w swojej umowie powierzenia (załącznik do regulaminu Brevo): <https://www.brevo.com/legal/termsofuse/>.

## 9. Jak długo przechowujemy dane

| Dane | Okres |
| --- | --- |
| konto, profil, wizyty, zapisane i własne kolekcje, lista „Chcę zobaczyć”, zdjęcia | do usunięcia konta (usunięcie następuje od razu, z zastrzeżeniem spornych treści objętych toczącym się postępowaniem w sprawie zgłoszenia naruszenia lub obroną przed roszczeniami na podstawie art. 17 ust. 3 lit. b i e RODO) |
| adres e-mail podany przy rozpoczęciu zakładania konta bez akceptacji regulaminu | do akceptacji regulaminu; jeśli klikniesz odmowę akceptacji — usuwamy od razu; jeśli nie dokończysz rejestracji — usuwamy automatycznie po 7 dniach |
| sesja logowania (identyfikator, czas, rodzaj przeglądarki) | do wylogowania albo wygaśnięcia, najdłużej 30 dni |
| konto zablokowane za naruszenie regulaminu | 14 dni od doręczenia zawiadomienia albo do rozpatrzenia odwołania (w razie prawnego zakazu zawiadomienia użytkownika bieg 14-dniowego terminu rozpoczyna się od dnia doręczenia zawiadomienia po ustaniu tego zakazu), potem usuwamy je jak wyżej |
| nieodwracalny skrót adresu e-mail (HMAC-SHA256) konta zablokowanego za naruszenie regulaminu (ochrona przed ponowną rejestracją) | 12 miesięcy od usunięcia zablokowanego konta |
| teksty i zdjęcia organizacji kuratorskiej, także po utracie statusu | na czas nieokreślony, na podstawie licencji z regulaminu (rozdział 10 ust. 6–7); po utracie statusu kolekcje przestają być widoczne w serwisie, a dane osobowe członków zespołu usuwamy z kolekcji |
| dowód zawarcia umowy powierzenia przetwarzania danych z organizacją kuratorską (imię, nazwisko, funkcja osoby działającej za organizację, wersja dokumentów, data) | przez okres współpracy oraz przez 3 lata od jej zakończenia |
| nieprzyjęte zaproszenie do zespołu kuratora (adres e-mail) — po uruchomieniu funkcji | do przyjęcia zaproszenia albo automatycznego usunięcia po 14 dniach |
| zgoda na użycie zdjęcia w promocji i jej dowód (po uruchomieniu funkcji) | do cofnięcia zgody albo usunięcia zdjęcia, a dowód zgody następnie przez 3 lata od cofnięcia zgody lub usunięcia zdjęcia |
| jednorazowy kod logowania | do wykorzystania albo wygaśnięcia kodu (10 minut) |
| liczniki prób logowania, wysyłki kodów i potwierdzania wizyt (adres IP, identyfikator konta, skrót adresu e-mail) | od 15 minut do 2 dni, także po dobrowolnym usunięciu konta |
| zgłoszenia problemów z miejscem | do usunięcia konta; zgłoszenie jeszcze nierozpatrzone usuwamy wtedy w całości, a już rozpatrzone zostaje bez Twoich danych i bez treści opisu |
| wniosek „Zostań kuratorem” (po uruchomieniu funkcji) | do usunięcia konta; wniosek, który czeka na decyzję, możesz wcześniej wycofać, a odrzucony — usunąć |
| powiadomienia w serwisie (po uruchomieniu funkcji) | 90 dni |
| oświadczenia o prawach do zdjęć (po uruchomieniu funkcji) | do usunięcia konta, a następnie przez 3 lata od usunięcia zdjęcia |
| akceptacja regulaminu (wersja i czas) | do usunięcia konta, a w przypadku sporu lub blokady konta — przez 3 lata od zakończenia korzystania z konta |
| dziennik operacji | 12 miesięcy od wpisu; po usunięciu konta zostaje w nim wyłącznie wewnętrzny identyfikator konta, bez e-maila i imienia |
| kopie zapasowe | najdłużej 30 dni; po tym czasie dane usuniętego konta znikają także z kopii |
| dane techniczne (adres IP, rodzaj przeglądarki, zapisy błędów) | najdłużej 14 dni |
| zgłoszenia treści, reklamacje i odwołania | do zakończenia sprawy, a następnie przez 3 lata od jej zakończenia |
| zwykłe wiadomości w innych sprawach (np. pytania ogólne) | do zakończenia sprawy, a następnie przez 12 miesięcy od jej zakończenia |

## 10. Twoje prawa

Masz prawo:

- uzyskać dostęp do swoich danych i ich kopię (art. 15 RODO);
- sprostować dane (art. 16 RODO) — większość zmienisz samodzielnie w profilu;
- usunąć dane (art. 17 RODO) — najprościej przez usunięcie konta;
- ograniczyć przetwarzanie (art. 18 RODO);
- otrzymać swoje dane w formacie nadającym się do odczytu maszynowego (np. JSON albo CSV) i przenieść je do innego administratora (art. 20 RODO);
- nie podlegać decyzji, która opiera się wyłącznie na zautomatyzowanym przetwarzaniu i wywołuje wobec Ciebie skutki prawne lub w podobny sposób istotnie na Ciebie wpływa (art. 22 RODO — szczegóły w punkcie 11);
- w każdej chwili cofnąć zgodę na użycie zdjęcia w promocji serwisu lub na otrzymywanie zapowiedzi wydarzeń (art. 7 ust. 3 RODO); cofnięcie zgody nie wpływa na zgodność z prawem przetwarzania przed jej cofnięciem.

**Prawo sprzeciwu.** Z przyczyn związanych z Twoją szczególną sytuacją możesz w każdej chwili wnieść sprzeciw wobec przetwarzania, które opieramy na naszym prawnie uzasadnionym interesie (art. 21 RODO).

Aby skorzystać z tych praw, napisz na ${ADDRESS.privacy}. Odpowiemy w ciągu miesiąca; w sprawach szczególnie złożonych możemy przedłużyć ten termin o dwa miesiące, o czym poinformujemy Cię przed upływem pierwszego miesiąca. Możemy poprosić o potwierdzenie, że jesteś właścicielem konta, np. o wiadomość z adresu przypisanego do konta.

Masz też prawo złożyć skargę do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa, <https://uodo.gov.pl>).

## 11. Statystyki i zautomatyzowane podejmowanie decyzji

- Z Twoich wizyt liczymy statystyki, np. „km w trasie” (suma odległości w linii prostej między kolejnymi wizytami na miejscu, dzień po dniu). Pokazujemy je Tobie, a po uruchomieniu widocznego profilu także innym zalogowanym odkrywcom, jeśli ustawisz profil jako widoczny. Nie wykorzystujemy ich do reklamy ani do podejmowania decyzji wobec Ciebie.
- Serwis automatycznie sprawdza, czy jesteś w pobliżu miejsca, i na tej podstawie zalicza wizytę na miejscu. Nie wywołuje to wobec Ciebie skutków prawnych ani podobnie istotnych skutków w rozumieniu art. 22 RODO.

## 12. Pliki cookies i podobne technologie

Serwis zapisuje w Twojej przeglądarce wyłącznie informacje niezbędne do świadczenia usługi, o którą prosisz:

| Zapis | Po co | Jak długo |
| --- | --- | --- |
| pliki cookies logowania (z przedrostkiem „krajozbior”) | utrzymanie sesji po zalogowaniu | 30 dni od zalogowania |
| plik cookie wyglądu | zapamiętanie wybranego wyglądu (nocny albo jasny); powstaje także bez konta, gdy zmienisz wygląd | 1 rok |
| plik cookie szkicu profilu | zapamiętanie niezapisanych zmian w profilu | 2 minuty |
| plik cookie adresu logowania (z przedrostkiem „krajozbior”) | zapamiętanie adresu e-mail między krokami logowania kodem; przeglądarka wysyła go tylko na stronę logowania | 10 minut; usuwamy go po zalogowaniu, po wylogowaniu i po kliknięciu „Zmień adres” |
| pamięć sesji przeglądarki (sessionStorage) | zapamiętanie adresu e-mail wpisanego w formularzu logowania, gdy strona odświeża się po błędzie | do zamknięcia karty |
| pamięć sesji przeglądarki (sessionStorage) | zapamiętanie zamknięcia paska informacyjnego serwisu | do zamknięcia karty |

Nie używamy narzędzi analitycznych ani reklamowych. Nie prosimy więc o zgodę na pliki cookies; przepisy nie wymagają jej dla zapisów niezbędnych do świadczenia usługi, o którą prosisz (art. 399 ust. 3 ustawy z 12 lipca 2024 r. — Prawo komunikacji elektronicznej).

Pliki cookies możesz usunąć albo zablokować w ustawieniach przeglądarki; bez plików cookies logowania nie zalogujesz się.

## 13. Wiek

Konto może założyć osoba, która ukończyła 16 lat. Akceptując regulamin, oświadczasz, że masz ukończone 16 lat. Jeśli ustalimy, że konto założyła osoba młodsza, usuniemy je. Dodawanie zdjęć oraz publikowanie własnych utworów tekstowych w opisach miejsc i kolekcjach publicznych wymaga ukończenia 18 lat.

## 14. Bezpieczeństwo

Połączenie z serwisem jest szyfrowane. Dostęp do danych ograniczamy regułami, które działają zarówno w aplikacji, jak i w samej bazie danych: odkrywca widzi swoje dane prywatne, a kurator tylko dane potrzebne do prowadzenia jego kolekcji. Ważne czynności zapisujemy w dzienniku operacji, którego nie można zmienić z poziomu aplikacji. W razie naruszenia ochrony danych, które może spowodować wysokie ryzyko dla Ciebie, niezwłocznie Cię o tym poinformujemy.

## 15. Zmiany polityki

O istotnych zmianach tej polityki poinformujemy e-mailem i w serwisie co najmniej 14 dni przed ich wejściem w życie. Poprzednie wersje polityki udostępniamy w serwisie.
`;
