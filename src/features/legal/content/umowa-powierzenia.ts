// Umowa powierzenia przetwarzania danych osobowych dla organizacji kuratorskiej (załącznik nr 2
// do regulaminu): wersja 1.1, obowiązuje od 28 listopada 2026 r.
import { CONTACT_ADDRESSES as ADDRESS } from "../domain/legal-pages";

export const UMOWA_POWIERZENIA = `
Umowa zawarta między:

1. **Mariuszem Skowronem**, prowadzącym serwis internetowy Krajozbiór (https://krajozbior.pl), adres do doręczeń: ul. Urzędnicza 42, 91-304 Łódź, e-mail: ${ADDRESS.privacy}, zwanym dalej **„Administratorem”**,

a

2. **organizacją kuratorską**, której dane identyfikacyjne oraz dane osoby działającej w jej imieniu wskazano we wniosku o nadanie statusu organizacji kuratorskiej lub w dokumencie nadania tego statusu, zwaną dalej **„Podmiotem przetwarzającym”**,

zwanymi dalej łącznie **„Stronami”**.

## § 1. Przedmiot i czas trwania powierzenia

1. Administrator powierza Podmiotowi przetwarzającemu do przetwarzania dane osobowe w trybie art. 28 ust. 3 rozporządzenia Parlamentu Europejskiego i Rady (UE) 2016/679 (RODO), wyłącznie w celu i zakresie niezbędnym do prowadzenia kolekcji miejsc, organizowania wydarzeń oraz weryfikacji zgłoszeń i zdjęć w serwisie Krajozbiór zgodnie z rozdziałem 10 [regulaminu](/regulamin) serwisu.
2. Umowa zostaje zawarta na czas posiadania przez Podmiot przetwarzający statusu organizacji kuratorskiej w serwisie Krajozbiór i wygasa z chwilą rezygnacji z tego statusu albo jego odebrania przez Administratora.

## § 2. Charakter, cel, rodzaj danych i kategorie osób

1. **Charakter i cel przetwarzania:** przeglądanie i rozpatrywanie zgłoszeń problemów z miejscami oraz (po uruchomieniu funkcji) weryfikacja i moderacja zdjęć przesyłanych przez użytkowników do kolekcji prowadzonych przez Podmiot przetwarzający w panelu kuratora serwisu Krajozbiór.
2. **Kategorie osób, których dane dotyczą:** użytkownicy serwisu Krajozbiór (odkrywcy) przesyłający zgłoszenia problemów z miejscami lub zdjęcia do kolekcji, a także osoby trzecie widoczne na przesyłanych zdjęciach lub wskazane w zgłoszeniach.
3. **Rodzaj powierzonych danych osobowych:** imię i inicjał nazwiska odkrywcy, treść zgłoszenia problemu z miejscem, przesłane zdjęcie (wraz z ewentualnym wizerunkiem osób na nim uwidocznionych przed moderacją) oraz wybrany przez autora sposób podpisu zdjęcia. Podmiot przetwarzający nie uzyskuje dostępu do adresów e-mail odkrywców ani do historii ich wizyt.

## § 3. Obowiązki i prawa Administratora

1. Administrator zobowiązuje się przetwarzać dane osobowe zgodnie z RODO oraz przekazywać Podmiotowi przetwarzającemu udokumentowane polecenia dotyczące przetwarzania powierzonych danych, za które uznaje się postanowienia regulaminu serwisu Krajozbiór, niniejszej umowy oraz komunikaty systemowe w panelu kuratora.
2. Administrator zapewnia bezpieczne środowisko techniczne panelu kuratora oraz realizuje obowiązki informacyjne wobec osób, których dane dotyczą (art. 13 i art. 14 RODO, w tym wobec kandydatów na członków zespołu zgłoszonych przez Podmiot przetwarzający), a także rozpatruje żądania osób wynikające z rozdziału III RODO.
3. Administrator ma prawo w każdym czasie kontrolować zgodność przetwarzania powierzonych danych z umową i przepisami prawa, żądać od Podmiotu przetwarzającego wyjaśnień i dokumentów potwierdzających spełnienie obowiązków z art. 28 RODO, a w razie stwierdzenia lub uzasadnionego podejrzenia naruszenia bezpieczeństwa danych — niezwłocznie zawiesić lub cofnąć dostęp do panelu kuratora.

## § 4. Obowiązki Podmiotu przetwarzającego

Podmiot przetwarzający zobowiązuje się:

1. przetwarzać powierzone dane osobowe wyłącznie na udokumentowane polecenie Administratora, za które uważa się postanowienia regulaminu serwisu Krajozbiór oraz niniejszej umowy, i wyłącznie w obrębie panelu kuratora udostępnionego w serwisie;
2. nie przekazywać powierzonych danych osobowych do państwa trzeciego (poza Europejski Obszar Gospodarczy) ani organizacji międzynarodowej (art. 28 ust. 3 lit. a RODO), w tym zapewnić, aby logowanie do panelu kuratora i uzyskiwanie dostępu do danych użytkowników odbywało się wyłącznie z terytorium Europejskiego Obszaru Gospodarczego, chyba że Administrator wyrazi na to uprzednią pisemną zgodę po spełnieniu wymogów rozdziału V RODO;
3. dopuszczać do przetwarzania powierzonych danych wyłącznie członków swojego zespołu posiadających imienne upoważnienie Podmiotu przetwarzającego oraz zobowiązanych do zachowania tajemnicy (art. 28 ust. 3 lit. b RODO), a także niezwłocznie zgłaszać Administratorowi konieczność odebrania dostępu osobom, które zakończyły współpracę z Podmiotem przetwarzającym;
4. nie pobierać, nie kopiować, nie eksportować ani nie zapisywać powierzonych danych osobowych użytkowników (w szczególności niezatwierdzonych zdjęć ani treści zgłoszeń) poza środowisko serwisu Krajozbiór;
5. stosować odpowiednie środki techniczne i organizacyjne zapewniające bezpieczeństwo dostępu do kont członków zespołu (silne uwierzytelnianie na urządzeniach końcowych, ochrona dostępu do skrzynek pocztowych służących do logowania kodem jednorazowym);
6. nie korzystać z usług innego podmiotu przetwarzającego (podpowierzenia) bez uprzedniej pisemnej zgody Administratora;
7. wspierać Administratora w wywiązywaniu się z obowiązku odpowiadania na żądania osób, których dane dotyczą (rozdział III RODO), oraz z obowiązków określonych w art. 32–36 RODO, a także prowadzić rejestr wszystkich kategorii czynności przetwarzania dokonywanych w imieniu Administratora, jeżeli dotyczy go taki obowiązek zgodnie z art. 30 ust. 2 RODO;
8. **niezwłocznie, nie później niż w ciągu 24 godzin** od powzięcia informacji, zgłaszać Administratorowi na adres ${ADDRESS.security} każde stwierdzone lub podejrzewane naruszenie ochrony powierzonych danych osobowych (w szczególności przejęcie konta członka zespołu lub nieuprawniony dostęp do panelu kuratora);
9. po zakończeniu świadczenia usług związanych z przetwarzaniem niezwłocznie usunąć wszelkie ewentualne kopie robocze danych osobowych, jeżeli mimo zakazu z pkt 4 znalazły się w jego posiadaniu, i potwierdzić ten fakt Administratorowi na jego żądanie;
10. udostępniać Administratorowi wszelkie informacje niezbędne do wykazania spełnienia obowiązków określonych w art. 28 RODO oraz umożliwiać Administratorowi lub upoważnionemu przez niego audytorowi przeprowadzanie audytów i inspekcji (w tym w formie zdalnej weryfikacji oświadczeń i konfiguracji dostępu).

## § 5. Postanowienia końcowe

1. Przetwarzanie danych w ramach niniejszej umowy ma charakter nieodpłatny i odbywa się w ramach współpracy kuratorskiej określonej w regulaminie serwisu Krajozbiór.
2. Umowa zostaje zawarta w formie elektronicznej (art. 28 ust. 9 RODO):
   - w przypadku osób fizycznych, stowarzyszeń, fundacji i podmiotów prywatnych — z chwilą złożenia przez osobę umocowaną do reprezentacji Podmiotu przetwarzającego oświadczenia o akceptacji niniejszej umowy we wniosku „Zostań kuratorem” lub w wiadomości e-mail potwierdzającej przyjęcie statusu organizacji kuratorskiej;
   - w przypadku jednostek samorządu terytorialnego (gmin, powiatów, województw) oraz innych jednostek sektora finansów publicznych — z chwilą podpisania niniejszej umowy kwalifikowanym podpisem elektronicznym lub podpisem zaufanym przez osobę uprawnioną do reprezentacji jednostki.
`;
