// Oświadczenie o prawach do zdjęcia i licencja (załącznik nr 1 do regulaminu): wersja 1.1
// (obowiązuje od 28 listopada 2026 r.). Teksty pól wyboru przy formularzu dodawania zdjęcia
// są instrukcją dla interfejsu, nie częścią dokumentu: wejdą razem z dodawaniem zdjęć (E4).
import { CONTACT_ADDRESSES as ADDRESS } from "../domain/legal-pages";

export const OSWIADCZENIE_O_ZDJECIACH = `
Dodawanie zdjęć przez odkrywców nie jest jeszcze dostępne w serwisie; ten dokument określa zasady, które będą obowiązywać od chwili uruchomienia tej funkcji. Do tego czasu jego postanowienia nie mają zastosowania.

## 1. Oświadczenie

Dodając zdjęcie do Krajozbioru, oświadczasz, że:

1. masz ukończone 18 lat i pełną zdolność do czynności prawnych;
2. zdjęcie jest Twoim autorskim dziełem i zostało wykonane osobiście przez Ciebie w miejscu, do którego je dodajesz;
3. przysługują Ci pełne autorskie prawa majątkowe do zdjęcia, nie zostały one przeniesione na inną osobę ani nie udzielono nikomu licencji wyłącznej uniemożliwiającej udzielenie licencji opisanej poniżej;
4. zdjęcie nie narusza praw osób trzecich, a w szczególności:
   - głównym motywem zdjęcia nie są ludzie; na zdjęciu nie widać osób, które można rozpoznać (po twarzy lub innych cechach szczególnych) — chyba że osoby te wyraziły zgodę na publikację swojego wizerunku albo stanowią jedynie drobny szczegół szerszego krajobrazu, zabytku lub wydarzenia publicznego;
   - na zdjęciu nie widać danych osobowych innych osób (np. czytelnych dokumentów, korespondencji albo tablic rejestracyjnych na pierwszym planie);
5. zdjęcie nie zawiera treści bezprawnych ani naruszających regulamin serwisu.

## 2. Licencja

1. Zachowujesz autorskie prawa majątkowe i osobiste do zdjęcia. Z chwilą dodania zdjęcia udzielasz usługodawcy (Mariuszowi Skowronowi, prowadzącemu Krajozbiór) niewyłącznej i nieodpłatnej licencji na korzystanie ze zdjęcia na następujących polach eksploatacji:
   1. utrwalanie i zwielokrotnianie zdjęcia techniką cyfrową w pamięci komputerów i serwerów, w tym w kopiach zapasowych;
   2. udostępnianie zdjęcia kuratorowi kolekcji i administratorowi serwisu w celu weryfikacji przed publikacją oraz moderacji;
   3. publiczne udostępnianie zdjęcia w taki sposób, aby każdy mógł mieć do niego dostęp w miejscu i czasie przez siebie wybranym, w tym na stronie internetowej https://krajozbior.pl oraz w aplikacjach mobilnych Krajozbioru;
   4. wyświetlanie miniatury zdjęcia w podglądach linków do stron serwisu (np. w komunikatorach i mediach społecznościowych, gdy użytkownik udostępnia odnośnik) oraz w wynikach wyszukiwarek internetowych;
   5. dokonywanie niezbędnych dostosowań technicznych pliku: zmiana rozdzielczości, formatu i stopnia kompresji pliku, kadrowanie do wymiarów wymaganych przez interfejs serwisu (np. miniatury i kafelki) oraz usuwanie z pliku metadanych, w tym współrzędnych GPS — bez zniekształcania treści zdjęcia; w tym zakresie zobowiązujesz się nie wykonywać nadzoru autorskiego.
2. Licencja obejmuje prawo do wyświetlania zdjęcia również jako okładki miejsca, okładki kolekcji lub ilustracji na stronie głównej serwisu (z zachowaniem informacji o autorze, jeśli zdjęcie jest podpisane).
3. Licencja z ust. 1 nie obejmuje wykorzystywania zdjęcia poza serwisem w celach reklamowych, promocyjnych ani w materiałach drukowanych. Wykorzystanie zdjęcia w materiałach promujących Krajozbiór (np. w mediach społecznościowych, prezentacjach lub materiałach informacyjnych serwisu) wymaga Twojej osobnej, dobrowolnej zgody wyrażonej przy dodawaniu zdjęcia. Zgodę tę możesz w każdej chwili cofnąć, pisząc na adres ${ADDRESS.privacy} lub w ustawieniach serwisu (po uruchomieniu tej opcji). Cofnięcie zgody powoduje wygaśnięcie zezwolenia na przyszłość: nie użyjemy zdjęcia w nowych materiałach promocyjnych, a z materiałów pozostających pod naszą kontrolą usuniemy Twój podpis; materiały wydrukowane lub rozpowszechnione przed cofnięciem zgody mogą pozostać w dotychczasowym obiegu bez wznawiania.
4. Licencja obowiązuje bez ograniczeń terytorialnych (na całym świecie) i na czas nieokreślony, do chwili jej wygaśnięcia na zasadach określonych w punkcie 4.
5. Udzielona licencja nie uprawnia usługodawcy ani osób trzecich do zwielokrotniania lub pobierania zdjęcia w celu eksploracji tekstów i danych (TDM) ani trenowania modeli sztucznej inteligencji (art. 26³ ustawy z 4 lutego 1994 r. o prawie autorskim i prawach pokrewnych).

## 3. Podpis autora

1. Domyślnie zdjęcie publikowane jest bez podpisu — nie zaznaczając pola wyboru podpisu, upoważniasz usługodawcę do udostępniania zdjęcia anonimowo (art. 16 pkt 2 ustawy o prawie autorskim i prawach pokrewnych).
2. Jeśli przy dodawaniu zdjęcia zaznaczysz pole wyboru „Podpisz zdjęcie moim imieniem i inicjałem nazwiska”, przy zdjęciu wyświetlimy Twoje imię oraz — jeśli jest w Twoim profilu — inicjał nazwiska (np. „Anna K.”). Podpis możesz w każdej chwili włączyć lub wyłączyć.
3. Jeśli w Twoim profilu nie ma wpisanego imienia, zaznaczenie podpisu nie jest możliwe do czasu jego uzupełnienia.

## 4. Wygaśnięcie licencji

1. Licencja z punktu 2 ust. 1 wygasa z chwilą, gdy:
   1. usuniesz zdjęcie albo swoje konto w serwisie;
   2. usuniemy zdjęcie albo Twoje konto;
   3. kurator odrzuci zdjęcie podczas weryfikacji przed publikacją (z chwilą podjęcia decyzji o odrzuceniu).
2. Po wygaśnięciu licencji usuwamy plik zdjęcia z serwisu niezwłocznie, a z kopii zapasowych po upływie okresu wskazanego w polityce prywatności (maksymalnie 30 dni). Miniatury zapisane w pamięci podręcznej wyszukiwarek internetowych lub komunikatorów mogą pozostawać widoczne przez czas zależny od tych zewnętrznych usług.
3. Jeżeli zdjęcie było ustawione jako okładka miejsca lub kolekcji, po jego usunięciu kurator wybiera inną okładkę.

## 5. Odpowiedzialność za naruszenie praw

1. Jeżeli osoba trzecia zgłosi, że Twoje zdjęcie narusza jej prawa autorskie, prawo do wizerunku lub inne dobra osobiste, możemy niezwłocznie ukryć zdjęcie do czasu wyjaśnienia sprawy i zwrócić się do Ciebie o zajęcie stanowiska ([regulamin](/regulamin), rozdział 8).
2. Jeżeli Twoje oświadczenie z punktu 1 okaże się nieprawdziwe i z tego powodu osoba trzecia wystąpi przeciwko usługodawcy z roszczeniem, ponosisz wobec usługodawcy odpowiedzialność odszkodowawczą na zasadach ogólnych określonych w Kodeksie cywilnym.
`;
