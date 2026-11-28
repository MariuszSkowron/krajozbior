// Regulamin serwisu: tekst publiczny, wersja 1.1 (obowiązuje od 28 listopada 2026 r.), pierwsza
// obowiązująca wersja. Adresy kontaktowe biorą się z CONTACT_ADDRESSES. Test w
// tests/features/legal/legal-content.test.ts pilnuje, żeby żaden znacznik roboczy nie trafił
// do ruchu publicznego.
import { CONTACT_ADDRESSES as ADDRESS } from "../domain/legal-pages";

export const REGULAMIN = `
## Rozdział 1. Postanowienia ogólne

1. Regulamin określa zasady korzystania z serwisu internetowego Krajozbiór, dostępnego pod adresem https://krajozbior.pl, oraz z aplikacji Krajozbioru, jeśli powstaną (dalej razem „serwis”).
2. Serwis prowadzi Mariusz Skowron, adres do doręczeń: ul. Urzędnicza 42, 91-304 Łódź (dalej „usługodawca”, „my”). Kontakt: ${ADDRESS.general}.
3. Regulamin jest regulaminem świadczenia usług drogą elektroniczną w rozumieniu art. 8 ustawy z 18 lipca 2002 r. o świadczeniu usług drogą elektroniczną.
4. Korzystanie z serwisu jest bezpłatne.
5. Pojęcia użyte w regulaminie:
   - **odkrywca** — osoba, która założyła konto w serwisie;
   - **gość** — osoba, która korzysta z serwisu bez konta;
   - **użytkownik** — odkrywca albo gość;
   - **miejsce** — obiekt albo punkt w terenie opisany w serwisie (np. zabytek, wieża ciśnień, punkt widokowy);
   - **kolekcja** — tematyczny zbiór miejsc;
   - **album** — zbiór wizyt odkrywcy;
   - **wizyta** — wpis w albumie, że odkrywca odwiedził miejsce. **Wizyta na miejscu** jest potwierdzona lokalizacją urządzenia, a **wizyta z przeszłości** to wizyta, którą odkrywca zaznaczył sam;
   - **„Chcę zobaczyć”** — prywatna lista miejsc, które odkrywca zamierza odwiedzić;
   - **organizacja kuratorska** — organizacja (np. gmina, oddział PTTK, organizacja turystyczna) albo osoba (np. przewodnik), której nadaliśmy uprawnienia do prowadzenia kolekcji;
   - **członek zespołu** — odkrywca, którego na prośbę organizacji kuratorskiej dopuściliśmy do prowadzenia jej kolekcji;
   - **kurator** — organizacja kuratorska i członkowie jej zespołu;
   - **wydarzenie** — wyznaczony przez kuratora okres, w którym wizyta na miejscu w wybranych miejscach kolekcji daje kartę legendarną;
   - **karta legendarna** — pamiątkowe wyróżnienie w albumie za wizytę na miejscu podczas wydarzenia;
   - **administrator serwisu** — my albo osoba, którą upoważniliśmy do zarządzania serwisem;
   - **treści użytkownika** — zdjęcia, opisy, nazwy kolekcji, zgłoszenia i inne materiały, które użytkownik dodaje do serwisu.

## Rozdział 2. Co oferuje serwis

1. W serwisie można, z zastrzeżeniem ust. 4:
   1. przeglądać kolekcje, miejsca, mapę i aktualności — także bez konta;
   2. po założeniu konta: zapisywać kolekcje, potwierdzać wizyty, prowadzić album, oglądać postęp i statystyki, tworzyć własne kolekcje, dodawać zdjęcia miejsc i zgłaszać poprawki lub problemy z miejscami;
   3. jako kurator: prowadzić kolekcje, opisywać miejsca, organizować wydarzenia oraz decydować o zdjęciach i zgłoszeniach odkrywców.
2. Wizyty, postęp, statystyki i karty legendarne mają charakter wyłącznie osobisty i pamiątkowy. Nie dają prawa do nagród, chyba że osobny regulamin wydarzenia stanowi inaczej (rozdział 10 ust. 8).
3. Możemy dodawać, zmieniać i wycofywać funkcje. O wycofaniu funkcji, z której korzystasz, uprzedzimy w serwisie co najmniej 14 dni wcześniej, chyba że bezpieczeństwo serwisu albo przepis prawa wymaga wycofania funkcji wcześniej.
4. Niektóre funkcje opisane w regulaminie uruchomimy później: dodawanie zdjęć przez odkrywców i decyzje kuratora o tych zdjęciach, wydarzenia i karty legendarne, publiczne kolekcje odkrywców oraz profil widoczny dla innych. Do czasu ich uruchomienia postanowienia o nich nie mają zastosowania. O uruchomieniu poinformujemy w serwisie. Dopóki w serwisie publikowane są wyłącznie kolekcje redakcji serwisu (bez publicznych treści odkrywców i bez zewnętrznych organizacji kuratorskich), serwis nie stanowi platformy internetowej w rozumieniu art. 3 lit. i rozporządzenia (UE) 2022/2065 (aktu o usługach cyfrowych).

## Rozdział 3. Wymagania techniczne

1. Do korzystania z serwisu potrzebne są: urządzenie z dostępem do internetu, aktualna przeglądarka internetowa (np. Chrome, Firefox, Safari, Edge) z włączoną obsługą JavaScriptu i plików cookies oraz — do założenia konta — adres e-mail.
2. Potwierdzenie wizyty na miejscu wymaga udostępnienia serwisowi lokalizacji urządzenia. Lokalizacja ustalana przez komputer bywa niedokładna, dlatego wizytę na miejscu najlepiej potwierdzać telefonem.
3. Korzystanie z internetu wiąże się z typowymi zagrożeniami, takimi jak złośliwe oprogramowanie czy próby wyłudzenia danych. Nigdy nie prosimy o kod logowania wysłany na Twój e-mail; nie przekazuj go nikomu.

## Rozdział 4. Konto

1. Konto może założyć osoba, która ukończyła 16 lat. Akceptując regulamin, oświadczasz, że masz ukończone 16 lat. Jeśli ustalimy, że konto założyła osoba młodsza, usuniemy je.
2. Konto zakładasz, podając adres e-mail i wpisując jednorazowy kod, który wyślemy na ten adres. Tym samym sposobem logujesz się później. Z konta skorzystasz po akceptacji regulaminu. Jeśli odmówisz akceptacji regulaminu, Twój adres e-mail usuwamy niezwłocznie; jeśli nie dokończysz zakładania konta, adres e-mail usuwamy automatycznie po upływie 7 dni (szczegóły w polityce prywatności).
3. Akceptując regulamin, zawierasz z nami umowę o korzystanie z serwisu na czas nieokreślony. Umowa jest bezpłatna.
4. Możesz mieć jedno konto. Konto jest osobiste; nie udostępniaj go innym osobom. Konta założone w celu obejścia blokady (ust. 7) możemy usunąć.
5. Możesz w każdej chwili usunąć konto w ustawieniach. Poprosimy Cię wtedy o ponowne zalogowanie i wpisanie słowa potwierdzającego. Usunięcie konta rozwiązuje umowę. Usuwamy wtedy od razu Twoje dane, w tym wizyty, własne kolekcje i zdjęcia, z następującymi zastrzeżeniami opisanymi szczegółowo w polityce prywatności:
   1. w kopiach zapasowych dane znikają najpóźniej po 30 dniach, a w dzienniku operacji przez 12 miesięcy pozostaje wyłącznie wewnętrzny identyfikator konta;
   2. w przypadku blokady konta (ust. 7) lub sporu dowód akceptacji regulaminu przechowujemy przez 3 lata od zakończenia korzystania z konta;
   3. jeżeli wobec Twojego konta lub dodanej przez Ciebie treści toczy się postępowanie wyjaśniające w sprawie zgłoszenia treści bezprawnej (rozdział 8) albo istnieje prawny obowiązek zachowania dowodów, usunięcie spornej treści oraz danych niezbędnych do wyjaśnienia sprawy, wykonania obowiązków prawnych lub ustalenia, dochodzenia i obrony przed roszczeniami (art. 17 ust. 3 lit. b i e RODO) następuje dopiero po zakończeniu tego postępowania.

   Kolekcje organizacji kuratorskiej, współtworzone przez Ciebie, nie są usuwane razem z Twoim kontem (rozdział 10 ust. 6).
6. Jeśli w zespole organizacji kuratorskiej jesteś jedyną osobą z dostępem, napisz do nas przed usunięciem konta na adres ${ADDRESS.partners}. Dodamy do zespołu inną osobę albo ustalimy, co zrobić z kolekcjami organizacji.
7. Jeśli rażąco albo uporczywie naruszasz regulamin, w szczególności dodajesz treści bezprawne, możemy zablokować Twoje konto. Zawiadomimy Cię o tym e-mailem z podaniem powodu i informacją o możliwości odwołania, chyba że zawiadomienie byłoby niezgodne z prawem lub żądaniem uprawnionego organu. Zablokowane konto usuniemy, a tym samym rozwiążemy umowę, dopiero po upływie 14 dni od zawiadomienia, a jeśli w tym czasie się odwołasz — po rozpatrzeniu odwołania (rozdział 9). Jeżeli zawiadomienie o blokadzie jest wyłączone przez przepisy prawa lub żądanie uprawnionego organu, konto pozostaje zablokowane, a bieg 14-dniowego terminu do jego usunięcia ulega zawieszeniu do czasu ustania tej przeszkody i doręczenia zawiadomienia. Do chwili usunięcia konta możesz poprosić o kopię swoich danych. Odwołanie złożone później rozpatrzymy, ale przywrócenie danych usuniętego konta może być niemożliwe.
8. Konto, na które nikt nie zalogował się przez 3 lata, możemy usunąć po dwukrotnym uprzedzeniu e-mailem — co najmniej 30 dni oraz 7 dni wcześniej (z zastrzeżeniem ust. 6 dla jedynego członka zespołu organizacji kuratorskiej).

## Rozdział 5. Zasady korzystania z serwisu

1. Korzystając z serwisu, przestrzegasz prawa, regulaminu i dobrych obyczajów.
2. Zabronione jest w szczególności:
   1. dodawanie treści bezprawnych, w tym naruszających prawa autorskie, dobra osobiste albo wizerunek innych osób, obraźliwych, wulgarnych, nawołujących do nienawiści albo przemocy;
   2. publikowanie danych osobowych innych osób, np. adresów, numerów telefonów, czytelnych dokumentów;
   3. dodawanie do publicznych kolekcji prywatnych domów i innych miejsc, które wskazują, gdzie mieszka konkretna osoba;
   4. dodawanie treści reklamowych i spamu;
   5. podawanie się za inną osobę albo organizację;
   6. celowe oszukiwanie mechanizmu potwierdzania wizyt, np. przez podawanie fałszywej lokalizacji;
   7. zautomatyzowane pobieranie danych z serwisu w sposób, który utrudnia jego działanie, oraz próby obejścia zabezpieczeń.
3. Wizyty z przeszłości zaznaczaj tylko dla miejsc naprawdę odwiedzonych.

## Rozdział 6. Bezpieczeństwo w terenie

1. Serwis zachęca do odwiedzania miejsc w terenie. Zachowaj przy tym ostrożność i oceniaj warunki na miejscu.
2. Opis miejsca, jego dostępność i stan mogą się zmienić i nie zawsze są aktualne. Przed wyjazdem sprawdź warunki na miejscu.
3. Nie wchodź na teren prywatny, ogrodzony ani zamknięty bez zgody właściciela. Zachowaj szczególną ostrożność w ruinach, na wieżach i w miejscach niebezpiecznych. Przestrzegaj przepisów, w tym przepisów o ochronie przyrody i zabytków.
4. Nie korzystaj z serwisu w sposób, który zagraża Tobie lub innym, np. podczas prowadzenia pojazdu.
5. Wizytę na miejscu potwierdzisz, gdy jesteś w pobliżu miejsca, w promieniu ustawionym przez kuratora (zwykle 200 m). Nie musisz w tym celu wchodzić na teren obiektu.
6. Jeśli zauważysz, że punkt potwierdzenia wizyty leży na terenie prywatnym albo niebezpiecznym, zgłoś to odnośnikiem „Zgłoś problem z miejscem” przy miejscu (potrzebne jest konto) albo napisz do nas na adres ${ADDRESS.reports} (gotową wiadomość otwiera odnośnik „Zgłoś naruszenie” przy miejscu). Poprawimy punkt albo przekażemy zgłoszenie kuratorowi.

## Rozdział 7. Treści użytkowników

1. Za treści, które dodajesz, odpowiadasz Ty.
2. Zdjęcie miejsca możesz dodać dopiero po wizycie, pod warunkiem że masz ukończone 18 lat. Dodając zdjęcie, składasz oświadczenie o prawach do zdjęcia i udzielasz nam licencji na zasadach opisanych w załączniku nr 1.
3. Przy dodawaniu zdjęcia decydujesz, czy podpisać je swoim imieniem i inicjałem nazwiska. Domyślnie zdjęcie jest publikowane bez podpisu. Osobno decydujesz, czy zgadzasz się na pokazywanie zdjęcia w materiałach promujących serwis; ta zgoda jest dobrowolna i nie wpływa na możliwość korzystania z serwisu.
4. Zdjęcie widzą inni dopiero po akceptacji kuratora kolekcji, do której należy miejsce. Do czasu decyzji zdjęcie widzisz Ty, kurator uprawniony do moderacji tej kolekcji i administrator serwisu. Ten ustęp nie ma zastosowania do czasu uruchomienia w serwisie dodawania zdjęć przez odkrywców.
5. Kurator może odrzucić zdjęcie tylko z jednego z następujących powodów, który wskazuje w decyzji:
   1. zdjęcie nie przedstawia tego miejsca;
   2. zdjęcie jest nieczytelne (np. nieostre, zbyt ciemne);
   3. głównym motywem zdjęcia są ludzie albo widać na nim rozpoznawalne osoby, które nie są jedynie szczegółem większej całości;
   4. zdjęcie pokazuje dane osobowe, np. czytelne dokumenty albo tablice rejestracyjne na pierwszym planie;
   5. zdjęcie jest bardzo podobne do zdjęcia już opublikowanego przy tym miejscu;
   6. zdjęcie narusza prawo albo regulamin (rozdział 5).

   Do czasu uruchomienia w serwisie dodawania zdjęć przez odkrywców nie mają zastosowania także ust. 2, 3 i 5.
6. Własna kolekcja jest prywatna, czyli widoczna tylko dla Ciebie. Własna kolekcja, którą oznaczysz jako publiczną, staje się widoczna dla innych dopiero po akceptacji administratora serwisu. W publicznej kolekcji nie dodawaj nowych miejsc położonych na terenie prywatnym ani niebezpiecznym. Postanowienia o kolekcjach publicznych nie mają zastosowania do czasu uruchomienia w serwisie publicznych kolekcji odkrywców.
7. Zgłoszenie poprawki albo problemu z miejscem wysyłasz odnośnikiem „Zgłoś problem z miejscem” przy miejscu. Trafia ono do kuratora kolekcji, który decyduje, czy je uwzględnić; decyzję zobaczysz w „Moich zgłoszeniach”. Jeśli w zgłoszeniu proponujesz własny twórczy fragment tekstu opisu miejsca, oświadczasz, że masz ukończone 18 lat, a z chwilą wysłania zgłoszenia udzielasz nam niewyłącznej, nieodpłatnej licencji na wykorzystanie, redagowanie i publikację tego tekstu w serwisie oraz w podglądach linków i wynikach wyszukiwarek bez ograniczeń czasowych i terytorialnych. Osoby poniżej 18. roku życia mogą zgłaszać wyłącznie błędy faktyczne (np. błędne współrzędne, zamknięty obiekt), bez dodawania własnych utworów tekstowych.
8. Oznaczenie własnej kolekcji jako publicznej wraz z autorskimi opisami i nazwami wymaga ukończenia 18 lat. Opisy i nazwy, które dodajesz do publicznej kolekcji, udostępniasz innym użytkownikom serwisu i udzielasz nam niewyłącznej, nieodpłatnej licencji na ich wyświetlanie w serwisie, w podglądach linków do serwisu i w wynikach wyszukiwarek przez czas, w którym kolekcja jest publiczna.
9. Treści użytkowników nie wyrażają naszego stanowiska. Zdjęcia i publiczne kolekcje sprawdzamy przed publikacją w sposób opisany w ust. 4–6; wstępne sprawdzenie nie stanowi potwierdzenia pełnej zgodności treści z prawem. Pozostałe treści (np. zgłoszenia) widzą tylko adresaci.

## Rozdział 8. Zgłaszanie treści bezprawnych i moderacja

1. Każdy, także osoba bez konta, może zgłosić treść, którą uważa za bezprawną albo niezgodną z regulaminem, za pomocą formularza zgłoszeniowego w serwisie (po jego uruchomieniu) albo wysyłając wiadomość e-mail na adres ${ADDRESS.reports} (gotowy szablon wiadomości otwiera odnośnik „Zgłoś naruszenie” przy miejscu). Zgłoszenie powinno zawierać:
   1. wskazanie treści oraz jej dokładną lokalizację elektroniczną, w szczególności adres URL strony miejsca i opis zdjęcia lub fragmentu tekstu (art. 16 ust. 2 lit. b rozporządzenia (UE) 2022/2065);
   2. wyjaśnienie, dlaczego treść jest bezprawna albo niezgodna z regulaminem;
   3. imię i nazwisko oraz adres e-mail zgłaszającego — z wyjątkiem zgłoszeń dotyczących przestępstw, o których mowa w art. 3–7 dyrektywy 2011/93/UE (m.in. wykorzystywanie seksualne dzieci);
   4. oświadczenie, że zgłaszający działa w dobrej wierze, a informacje w zgłoszeniu są prawdziwe i kompletne.
2. Niezwłocznie potwierdzimy automatycznie otrzymanie zgłoszenia (e-mailem zwrotnym lub komunikatem z formularza) i rozpatrzymy je bez zbędnej zwłoki, zwykle w ciągu 14 dni. O decyzji i o możliwości odwołania poinformujemy zgłaszającego.
3. Treść bezprawną albo niezgodną z regulaminem możemy ukryć albo usunąć, a w przypadkach opisanych w rozdziale 4 ust. 7 — zablokować konto. Decyzje o treściach i kontach podejmujemy my albo kurator kolekcji, której dotyczy treść. Podejmują je ludzie; nie stosujemy do tego automatycznych narzędzi.
4. Autora treści informujemy o decyzji. Wskazujemy, co zrobiliśmy, na podstawie jakich faktów, czy uznaliśmy, że treść narusza prawo (i jaki przepis), czy regulamin (i które postanowienie), oraz jak może się odwołać (rozdział 9), wnieść skargę do koordynatora do spraw usług cyfrowych albo dochodzić swoich praw przed sądem.
5. Jeśli dowiemy się o treści, która wskazuje na przestępstwo zagrażające życiu lub bezpieczeństwu osób, niezwłocznie zawiadomimy policję albo prokuraturę.
6. Pojedynczym punktem kontaktowym, o którym mowa w art. 11 i 12 rozporządzenia (UE) 2022/2065 (akt o usługach cyfrowych), dla organów państw członkowskich, Komisji Europejskiej, Rady Usług Cyfrowych oraz odbiorców usługi jest adres ${ADDRESS.general}. Porozumiewamy się po polsku i po angielsku.

## Rozdział 9. Reklamacje i odwołania

1. Reklamację dotyczącą działania serwisu albo odwołanie od decyzji w sprawie treści lub konta możesz złożyć na adres ${ADDRESS.complaints} w ciągu 6 miesięcy od decyzji.
2. Opisz, czego dotyczy reklamacja albo odwołanie, i podaj adres e-mail przypisany do konta (jeśli je masz).
3. Odpowiemy e-mailem w ciągu 14 dni od otrzymania reklamacji albo odwołania.
4. Odwołanie od decyzji kuratora rozpatrujemy my. Odwołanie od naszej decyzji rozpatrujemy ponownie, biorąc pod uwagę Twoje argumenty. Jeśli uznamy odwołanie, cofniemy decyzję (np. przywrócimy treść albo odblokujemy konto).
5. Złożenie reklamacji albo odwołania nie ogranicza Twojego prawa do wniesienia skargi do koordynatora do spraw usług cyfrowych (Prezesa Urzędu Komunikacji Elektronicznej) na podstawie art. 53 rozporządzenia (UE) 2022/2065 ani do dochodzenia roszczeń przed sądem.

## Rozdział 10. Kuratorzy

1. Status organizacji kuratorskiej nadajemy organizacji albo osobie na jej prośbę, po upewnieniu się, że może rzetelnie prowadzić kolekcje. Prośbę składa się na adres ${ADDRESS.partners}, a po uruchomieniu — także wnioskiem „Zostań kuratorem” w serwisie (potrzebne jest konto). Odmowę krótko uzasadniamy; nie mamy obowiązku nadania statusu.
2. Osoba, która prosi o status w imieniu organizacji, oświadcza, że jest do tego upoważniona. Stroną umowy w zakresie tego rozdziału jest organizacja kuratorska.
3. Członków zespołu dodajemy na prośbę organizacji kuratorskiej. Członek zespołu musi mieć konto w serwisie. Organizacja kuratorska odpowiada za to, dla kogo prosi o dostęp (oraz za poinformowanie kandydata o przekazaniu nam jego danych w celu nadania dostępu), i niezwłocznie zgłasza nam osoby, które przestały z nią współpracować; odbierzemy im dostęp.
4. Wspólne prowadzenie kolekcji przez kilka organizacji kuratorskich wymaga uzgodnienia z nami.
5. Organizacja kuratorska zapewnia, że ona i członkowie jej zespołu:
   1. dbają o rzetelność opisów, współrzędnych i informacji o dostępności miejsc, w tym ostrzegają o miejscach niebezpiecznych, prywatnych albo czasowo niedostępnych;
   2. nie ustalają punktu potwierdzenia wizyty na terenie prywatnym ani w miejscu niebezpiecznym;
   3. publikują tylko teksty i zdjęcia, do których mają prawa, a przy zdjęciach na licencjach Creative Commons podają autora, tytuł, źródło i licencję;
   4. rozpatrują zdjęcia i zgłoszenia odkrywców bez zbędnej zwłoki, a zdjęcia odrzucają wyłącznie z powodów wymienionych w rozdziale 7 ust. 5;
   5. wykorzystują dane odkrywców (imię, inicjał nazwiska, zdjęcia, treść zgłoszeń) wyłącznie do prowadzenia kolekcji w serwisie, zachowują je w poufności, nie kopiują ich poza serwis i niezwłocznie informują nas o podejrzeniu ich wycieku;
   6. w aktualnościach nie publikują reklamy politycznej w rozumieniu rozporządzenia (UE) 2024/900, agitacji wyborczej ani treści sponsorowanych przez osoby trzecie; informację o własnym wydarzeniu płatnym kurator oznacza wyraźnie jako informację handlową, podając organizatora i cenę.
6. Organizacja kuratorska udziela nam niewyłącznej, nieodpłatnej licencji na wyświetlanie w serwisie tekstów i zdjęć, które dodaje do kolekcji, bez ograniczeń terytorialnych i na czas nieokreślony. Licencja obejmuje utrwalanie i zwielokrotnianie tych materiałów techniką cyfrową, ich publiczne udostępnianie w serwisie, w podglądach linków do serwisu i w wynikach wyszukiwarek oraz dostosowanie do wymagań technicznych (zmiana rozmiaru, formatu i kadru — bez zniekształcania treści; w tym zakresie organizacja kuratorska zobowiązuje się nie wykonywać nadzoru autorskiego w rozumieniu art. 60 ustawy o prawie autorskim i prawach pokrewnych oraz zapewnia, że nie będą go wykonywać twórcy tych materiałów). Przy materiałach podajemy organizację kuratorską jako autora albo źródło. Organizacja kuratorska może wypowiedzieć licencję z zachowaniem 2-letniego okresu wypowiedzenia ze skutkiem na koniec roku kalendarzowego.
7. Organizacja kuratorska może w każdej chwili zrezygnować ze statusu. Możemy go odebrać, jeśli organizacja kuratorska narusza regulamin; wcześniej wezwiemy ją do usunięcia naruszenia, chyba że naruszenie jest rażące. Po utracie statusu kolekcje organizacji kuratorskiej przestają być widoczne w serwisie. Możemy je ponownie udostępnić na podstawie licencji z ust. 6, z informacją, że ich autorem jest ta organizacja, ale bez wskazywania jej jako opiekuna kolekcji. Organizacja kuratorska może poprosić o usunięcie swojego logo i nazwy z opisu kolekcji.
8. Wydarzenie organizuje kurator. Jeśli z wydarzeniem wiążą się nagrody, kurator ogłasza osobny regulamin wydarzenia i odpowiada za jego zgodność z prawem. Nagrody nie mogą zależeć od przypadku (zakaz organizowania loterii i konkursów losowych). Ten ustęp nie ma zastosowania do czasu uruchomienia w serwisie wydarzeń.
9. Zasady powierzenia przetwarzania danych osobowych organizacji kuratorskiej określa [umowa powierzenia](/umowa-powierzenia) stanowiąca załącznik nr 2 do regulaminu.

## Rozdział 11. Nasze prawa do serwisu, dane z otwartych źródeł i zastrzeżenie TDM

1. Serwis, jego wygląd, kod i nazwa są chronione prawem. Korzystanie z serwisu nie daje Ci do nich żadnych praw poza prawem do korzystania z serwisu zgodnie z regulaminem.
2. Część danych o miejscach pochodzi z otwartych źródeł, m.in. z OpenStreetMap (© autorzy OpenStreetMap, licencja ODbL), Wikidanych, Wikimedia Commons i rejestrów publicznych (w tym rejestru zabytków Narodowego Instytutu Dziedzictwa). Źródło, czas pozyskania i licencję podajemy przy danych albo zdjęciu oraz na stronie „Źródła danych”. Część opisów składamy ze wzorów zdań, do których wstawiamy dane z rejestrów i otwartych źródeł. Opisy miejsc przygotowuje redakcja serwisu na podstawie źródeł wymienionych na stronie „Źródła danych”, korzystając z narzędzi, w tym ze sztucznej inteligencji. Redakcja na bieżąco przegląda i poprawia opisy, także po zgłoszeniach odkrywców.
3. Usługodawca (w odniesieniu do bazy danych serwisu i własnych utworów) oraz twórcy zdjęć i tekstów publikowanych w serwisie wyraźnie zastrzegają brak zgody na zwielokrotnianie i pobieranie zawartości serwisu w celu eksploracji tekstów i danych (TDM), w szczególności w celu trenowania, rozwijania lub testowania modeli sztucznej inteligencji (art. 26³ ustawy z 4 lutego 1994 r. o prawie autorskim i prawach pokrewnych oraz art. 4 ust. 3 dyrektywy (UE) 2019/790). Zastrzeżenie to nie ogranicza uprawnień wynikających z odrębnych licencji otwartych dla warstw danych pochodzących z takich źródeł (np. OpenStreetMap, Wikimedia Commons).

## Rozdział 12. Odpowiedzialność

1. Dokładamy starań, żeby serwis działał bez przerw i błędów, ale nie możemy tego zagwarantować. Serwis może być czasowo niedostępny, np. podczas prac technicznych.
2. Nie odpowiadamy za bezprawne treści użytkowników i kuratorów, jeśli nie mamy faktycznej wiedzy o bezprawnej działalności lub bezprawnych treściach, a z chwilą uzyskania takiej wiedzy lub wiadomości niezwłocznie podejmujemy działania w celu usunięcia lub uniemożliwienia dostępu do tych treści (art. 6 rozporządzenia (UE) 2022/2065).
3. Nie odpowiadamy za stan, dostępność i bezpieczeństwo miejsc, których nie jesteśmy właścicielem ani zarządcą.
4. Za szkody wyrządzone z naszej winy odpowiadamy na zasadach ogólnych. Postanowienia tego rozdziału nie ograniczają odpowiedzialności, której nie można ograniczyć na podstawie przepisów prawa.

## Rozdział 13. Dane osobowe

Zasady przetwarzania danych osobowych opisuje [polityka prywatności](/polityka-prywatnosci), dostępna pod adresem https://krajozbior.pl/polityka-prywatnosci.

## Rozdział 14. Zmiany regulaminu

1. Możemy zmienić regulamin wyłącznie z następujących przyczyn:
   1. zmiana przepisów prawa albo wydanie decyzji, orzeczenia lub zalecenia przez sąd lub organ, które dotyczą serwisu;
   2. wprowadzenie nowych funkcji, zmiana lub wycofanie dotychczasowych funkcji serwisu;
   3. potrzeba zapobiegania nadużyciom albo zapewnienia bezpieczeństwa użytkowników i serwisu;
   4. zmiana danych kontaktowych albo usługodawcy;
   5. poprawienie oczywistych błędów, niejasności albo literówek.
2. O zmianie poinformujemy e-mailem i w serwisie co najmniej 14 dni przed jej wejściem w życie. Przekażemy nowy regulamin i wskażemy, co się zmienia.
3. Jeśli nie akceptujesz zmian, możesz przed ich wejściem w życie wypowiedzieć umowę, usuwając konto albo pisząc do nas.

## Rozdział 15. Zakończenie działania serwisu

1. O zamiarze zakończenia działania serwisu poinformujemy e-mailem i w serwisie co najmniej 30 dni wcześniej.
2. W tym czasie możesz poprosić o kopię swoich danych. Dane usuniemy w ciągu 30 dni od zakończenia działania serwisu (a z kopii zapasowych po upływie kolejnych 30 dni), z wyjątkiem danych niezbędnych do ustalenia, dochodzenia lub obrony przed roszczeniami na zasadach opisanych w polityce prywatności.
3. Zakończenie działania serwisu rozwiązuje umowę.

## Rozdział 16. Postanowienia końcowe

1. Regulamin jest dostępny bezpłatnie w serwisie w formie, którą można pobrać, zapisać i wydrukować. Poprzednie wersje regulaminu udostępniamy w serwisie.
2. W sprawach nieuregulowanych w regulaminie stosuje się prawo polskie. Wybór prawa nie pozbawia konsumenta ochrony, jaką zapewniają mu bezwzględnie obowiązujące przepisy państwa, w którym ma miejsce zwykłego pobytu.
3. Regulamin obowiązuje od 28 listopada 2026 r.

## Załącznik nr 1

[Oświadczenie o prawach do zdjęcia i licencja](/oswiadczenie-o-zdjeciach) (osobny dokument; w serwisie pod adresem https://krajozbior.pl/oswiadczenie-o-zdjeciach).

## Załącznik nr 2

[Umowa powierzenia przetwarzania danych osobowych](/umowa-powierzenia) (organizacja kuratorska).
`;
