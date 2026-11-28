// Najważniejsze zasady: streszczenie regulaminu i polityki prywatności prostym językiem
// (wersja 1.1, obowiązuje od 28 listopada 2026 r.). Test w tests/features/legal/legal-content.test.ts
// pilnuje braku znaczników roboczych.
import { CONTACT_ADDRESSES as ADDRESS } from "../domain/legal-pages";

export const ZASADY = `
To streszczenie regulaminu i polityki prywatności napisane prostym językiem. Nie zastępuje regulaminu ani polityki prywatności; w razie rozbieżności rozstrzygają regulamin i polityka prywatności.

## Dla każdego, także bez konta

- **Krajozbiór jest bezpłatny.** Nie ma reklam ani płatnych funkcji.
- **Bez konta** możesz oglądać kolekcje, miejsca, mapę i aktualności. Poza danymi technicznymi, które przeglądarka wysyła do serwera (np. adres IP), nie zbieramy wtedy o Tobie żadnych danych — chyba że napiszesz do nas wiadomość e-mail albo wyślesz zgłoszenie treści (wtedy przetwarzamy dane z tej korespondencji). Przy zdjęciach miejsc z Wikimedia Commons pokazujemy też imię, nazwisko lub pseudonim ich autora zgodnie z licencją. Jeśli zmienisz wygląd serwisu, zapamiętamy go w pliku cookie. Dane techniczne usuwamy po 14 dniach.
- **Nasz serwer i kopie zapasowe są w Niemczech.**
- **Mapa** pochodzi z OpenStreetMap. Gdy wybierzesz widok „Mapa”, Twoja przeglądarka łączy się z serwerami OpenStreetMap i przekazuje im Twój adres IP. Lista miejsc działa bez tego.
- **Nie śledzimy Cię.** Nie używamy narzędzi analitycznych ani reklamowych. W przeglądarce zapisujemy tylko to, co niezbędne: pliki cookies logowania (także adres e-mail na 10 minut między krokami logowania), wyglądu i szkicu profilu oraz, do zamknięcia karty, informację o zamkniętym pasku informacyjnym.
- **Opisy miejsc** powstają z faktów podanych w źródłach, które wymieniamy na stronie „Źródła danych”. Część składamy ze wzorów zdań, do których wstawiamy dane z rejestrów i otwartych źródeł; każdy opis przed publikacją czyta i poprawia człowiek — redakcja serwisu.
- **Widzisz treść niezgodną z prawem albo z regulaminem?** Napisz na adres ${ADDRESS.reports}, podaj dokładny adres URL miejsca, opisz treść i podaj swoje imię, nazwisko oraz adres e-mail (wyjątek dla zgłoszeń anonimowych w najpoważniejszych sprawach opisuje rozdział 8 regulaminu).
- **Odwiedzaj miejsca rozważnie.** Nie wchodź na teren prywatny ani ogrodzony i uważaj w ruinach oraz na wieżach. Do potwierdzenia wizyty wystarczy, że będziesz w pobliżu.

## Gdy masz konto

- **Konto** może założyć osoba, która ma co najmniej 16 lat. Konto powstaje, gdy wpiszesz kod wysłany na Twój e-mail; korzystasz z niego po akceptacji regulaminu. Jeśli klikniesz odmowę akceptacji regulaminu, Twój adres e-mail usuwamy od razu; jeśli nie dokończysz zakładania konta, usuniemy go automatycznie po 7 dniach. Logujesz się kodem, który wysyłamy na Twój e-mail. Nikomu go nie przekazuj — my nigdy o niego nie prosimy.
- **Nie zapisujemy współrzędnych telefonu.** Przy potwierdzaniu wizyty pozycja trafia do nas tylko na chwilę: sprawdzamy odległość i od razu odrzucamy pozycję. Zapisujemy samą wizytę: miejsce, datę i godzinę.
- **Twoich wizyt nie pokazujemy innym.** Wyjątki dotyczą funkcji, które uruchomimy wkrótce: jeśli podpiszesz zdjęcie, każdy zobaczy przy nim Twoje imię i inicjał nazwiska, a więc także Twoją wizytę w tym miejscu; inni zalogowani odkrywcy zobaczą Twoje imię, inicjał nazwiska, województwo i liczby w profilu tylko wtedy, gdy ustawisz profil jako widoczny.
- **Kuratorzy** kolekcji widzą Twoje imię i inicjał nazwiska (bez adresu e-mail) przy zgłoszeniach problemów z miejscem, które do nich wyślesz. Przy zdjęciach zobaczą je, gdy uruchomimy dodawanie zdjęć (wkrótce).
- **Zdjęcia** (wkrótce — dla osób od 18 lat): po wizycie dodasz własne zdjęcia miejsca. Usuwamy z nich współrzędne GPS. Inni zobaczą zdjęcie dopiero po akceptacji kuratora. Domyślnie zdjęcie jest bez podpisu; podpis włączasz samodzielnie. Prawa do zdjęcia zostają przy Tobie. Pozwalasz nam pokazywać je w Krajozbiorze (także w podglądach linków i w wynikach wyszukiwarek), a w materiałach promocyjnych tylko wtedy, gdy osobno się na to zgodzisz.
- **Własne kolekcje** są prywatne: widzisz je tylko Ty. Kolekcję będzie można oznaczyć jako publiczną (wkrótce — dla osób od 18 lat); inni zobaczą ją wtedy po naszej akceptacji.
- **Wizyty z przeszłości** zaznaczaj tylko dla miejsc naprawdę odwiedzonych.
- **Usunięcie konta** w ustawieniach działa od razu: znikają Twoje dane, w tym wizyty, kolekcje i zdjęcia (z wyjątkiem materiałów objętych toczącym się postępowaniem w sprawie naruszenia lub dowodów akceptacji regulaminu przy blokadzie konta). Z kopii zapasowych dane znikną po 30 dniach. W dzienniku operacji (zapisach o ważnych czynnościach, przechowywanych 12 miesięcy) zostaje tylko wewnętrzny numer konta, bez e-maila i imienia.
- **Kopię swoich danych** dostaniesz, gdy napiszesz na adres ${ADDRESS.privacy}. W innych sprawach pisz na ${ADDRESS.general}. W sprawach danych osobowych odpowiadamy zwykle w ciągu miesiąca, a reklamacje wysłane na ${ADDRESS.complaints} rozpatrujemy w ciągu 14 dni.
- **O zmianach** regulaminu i polityki prywatności napiszemy do Ciebie co najmniej 14 dni wcześniej.
- **O zakończeniu działania serwisu** napiszemy co najmniej 30 dni wcześniej; w tym czasie możesz poprosić o kopię swoich danych. Dane usuniemy w ciągu 30 dni od zamknięcia serwisu.

## Gdzie znaleźć szczegóły

- [Regulamin](/regulamin) (https://krajozbior.pl/regulamin)
- [Polityka prywatności](/polityka-prywatnosci) (https://krajozbior.pl/polityka-prywatnosci)
- [Oświadczenie o prawach do zdjęcia i licencja](/oswiadczenie-o-zdjeciach) (https://krajozbior.pl/oswiadczenie-o-zdjeciach)
`;
