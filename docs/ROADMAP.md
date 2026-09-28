# Yapper — plan rozwoju i wydań

Status: w realizacji, PR-y oczekujące na review. Aktualizacja: 2026-09-28.

## 1. Cel i granice projektu

Yapper to samodzielnie hostowany komunikator dla społeczności: trwały czat, kanały głosowe, a następnie wideo, udostępnianie ekranu i natywne klienty. Początkowo rozwijany przez jedną osobę dla małych grup.

Produkt nie narzuca sztucznych limitów liczby użytkowników. Administrator zarządza limitami zasobów. Rzeczywista pojemność zależy od sprzętu, łącza, konfiguracji i charakteru obciążenia; każde wydanie opisuje zakres faktycznie sprawdzony w testach. Skalowanie jednej instancji jest pierwszym celem. Instalacja wielowęzłowa wymaga osobnego projektu po wykazaniu potrzeby pomiarami.

Docelowy zestaw technologii:

| Obszar | Technologia / decyzja |
| --- | --- |
| Landing page i dokumentacja | Astro |
| Aplikacja webowa | React, TypeScript, Tailwind CSS, shadcn/ui z Base UI |
| Jakość kodu AUTH i frontendu (JS/TS) | Oxc: Oxlint do lintowania i Oxfmt do formatowania |
| Reguły design systemu | `@shadcn/lint` jako plugin Oxlint dla komponentów UI |
| Windows i Linux | Electron, współdzielony interfejs z webem |
| iOS, iPadOS, macOS | Swift i SwiftUI |
| Android | Kotlin i Jetpack Compose |
| Terminal | Rust i Ratatui; GPUI jest biblioteką GUI i nie należy do zakresu TUI |
| Logika serwera | Go, modularny monolit |
| Dane trwałe | PostgreSQL |
| Komunikacja aplikacji | HTTP API i WebSocket |
| Media | WebRTC, osobny SFU; self-hosted LiveKit jako kandydat do weryfikacji w fazie 3 |
| Wdrożenie | Docker i Docker Compose |
| Publikacja | GitHub Releases oraz obrazy na Docker Hub |

Założenia pierwszych wydań: niezależne instancje, lokalne konta, wiele zapisanych serwerów w kliencie, brak obowiązkowej centralnej usługi Yapper. Federacja, globalna tożsamość, marketplace botów i pełna zgodność funkcjonalna z Discordem pozostają poza tym planem. Szyfrowanie transportu jest wymagane; E2EE nie jest domyślną obietnicą i wymaga oddzielnego projektu.

### Standard jakości AUTH i frontendu

Przyjmujemy ekosystem **Oxc: Oxlint + Oxfmt** dla kodu JavaScript/TypeScript aplikacji webowej, Electrona, obsługiwanych plików landingu Astro i współdzielonych pakietów. Zakres AUTH obejmuje kliencką obsługę sesji, logowania, zaproszeń oraz formularze uwierzytelniania. Backend AUTH pozostaje w Go i korzysta z narzędzi Go; Oxc nie zastępuje jego kontroli jakości ani testów autoryzacji.

- **Oxlint** sprawdza kod JS/TS, w tym React i obsługę AUTH, według wspólnej konfiguracji repozytorium.
- **Oxfmt** odpowiada za formatowanie obsługiwanych plików. Konfiguracja i wykluczenia są współdzielone, a wersje narzędzi przypięte w zależnościach i lockfile.
- **`@shadcn/lint`** (projekt `shadcn-ui/lint`) działa jako plugin Oxlint dla UI z Tailwind. Konfigurujemy reguły używania komponentów, wariantów i tokenów design systemu, również na ekranach AUTH. Zakres reguł UI nie obejmuje niezwiązanego z interfejsem kodu sesji ani procesu głównego Electrona. Integrację planujemy dla Tailwind CSS v4 zgodnie z dokumentacją pluginu.
- **Typecheck** pozostaje osobną kontrolą TypeScript; poprawny lint i format nie zastępują sprawdzania typów.

Wspólne skrypty: `lint` uruchamia Oxlint wraz z regułami `@shadcn/lint`, `lint:fix` udostępnia poprawki lokalnie, `format` uruchamia Oxfmt w trybie zapisu, `format:check` sprawdza format bez zmian plików, a `typecheck` sprawdza typy. CI wymaga przejścia `lint`, `format:check` i `typecheck` dla właściwych pakietów przed Squash & Merge. Zmiana wspólnej konfiguracji uruchamia kontrole wszystkich objętych nią pakietów.

Przy wdrożeniu sprawdzamy zakres obsługi plików `.astro` przez przypięte wersje narzędzi. Brak obsługi dokumentujemy i uzupełniamy narzędziem właściwym dla Astro; pominiętych plików nie przedstawiamy jako sprawdzonych. Katalogi buildów, zależności i wygenerowane artefakty mają jawne wykluczenia.

## 2. Jednostki pracy: krok → etap → faza

| Jednostka | Znaczenie | Ślad w Git/GitHub |
| --- | --- | --- |
| Krok | Najmniejsza spójna, weryfikowalna zmiana | Zwykle jeden commit na branchu etapu |
| Etap | Jeden działający rezultat złożony z kilku kroków | Jeden branch, jeden PR i jeden commit po Squash & Merge do `main` |
| Faza | Zestaw etapów dostarczający konkretną zdolność produktu | Milestone, tag wersji, GitHub Release i obrazy Docker |

Identyfikatory: `F01` — faza, `F01-E01` — etap, `F01-E01-K01` — krok. Identyfikatory pozostają stałe także po zmianie kolejności prac.

Krok powinien obejmować jedną zmianę zachowania wraz z potrzebną weryfikacją. Jeśli wymaga kilku niezależnych zmian, rozbijamy go przed implementacją na kolejne numerowane kroki. Nie łączymy połowy backendu i całego klienta w jeden commit tylko po to, aby zachować pierwotną liczbę kroków. Drobna korekta po review może być osobnym commitem w tym samym etapie.

### Tryb realizacji tej serii (2026-09-28)

Na polecenie właściciela etapy F01–F05 realizujemy jako serię zależnych PR-ów. Pierwszy PR wskazuje `main`, następny branch powstaje z poprzedniego brancha i jego PR wskazuje poprzedni branch jako bazę. Publikujemy PR-y bez merge, auto-merge, tagów i publicznych wydań. Kroki można oznaczyć jako wykonane po weryfikacji; etap pozostaje gotowy do review. Faza może być przygotowana, ale nie jest zmergowana ani wydana. Po akceptacji właściciel integruje serię przez Squash & Merge, aktualizując bazy kolejnych PR-ów. Ta zasada ma pierwszeństwo przed standardowym cyklem poniżej.

### Cykl etapu

1. Z aktualnego `main` tworzymy branch o krótkiej nazwie wynikającej z planowanego tytułu commita kończącego etap, np. `chore/setup-repository` lub `feat/implement-auth`.
2. Realizujemy kolejne kroki, sprawdzamy ich działanie i tworzymy commity, np. `feat(server): add readiness endpoint [F01-E02-K02]`.
3. Oznaczamy wykonane kroki jako `[x]` w tym dokumencie. Wszystkie kroki gotowe oznaczają etap **gotowy do review**, a nie jeszcze zakończony.
4. Otwieramy PR z tytułem przeznaczonym na końcowy commit, np. `feat(server): implement health checks`. Identyfikator etapu, np. `F01-E02`, zapisujemy w opisie PR. Draft PR można otworzyć wcześniej.
5. PR opisuje rezultat, sposób sprawdzenia, zmiany konfiguracji/migracje i ograniczenia. Poprawiamy uwagi oraz wyniki CI.
6. Po review i zielonym CI wykonujemy **Squash & Merge**, sprawdzając tytuł wynikowego commita. W projekcie jednoosobowym review oznacza również własne przejrzenie pełnego diffu.
7. Dopiero Squash & Merge zamyka etap. Zapisujemy numer PR i SHA wynikowego commita w rejestrze. Następny branch powstaje z nowego `main`.

Metoda integracji etapów: **Squash & Merge**. Commity kroków służą do pracy i review na branchu; na `main` cały etap jest reprezentowany przez jeden spójny commit. Powiązanie z krokami zachowujemy w checkliście i opisie PR. Nie używamy merge commitów do integracji etapów ani nie utrzymujemy długowiecznego brancha `develop` czy osobnego brancha na całą fazę.

### Nazwy branchy i tytuły commitów kończących etapy

Branche nie zawierają słowa `codex`, niezależnie od wielkości liter. Nazwa opisuje zmianę, a nie narzędzie lub autora.

Format brancha: `<typ>/<krótki-opis-kebab-case>`. Typ odpowiada rodzajowi zmiany, np. `feat`, `fix`, `refactor`, `docs`, `chore` lub `ci`. Opis jest skrótem tematu końcowego commita Squash & Merge: pomijamy scope, znaki interpunkcyjne i zbędne słowa, zachowując sens zmiany.

| Branch | Tytuł PR i końcowego commita Squash & Merge |
| --- | --- |
| `feat/implement-auth` | `feat(auth): implement authentication and sessions` |
| `feat/implement-health-checks` | `feat(server): implement health checks` |
| `feat/implement-stage1` | `feat: implement stage 1 of voice support` |
| `fix/restore-voice-connection` | `fix(voice): restore connection after network loss` |
| `chore/setup-repository` | `chore: set up repository structure and development commands` |
| `docs/update-roadmap` | `docs: update project roadmap` |

Preferujemy opis funkcji, np. `implement-auth`, zamiast samego numeru etapu. Nazwa z numerem, np. `implement-stage1`, jest dopuszczalna, gdy tytuł i opis PR jednoznacznie wskazują zakres. Identyfikatory fazy/etapu pozostają w opisie PR i rejestrze postępu; nie są wymagane w nazwie brancha. Przed Squash & Merge aktualizujemy tytuł PR do ostatecznego zakresu zmiany i używamy go jako tytułu wynikowego commita.

### Warunki zakończenia etapu

- Wszystkie zaplanowane kroki wykonano lub jawnie przeniesiono do innego etapu z uzasadnieniem.
- Spełniono warunek odbioru etapu podany poniżej.
- Przeszły właściwe dla zmiany kontrole: kompilacja, lint/typecheck oraz testy istotnego zachowania. Zmiana dokumentacji nie wymaga budowania wszystkich klientów.
- Dla AUTH i frontendu w JS/TS przeszły Oxlint, Oxfmt w trybie sprawdzania oraz typecheck; komponenty UI spełniają skonfigurowane reguły `@shadcn/lint`.
- Zmiany danych mają migrację i opis odzyskania sprawnej instalacji; zmiany API mają aktualny kontrakt.
- PR został zmergowany do `main` i powiązany z fazą.

### Warunki zakończenia fazy

- Wszystkie jej etapy, włącznie z przygotowaniem wydania, zostały zmergowane.
- Przeszedł scenariusz odbioru fazy na zbudowanych artefaktach.
- Opublikowano tag, GitHub Release i wszystkie obrazy wymagane w tej fazie.
- Sprawdzono pobranie artefaktów i uruchomienie Compose z opublikowanych obrazów.
- Dopiero wtedy faza otrzymuje status **Wydana** i zamykamy milestone.

Nie zamykamy fazy tylko dlatego, że wszystkie PR-y są zmergowane. Status **Gotowa do wydania** odróżnia ukończony kod od działającej dystrybucji.

## 3. Wersjonowanie i publikacja

### Polityka wersji

Wersja produktu ma postać `MAJOR.MINOR.PATCH`. Fazy 1–9 mają planowane wersje `0.1.0`–`0.9.0`, faza 10 — `1.0.0`. To harmonogram wydań projektu, nie ogólna zasada SemVer, że numer fazy musi odpowiadać numerowi wersji.

- Przed `1.0.0` API jest rozwojowe. Zmiany niekompatybilne opisujemy wraz z migracją i zakresem wspieranych klientów; nie przemycamy ich w poprawkach PATCH.
- Poprawki między fazami: np. `0.4.1`. Nie wymagają zamykania kolejnej fazy.
- Kandydaci: np. `0.4.0-rc.1`. GitHub oznacza ich jako pre-release.
- Po `1.0.0`: PATCH dla kompatybilnych poprawek, MINOR dla kompatybilnych funkcji, MAJOR dla zmian łamiących zadeklarowany kontrakt publiczny.
- Wydanej wersji nigdy nie podmieniamy. Poprawka kodu oznacza nową wersję.

Tag Git ma prefiks `v`, np. `v0.4.0`; tag obrazu nie ma prefiksu, np. `0.4.0`. Główny plik `VERSION` przechowuje wersję produktu, a automatyzacja sprawdza zgodność manifestów pakietów i metadanych artefaktów. Numery buildów sklepów mobilnych są oddzielne od wersji produktu.

Wydanie dotyczy całego produktu. Przyszłe klienty nie blokują wcześniejszych faz. Po dodaniu danego klienta release zawiera jego artefakt lub jawnie wskazuje ostatnią kompatybilną wersję, jeśli klient nie wymaga nowego wydania. Numer wersji protokołu jest osobnym kontraktem, nie kopią numeru aplikacji.

### Artefakty

`<dockerhub-namespace>` to miejsce na nazwę konta lub organizacji; zostanie ustalone przy konfiguracji publikacji.

| Artefakt | Nazwa / miejsce |
| --- | --- |
| Serwer Go | `<dockerhub-namespace>/yapper-server:0.4.0` |
| Aplikacja webowa | `<dockerhub-namespace>/yapper-web:0.4.0` |
| Landing page | Statyczny build Astro; nie jest wymaganą usługą każdej instancji |
| Zestaw wdrożeniowy | `compose.yaml`, przykładowa konfiguracja, instrukcja i sumy kontrolne w GitHub Release |
| Desktop od fazy 4 | Paczki Windows/Linux w GitHub Release, z listą sprawdzonych systemów i architektur |
| Apple od fazy 6 | Artefakty/dystrybucja odpowiednie dla platformy; GitHub Release opisuje kanał i dostępność |
| Android od fazy 7 | APK w GitHub Release; publikacja sklepowa jest osobnym kanałem |
| TUI od fazy 8 | Binarne paczki dla zadeklarowanych systemów i architektur |

PostgreSQL i serwer mediów pozostają obrazami upstream przypiętymi do sprawdzonych wersji lub digestów. Nie nadajemy im numeru Yapper i nie publikujemy ich ponownie jako własnego oprogramowania.

Obrazy aplikacji otrzymują dokładny tag wydania oraz tag identyfikujący commit, np. `sha-<commit>`. Dokładne tagi wersji są niezmienne zgodnie z polityką projektu; konfigurację ochrony tagów w Docker Hub sprawdzamy przy wdrożeniu publikacji. Ruchomy alias `latest` wprowadzamy dopiero dla wydań stabilnych od `1.0.0`; instalacje produkcyjne przypinają dokładną wersję, najlepiej digest.

### Procedura wydania każdej fazy

1. Ostatni etap fazy przygotowuje wersję, changelog, manifest artefaktów i dokumentację aktualizacji w PR-ze.
2. Po merge CI sprawdza dokładny commit kandydata, w tym instalację oraz — od drugiej wersji — aktualizację z poprzedniego wspieranego wydania.
3. Tworzymy tag `vX.Y.Z` wskazujący ten commit. Workflow z tagu buduje artefakty, publikuje obrazy i przygotowuje draft GitHub Release.
4. Manifest wydania zapisuje commit, digests obrazów, sumy kontrolne plików i wspierane wersje klientów/protokołu.
5. Z publicznie dostępnych obrazów wykonujemy smoke test Compose. Po sukcesie publikujemy GitHub Release i aktualizujemy właściwe aliasy obrazów.
6. Zamykamy fazę i milestone; wpisujemy link do release w rejestrze w następnym PR-ze dokumentacyjnym lub pierwszym PR-ze kolejnej fazy. Taki wpis administracyjny nie wymaga nowego wydania produktu.

Publikacje GitHub i Docker Hub nie są jedną transakcją. W razie częściowego niepowodzenia faza pozostaje **Gotowa do wydania**: wznawiamy brakujący krok dla tego samego SHA i zachowujemy już opublikowane artefakty. Jeśli trzeba zmienić kod, wydajemy nowy numer zamiast przepinać tag. Nie ogłaszamy kompletnego release przed weryfikacją wszystkich wymaganych artefaktów.

Hotfix do ostatniego wydania powstaje w osobnym branchu i PR-ze. Gdy `main` zawiera już kolejną fazę, poprawkę przygotowujemy na branchu utrzymaniowym z tagu wydania, publikujemy PATCH i przenosimy poprawkę do `main`. Nie wydajemy przypadkiem niedokończonych funkcji razem z hotfixem.

## 4. Mapa faz

Każda faza ma pięć etapów. Każdy etap jest osobnym PR-em integrowanym przez Squash & Merge, a każdy punkt `Kxx` kandydatem na pojedynczy commit na branchu tego etapu. Szczegóły odległych faz doprecyzowujemy przed ich rozpoczęciem; nie zmieniamy kryteriów odbioru po fakcie, aby ukryć brakujący zakres.

| Faza | Wersja | Rezultat | Zależność | Status |
| --- | --- | --- | --- | --- |
| F01 | 0.1.0 | Uruchamialny szkielet i działające wydawanie | — | Planowana |
| F02 | 0.2.0 | Trwały czat z kontami i uprawnieniami | F01 | Planowana |
| F03 | 0.3.0 | Niezawodne kanały głosowe w webie | F02 | Planowana |
| F04 | 0.4.0 | MVP dla grup: web i Electron | F03 | Planowana |
| F05 | 0.5.0 | Załączniki, wyszukiwanie i screen sharing | F04 | Planowana |
| F06 | 0.6.0 | Natywne klienty Apple | F05 | Planowana |
| F07 | 0.7.0 | Natywny klient Android | F06 | Planowana |
| F08 | 0.8.0 | Klient terminalowy | F07 | Planowana |
| F09 | 0.9.0 | Zmierzona pojemność i odporność operacyjna | F08 | Planowana |
| F10 | 1.0.0 | Stabilny kontrakt i zweryfikowana dystrybucja | F09 | Planowana |

MVP kończy się na F04. Kolejność platform po MVP można zmienić według potrzeb użytkowników; Android i TUI nie mają technicznej zależności od SwiftUI. W tabeli zależność oznacza domyślną kolejność pracy jednej osoby.

## F01 — Fundament i pierwsze wydanie `0.1.0`

Cel: świeża instalacja uruchamia szkielet serwera i webu, a proces publikacji działa od początku.

### F01-E01 — Repozytorium i decyzje techniczne

- [x] K01: Zapisać krótkie decyzje architektoniczne: niezależne instancje, modularny monolit, granica aplikacja/media i zakres MVP.
- [x] K02: Utworzyć strukturę `apps/web`, `apps/desktop`, `apps/landing`, `server`, `deploy`, `docs` oraz komendy developerskie dla istniejących komponentów.
- [x] K03: Dodać szablon PR, zasady branchy/commitów i rejestr etapów powiązany z tym planem.

Odbiór: nowy developer potrafi znaleźć komponenty i uruchomić udokumentowane komendy. Puste przyszłe klienty nie dostają pozornej implementacji.

### F01-E02 — Minimalny serwer Go

- [x] K01: Dodać uruchamianie serwera HTTP z walidowaną konfiguracją środowiskową.
- [x] K02: Dodać endpointy wersji, liveness i readiness z rozróżnieniem stanu procesu i zależności.
- [x] K03: Dodać logi strukturalne, identyfikator żądania i kontrolowane zamykanie procesu.

Odbiór: proces startuje z poprawną konfiguracją, raportuje wersję i zamyka się bez urywania obsługiwanych żądań w zadanym limicie czasu.

### F01-E03 — Web i landing page

- [x] K01: Uruchomić aplikację React/TypeScript z Tailwind i shadcn/ui opartym o Base UI.
- [x] K02: Dodać ekran połączenia ze wskazaną instancją oraz odczyt jej wersji i stanu.
- [x] K03: Utworzyć landing Astro z opisem projektu i odnośnikiem do instrukcji self-hostingu.
- [x] K04: Dodać Oxlint, wspólną konfigurację i skrypty `lint`/`lint:fix` dla istniejącego kodu JS/TS.
- [x] K05: Dodać Oxfmt, wspólną konfigurację i skrypty `format`/`format:check`, dokumentując zakres obsługi Astro.
- [x] K06: Podłączyć `@shadcn/lint` do Oxlint i skonfigurować reguły komponentów oraz tokenów design systemu dla UI z Tailwind v4.

Odbiór: web pokazuje rzeczywisty stan serwera, błąd połączenia jest czytelny, a landing buduje się niezależnie. Skrypty lintowania, formatowania i sprawdzania typów działają lokalnie; kontrolowana próba naruszenia reguły UI potwierdza, że plugin jest aktywny.

### F01-E04 — Lokalne wdrożenie i CI

- [x] K01: Dodać obrazy serwera i webu uruchamiane bez uprawnień roota tam, gdzie to możliwe.
- [x] K02: Dodać Compose z PostgreSQL, healthcheckami, trwałym wolumenem i przykładową konfiguracją bez sekretów.
- [x] K03: Dodać CI budujące zmienione komponenty i wykonujące smoke test Compose oraz dokumentację TLS/portów.
- [x] K04: Dodać wymagane kontrole CI: Oxlint z `@shadcn/lint`, Oxfmt w trybie sprawdzania i typecheck dla właściwych pakietów; zmiany wspólnej konfiguracji sprawdzają wszystkie objęte pakiety.

Odbiór: czysty checkout można uruchomić według README, a restart kontenerów zachowuje wolumen danych.

### F01-E05 — Automatyzacja pierwszego wydania

- [x] K01: Dodać `VERSION`, changelog i workflow publikacji z tagu, z uprawnieniami ograniczonymi do potrzeb wydania.
- [x] K02: Dodać manifest artefaktów, sumy kontrolne, metadane commitów oraz kontrolę niepodmieniania wersji.
- [x] K03: Przygotować instrukcję instalacji `0.1.0` i scenariusz testu opublikowanych obrazów.

Odbiór fazy: po merge i przejściu procedury wydania użytkownik pobiera Compose z GitHub Release i uruchamia obrazy z Docker Hub. Konto/namespace i poświadczenia publikacji są wymaganymi zależnościami tego etapu.

## F02 — Konta i trwały czat `0.2.0`

Cel: dwie osoby mogą dołączyć do instancji, pisać i odzyskać historię po ponownym połączeniu.

### F02-E01 — Model danych i kontrakt

- [x] K01: Dodać mechanizm migracji oraz tabele użytkowników, kanałów i wiadomości.
- [x] K02: Opisać kontrakt HTTP, wspólny format błędów i stronicowanie historii kursorem.
- [x] K03: Zdefiniować wersjonowaną kopertę zdarzeń WebSocket z identyfikatorem zdarzenia i walidacją danych.

Odbiór: migracje działają na pustej bazie, a kontrakt ma przykłady poprawnych i odrzuconych żądań.

### F02-E02 — Konta i sesje

- [x] K01: Dodać jednorazowy bootstrap administratora bez domyślnego publicznego hasła.
- [x] K02: Dodać logowanie z bezpiecznym hashowaniem haseł i ograniczeniem prób.
- [x] K03: Dodać sesje, wylogowanie/unieważnianie i wygasające zaproszenia do rejestracji.

Odbiór: wygasła sesja i zużyte zaproszenie są odrzucane; sekrety nie trafiają do logów. Kod kliencki AUTH w JS/TS podlega Oxlint, Oxfmt i typecheck, a jego formularze również regułom `@shadcn/lint`. Testy backendu Go osobno weryfikują zachowanie uwierzytelniania i sesji.

### F02-E03 — Kanały i wiadomości

- [x] K01: Dodać tworzenie i listowanie kanałów tekstowych w API.
- [x] K02: Dodać zapis i stronicowany odczyt wiadomości z kluczem idempotencji dla ponawiania wysyłki.
- [x] K03: Dodać widok kanału, historii oraz stan wysyłania/błędu wiadomości w webie.

Odbiór: ponowiona wysyłka nie duplikuje wiadomości, a historia pozostaje po restarcie serwera.

### F02-E04 — Realtime i podstawowe uprawnienia

- [x] K01: Dodać autoryzowane subskrypcje kanałów i dostarczanie nowych wiadomości przez WebSocket.
- [x] K02: Dodać reconnect z ponowną synchronizacją przez historię i eliminacją duplikatów.
- [x] K03: Dodać role administrator/członek, ograniczenie dostępu do kanałów i testy odmowy dostępu po HTTP oraz WebSocket.

Odbiór: utrata sieci nie gubi historii, a użytkownik bez dostępu nie może ani pobrać, ani subskrybować chronionego kanału.

### F02-E05 — Wydanie czatu

- [x] K01: Dodać scenariusz integracyjny: zaproszenie → logowanie → wiadomość → reconnect.
- [x] K02: Opisać i sprawdzić backup/restore bazy oraz aktualizację z `0.1.0`.
- [x] K03: Przygotować wersję `0.2.0`, changelog i manifest zgodnie z procedurą wydania.

Odbiór fazy: dwie osoby prowadzą czat na świeżej instancji i po jej aktualizacji; odtworzona baza zawiera konta oraz wiadomości.

## F03 — Kanały głosowe `0.3.0`

Cel: działające rozmowy grupowe przez Internet oraz odzyskiwanie połączenia po przerwie sieciowej.

### F03-E01 — Weryfikacja i wdrożenie serwera mediów

- [x] K01: Wykonać minimalny spike dwóch klientów WebRTC i zapisać wybór SFU, warunki licencji oraz ograniczenia SDK dla planowanych platform, w tym Rust.
- [x] K02: Dodać wybrany serwer mediów do Compose z przypiętą wersją i konfiguracją sekretów.
- [x] K03: Dodać instrukcję publicznych adresów, TLS, UDP i TURN oraz scenariusz połączenia przez relay.

Odbiór: dwie osoby w różnych sieciach słyszą się, a wymuszona ścieżka TURN jest sprawdzona. Dokument wskazuje zależności potrzebne do późniejszych klientów natywnych.

### F03-E02 — Autoryzacja kanałów głosowych

- [x] K01: Dodać model kanału głosowego i mapowanie na pokój mediów.
- [x] K02: Dodać wydawanie krótkotrwałych tokenów pokoju po serwerowej kontroli uprawnień.
- [x] K03: Dodać usuwanie uczestnika z pokoju po odebraniu dostępu i uzgadnianie listy uczestników ze stanem SFU.

Odbiór: klient nie może sam nadać sobie dostępu do pokoju ani pozostać w nim po skutecznym usunięciu.

### F03-E03 — Rozmowa w aplikacji webowej

- [ ] K01: Dodać wejście/wyjście z kanału oraz obsługę zgody na mikrofon.
- [ ] K02: Dodać mute/deafen, wybór dostępnych urządzeń i czytelne błędy ograniczeń przeglądarki.
- [ ] K03: Dodać wskaźnik mówienia i push-to-talk działający przy aktywnej aplikacji webowej.

Odbiór: użytkownik świadomie steruje transmisją i odtwarzaniem; web nie obiecuje globalnego skrótu poza aktywną aplikacją.

### F03-E04 — Odporność rozmowy

- [ ] K01: Dodać stan reconnect i ponowne dołączenie po zmianie lub utracie sieci.
- [ ] K02: Dodać reakcję na odłączenie mikrofonu/słuchawek oraz zmianę uprawnień urządzeń.
- [ ] K03: Dodać ograniczone kolejki zdarzeń obecności i usuwanie nieaktualnych sesji.

Odbiór: powrót sieci i wymiana urządzenia nie wymagają odświeżenia całej aplikacji; nie zostają fikcyjni uczestnicy.

### F03-E05 — Wydanie głosowe

- [ ] K01: Dodać powtarzalny scenariusz testów głosu: różne sieci, TURN, reconnect i odebranie dostępu.
- [ ] K02: Zapisać bazowy pomiar CPU, RAM i transferu dla rozmów na kilku kanałach wraz z konfiguracją sprzętu.
- [ ] K03: Przygotować `0.3.0`, instrukcję aktualizacji i opis sprawdzonych przeglądarek.

Odbiór fazy: mała grupa prowadzi dłuższą rozmowę, a wynik testu, czas trwania i zaobserwowane ograniczenia są zapisane w raporcie wydania.

## F04 — Electron i MVP dla grup `0.4.0`

Cel: pierwsza wersja używana na co dzień przez pilotażową grupę.

### F04-E01 — Powłoka desktopowa

- [ ] K01: Dodać Electron korzystający ze współdzielonego interfejsu webowego.
- [ ] K02: Dodać minimalne typowane IPC, izolację kontekstu i kontrolę otwierania linków zewnętrznych.
- [ ] K03: Dodać paczki developerskie Windows i Linux oraz uruchomieniowe smoke testy.

Odbiór: oba systemy uruchamiają aplikację, a renderer nie ma nieograniczonego dostępu do Node/systemu.

### F04-E02 — Integracja desktopowa z głosem

- [ ] K01: Dodać konfigurowalny globalny push-to-talk z wykrywaniem niedostępności i konfliktu skrótu.
- [ ] K02: Dodać tray oraz jawne zachowanie zamknięcia okna podczas rozmowy.
- [ ] K03: Sprawdzić Windows oraz zadeklarowane środowiska Linux, w tym różnice X11/Wayland, i wdrożyć czytelny fallback.

Odbiór: użytkownik rozumie, czy mikrofon nadal działa po zamknięciu okna; ograniczenia globalnych skrótów są widoczne w aplikacji.

### F04-E03 — Wiele serwerów i moderacja

- [ ] K01: Dodać zapisaną listę serwerów i izolację sesji/danych między instancjami.
- [ ] K02: Dodać rolę moderatora, usuwanie wiadomości i blokowanie konta egzekwowane po stronie serwera.
- [ ] K03: Dodać interfejs zarządzania zaproszeniami, kanałami i podstawowymi rolami.

Odbiór: przełączenie instancji nie wysyła jej tokenów do innego hosta, a ban kończy aktywny dostęp do czatu i głosu.

### F04-E04 — Codzienna obsługa instancji

- [ ] K01: Dodać prosty panel stanu usług, wersji i wykorzystania miejsca na dane.
- [ ] K02: Dodać komendę/procedurę backupu i odtworzenia całego ówczesnego stanu instancji.
- [ ] K03: Dodać procedurę aktualizacji z oknem przerwy i odzyskania poprzedniego stanu z backupu, gdy migracja uniemożliwia downgrade.

Odbiór: administrator przechodzi instrukcję instalacji, backupu, aktualizacji i odtworzenia bez ręcznego poprawiania bazy.

### F04-E05 — Wydanie MVP

- [ ] K01: Przeprowadzić pilotaż na Windows i Linux; zapisać wyniki oraz naprawić blokery w osobnych krokach dodanych do etapu.
- [ ] K02: Dodać desktopowe artefakty i sumy kontrolne do procesu publikacji; opisać status podpisywania paczek.
- [ ] K03: Przygotować `0.4.0`, instrukcję dla użytkownika i landing opisujący faktycznie dostępną wersję.

Odbiór fazy: grupa samodzielnie instaluje klienty i serwer oraz używa czatu/głosu podczas pełnej sesji. To koniec MVP, nie koniec projektu.

## F05 — Bogatsza komunikacja `0.5.0`

Cel: wygodniejszy czat i współdzielenie treści.

### F05-E01 — Załączniki

- [ ] K01: Dodać lokalny magazyn plików z konfigurowalnym limitem rozmiaru i zajętości.
- [ ] K02: Dodać upload oraz autoryzowane pobieranie, z walidacją i bez wykonywania aktywnej treści w kontekście aplikacji.
- [ ] K03: Dodać załączniki w web/desktop i uwzględnić pliki w backupie oraz sprzątaniu osieroconych danych.

Odbiór: plik z prywatnego kanału nie jest publiczny przez odgadnięcie adresu; restore odtwarza powiązania i pliki.

### F05-E02 — Wyszukiwanie i stan wiadomości

- [ ] K01: Dodać wyszukiwanie historii w PostgreSQL z filtrowaniem według uprawnień.
- [ ] K02: Dodać edycję wiadomości z autoryzacją autora/moderatora i zdarzeniem aktualizacji.
- [ ] K03: Dodać ostatnio przeczytaną wiadomość i liczniki nieprzeczytanych synchronizowane między sesjami.

Odbiór: wyniki wyszukiwania nie ujawniają niedostępnych kanałów, a reconnect odtwarza aktualny stan wiadomości.

### F05-E03 — Udostępnianie ekranu

- [ ] K01: Dodać publikowanie i odbieranie ścieżki ekranu w webie z jawnym rozpoczęciem/zatrzymaniem.
- [ ] K02: Dodać wybór źródła w Electronie i obsługę odmowy dostępu na wspieranych systemach.
- [ ] K03: Dodać limity jakości/liczby transmisji i udokumentować dostępność udostępniania dźwięku systemowego.

Odbiór: użytkownik wybiera źródło, odbiorca widzi transmisję, a zakończenie udostępniania zwalnia zasoby. Audio systemowe nie jest obiecywane na nieweryfikowanych platformach.

### F05-E04 — Kamera i sterowanie mediami

- [ ] K01: Dodać dobrowolne włączenie/wyłączenie kamery i wybór urządzenia.
- [ ] K02: Dodać układ uczestników i subskrybowanie widocznych transmisji zgodnie z możliwościami SFU.
- [ ] K03: Dodać serwerowe ograniczenia publikowania mediów i reakcję UI na słabe połączenie.

Odbiór: kamera i ekran działają razem z głosem, a administrator może ograniczyć zużycie zasobów.

### F05-E05 — Wydanie multimedialne

- [ ] K01: Sprawdzić uprawnienia do załączników/wyszukiwania i aktualizację z `0.4.x`.
- [ ] K02: Zmierzyć transfer i obciążenie dla głosu, kamery i ekranu; opisać scenariusze oddzielnie.
- [ ] K03: Przygotować `0.5.0`, rozszerzony backup i macierz możliwości web/desktop.

Odbiór fazy: wdrożenie przechodzi cały scenariusz czat → plik → wyszukiwanie → rozmowa → ekran/kamera.

## F06 — Apple: iOS, iPadOS i macOS `0.6.0`

Cel: natywny czat i głos na platformach Apple. Pierwsze wydanie nie wymaga pełnego parytetu multimediów z desktopem.

### F06-E01 — Wspólna warstwa klienta Swift

- [ ] K01: Utworzyć współdzielony pakiet modeli, konfiguracji serwerów i klienta HTTP.
- [ ] K02: Dodać przechowywanie sesji w Keychain i izolację kont per instancja.
- [ ] K03: Dodać WebSocket, reconnect i test zgodności z kontraktem serwera.

Odbiór: klient Swift loguje się, odbiera zdarzenia i odzyskuje stan bez zależności od widoków.

### F06-E02 — Natywny czat

- [ ] K01: Dodać listę serwerów/kanałów i ekran logowania w SwiftUI.
- [ ] K02: Dodać historię, wysyłanie wiadomości i stany błędu.
- [ ] K03: Dodać adaptacyjny układ iPhone/iPad/macOS oraz obsługę klawiatury i podstaw dostępności.

Odbiór: te same scenariusze czatu działają na wszystkich trzech platformach z właściwą nawigacją.

### F06-E03 — Głos i cykl życia

- [ ] K01: Zintegrować SDK mediów i autoryzowane wejście/wyjście z kanału.
- [ ] K02: Dodać mute, wybór/zmianę trasy audio i obsługę przerwań rozmowy przez system.
- [ ] K03: Obsłużyć tło, zmianę Wi-Fi/sieci komórkowej oraz skróty rozmowy tam, gdzie system na to pozwala.

Odbiór: testy na fizycznych urządzeniach potwierdzają zachowanie audio i reconnect; ograniczenia tła są opisane.

### F06-E04 — Powiadomienia i dystrybucja Apple

- [ ] K01: Zapisać decyzję o APNs, uprawnieniach i ewentualnym opcjonalnym relayu, z opisem przekazywanych danych i właściciela poświadczeń.
- [ ] K02: Zaimplementować uzgodniony minimalny tryb powiadomień; wyraźnie pokazać ograniczenia bez push w tle.
- [ ] K03: Skonfigurować podpisywanie i kanały testowe iOS/iPadOS oraz dystrybucję macOS, dokumentując wymagane konta i certyfikaty.

Odbiór: podstawowe połączenie z własnym serwerem nie wymaga centralnej usługi Yapper; dostępność powiadomień i dystrybucji jest jawna. Brak kont/certyfikatów jest zależnością do rozwiązania, nie ukończoną funkcją.

### F06-E05 — Wydanie Apple

- [ ] K01: Przejść scenariusz czatu/głosu na iPhonie, iPadzie i Macu oraz zapisać wersje systemów.
- [ ] K02: Dodać macierz parytetu funkcji, instrukcję instalacji i odnośniki do dostępnych kanałów dystrybucji.
- [ ] K03: Przygotować `0.6.0` z weryfikacją zgodności istniejących klientów web/desktop.

Odbiór fazy: wszystkie zadeklarowane platformy Apple mają działający, dostępny dla grupy testowej build; release rozróżnia dystrybucję testową i publiczną.

## F07 — Android `0.7.0`

Cel: natywny czat i głos na telefonach oraz tabletach Android.

### F07-E01 — Warstwa klienta Kotlin

- [ ] K01: Utworzyć aplikację oraz modele i klienta HTTP zgodnego z kontraktem.
- [ ] K02: Dodać sesje izolowane per instancja i przechowywanie sekretów z wykorzystaniem mechanizmów platformy.
- [ ] K03: Dodać WebSocket, reconnect i test zgodności zdarzeń.

Odbiór: warstwa danych odtwarza stan po ponownym połączeniu i nie miesza danych serwerów.

### F07-E02 — Interfejs Jetpack Compose

- [ ] K01: Dodać logowanie, listę serwerów i kanałów.
- [ ] K02: Dodać historię i wysyłanie wiadomości ze stanami błędów.
- [ ] K03: Dodać układ tabletowy, obsługę klawiatury i podstaw dostępności.

Odbiór: czat jest użyteczny na telefonie i tablecie, również po odtworzeniu aktywności.

### F07-E03 — Rozmowa i działanie w tle

- [ ] K01: Dodać SDK mediów oraz dołączanie do kanału z kontrolą uprawnień mikrofonu.
- [ ] K02: Dodać obsługę trwającej rozmowy przez właściwy mechanizm systemowy z widocznym stanem i zakończeniem.
- [ ] K03: Dodać reakcję na audio focus, Bluetooth, zmianę sieci i przerwania systemowe.

Odbiór: rozmowa przechodzi test na fizycznym urządzeniu z wygaszonym ekranem i po zmianie sieci.

### F07-E04 — Powiadomienia i paczki

- [ ] K01: Zapisać decyzję o push, w tym zachowanie bez usług Google i relację do infrastruktury z F06.
- [ ] K02: Dodać uzgodniony tryb powiadomień i czytelne zachowanie przy braku uprawnień/usługi push.
- [ ] K03: Dodać podpisany build APK oraz udokumentować utrzymanie klucza i aktualizacje aplikacji.

Odbiór: APK można zainstalować i zaktualizować z zachowaniem danych; dostępność push nie jest utożsamiana z dostępnością samego czatu.

### F07-E05 — Wydanie Android

- [ ] K01: Przeprowadzić testy telefonu/tabletu, tła i zgodności z pozostałymi klientami.
- [ ] K02: Dodać APK i jego sumę kontrolną do artefaktów oraz zaktualizować macierz funkcji.
- [ ] K03: Przygotować `0.7.0` i instrukcję instalacji/aktualizacji Androida.

Odbiór fazy: użytkownik dołącza do tej samej rozmowy z Androida, Apple, webu i desktopu.

## F08 — Klient terminalowy `0.8.0`

Cel: sprawny klient tekstowy Rust/Ratatui. Głos w terminalu wymaga osobnej decyzji po spike; nie blokuje bazowego wydania TUI.

### F08-E01 — Protokół i sesje w Rust

- [ ] K01: Utworzyć klienta HTTP i modele zgodne z kontraktem.
- [ ] K02: Dodać profile serwerów i bezpieczne przechowywanie sesji z opisanym fallbackiem dla systemów bez keyringa.
- [ ] K03: Dodać odbiór zdarzeń i synchronizację po reconnect.

Odbiór: klient testowy pobiera historię i odbiera nowe wiadomości ze zwykłej instancji.

### F08-E02 — Interfejs Ratatui

- [ ] K01: Dodać nawigację serwer → kanał → historia za pomocą klawiatury.
- [ ] K02: Dodać edycję/wysyłanie wiadomości i widoczne błędy połączenia.
- [ ] K03: Dodać obsługę zmiany rozmiaru terminala, Unicode i bezpiecznego wyświetlania niezaufanej treści bez sekwencji sterujących.

Odbiór: wiadomość od innego użytkownika nie steruje terminalem, a zmiana rozmiaru nie psuje nawigacji.

### F08-E03 — Codzienna praca

- [ ] K01: Dodać nieprzeczytane wiadomości i wyszukiwanie z istniejącego API.
- [ ] K02: Dodać jawne otwieranie linków/pobieranie załączników z poszanowaniem uprawnień.
- [ ] K03: Dodać pomoc skrótów, konfigurację i poprawne przywracanie terminala po wyjściu/błędzie.

Odbiór: użytkownik wykonuje podstawowy scenariusz czatu bez przechodzenia do aplikacji graficznej.

### F08-E04 — Ocena głosu i przenośność

- [ ] K01: Zweryfikować dostępność i koszt integracji Rust/WebRTC, urządzeń audio i wybranego SFU w małym prototypie.
- [ ] K02: Zapisać decyzję o głosie; jeśli odkładamy implementację, utworzyć osobny backlog i oznaczyć klienta jako tekstowy.
- [ ] K03: Dodać buildy i smoke testy dla zadeklarowanych systemów/architektur TUI.

Odbiór: zakres głosu jest rozstrzygnięty na podstawie prototypu, a paczki działają na wskazanych platformach. Decyzja o pełnej implementacji wymaga nowych, osobno rozpisanych etapów.

### F08-E05 — Wydanie TUI

- [ ] K01: Sprawdzić współpracę TUI z webem i klientami natywnymi oraz reconnect.
- [ ] K02: Dodać binaria, sumy kontrolne i instrukcję terminalową do procesu wydania.
- [ ] K03: Przygotować `0.8.0` oraz zaktualizować macierz możliwości klientów.

Odbiór fazy: TUI jest dostępne jako gotowa paczka i realizuje zadeklarowany zakres bez osobnego serwera/protokołu.

## F09 — Pojemność i odporność `0.9.0`

Cel: opisać zmierzone granice produktu i poprawić zachowanie przy rosnącym obciążeniu. Wcześniejsze fazy nadal odpowiadają za poprawność i podstawowe pomiary swoich funkcji.

### F09-E01 — Powtarzalne pomiary

- [ ] K01: Dodać metryki liczby połączeń, czasu zapisu/dostarczenia wiadomości, kolejek i błędów.
- [ ] K02: Dodać generator obciążenia czatu oraz profile: wiele małych kanałów i jeden duży kanał.
- [ ] K03: Dodać osobne scenariusze mediów z zapisem bitrate, utraty pakietów i zasobów SFU.

Odbiór: raport zawiera sprzęt, wersje, konfigurację, czas testu i scenariusz; liczba połączeń nie zastępuje pomiaru aktywnego ruchu.

### F09-E02 — Usuwanie zmierzonych wąskich gardeł

- [ ] K01: Na podstawie profilu poprawić zapytania/indeksy lub udokumentować, że nie są aktualnym ograniczeniem.
- [ ] K02: Na podstawie pomiarów poprawić rozsyłanie zdarzeń i odłączanie wolnych odbiorców z możliwością resynchronizacji.
- [ ] K03: Dodać konfigurowalne limity zasobów i czytelne odrzucanie ruchu po ich przekroczeniu.

Odbiór: porównanie przed/po pokazuje efekt zmian; przeciążenie nie powoduje nieograniczonego wzrostu pamięci.

### F09-E03 — Awarie i odzyskiwanie

- [ ] K01: Dodać scenariusze restartu backendu, niedostępności bazy i SFU.
- [ ] K02: Dodać scenariusze pełnego dysku i utraty sieci oraz poprawić błędne komunikaty/zachowania.
- [ ] K03: Przeprowadzić pełny restore na świeżym hoście i zmierzyć czas odzyskania oraz utratę danych wynikającą z wieku backupu.

Odbiór: awaria nie jest przedstawiana jako udany zapis, a instrukcja odtworzenia działa na niezależnej instalacji.

### F09-E04 — Profile self-hostingu

- [ ] K01: Udokumentować sprawdzony profil małej instancji z wymaganiami CPU/RAM/dysk/łącze.
- [ ] K02: Udokumentować konfigurację większej instancji i ewentualne przeniesienie mediów na osobny host, jeśli zostało sprawdzone.
- [ ] K03: Opisać retencję danych, monitoring i granice wsparcia pojedynczego serwera.

Odbiór: administrator dobiera konfigurację na podstawie pomiarów i rozumie, czego jeszcze nie zweryfikowano.

### F09-E05 — Wydanie po testach obciążeniowych

- [ ] K01: Wykonać długotrwały test na zadeklarowanym obciążeniu i zapisać zachowanie pamięci oraz błędów.
- [ ] K02: Opublikować raport pojemności z ograniczeniami i wynikami odzyskiwania po awarii.
- [ ] K03: Przygotować `0.9.0` z aktualizacją i testem regresji wspieranych klientów.

Odbiór fazy: istnieje odtwarzalny raport pojemności; projekt nie obiecuje nieograniczonej skali ani klastra bez testów.

## F10 — Stabilne wydanie `1.0.0`

Cel: stabilny, udokumentowany zakres produktu i przewidywalne aktualizacje. `1.0.0` nie oznacza pełnego zestawu funkcji Discorda.

### F10-E01 — Stabilny kontrakt publiczny

- [ ] K01: Określić publiczne API, zdarzenia, format konfiguracji i zasady kompatybilności objęte SemVer.
- [ ] K02: Dodać negocjację możliwości i czytelne odrzucanie niewspieranych wersji klientów.
- [ ] K03: Dodać testy deklarowanej macierzy zgodności, w tym starszego wspieranego klienta z nowym serwerem.

Odbiór: administrator i autor klienta znają okres/zakres wsparcia, a niekompatybilność nie kończy się cichym uszkodzeniem stanu.

### F10-E02 — Przegląd granic zaufania

- [ ] K01: Przejrzeć uwierzytelnianie, autoryzację, zaproszenia i odbieranie aktywnego dostępu we wszystkich transportach.
- [ ] K02: Przejrzeć uploady, renderowanie treści, IPC Electrona, przechowywanie sekretów i redakcję logów.
- [ ] K03: Rozwiązać blokujące ustalenia w osobnych krokach oraz opisać przyjmowanie zgłoszeń podatności i aktualizacje zależności.

Odbiór: ustalenia mają wynik i dowód poprawki albo jawnie zaakceptowane ograniczenie; nie ma nierozwiązanych blokerów wydania.

### F10-E03 — Instalacja i aktualizacje klientów

- [ ] K01: Sprawdzić i udokumentować podpisywanie dostępnych paczek oraz stan dystrybucji Apple/Android.
- [ ] K02: Dodać sprawdzanie dostępnej wersji desktop/TUI z jawną kontrolą użytkownika i zweryfikowanym źródłem artefaktów.
- [ ] K03: Sprawdzić aktualizację i odzyskanie sprawnej instalacji serwera oraz wspieranych klientów.

Odbiór: klient nie wymusza niekompatybilnej aktualizacji serwera, a każde wspierane środowisko ma udokumentowaną ścieżkę aktualizacji.

### F10-E04 — Dokumentacja stabilnego produktu

- [ ] K01: Uzupełnić dokumentację użytkownika, administratora i autora klienta.
- [ ] K02: Uporządkować landing, macierz funkcji/platform oraz znane ograniczenia.
- [ ] K03: Zamrozić zakres `1.0.0` i utworzyć backlog dalszych funkcji: federacja, boty, zaawansowane role, E2EE, klaster, ewentualny głos TUI.

Odbiór: każda publicznie obiecana funkcja ma implementację, instrukcję i wskazany zakres wsparcia.

### F10-E05 — Kandydat i wydanie stabilne

- [ ] K01: Przygotować `1.0.0-rc.1` i przejść kompletny scenariusz instalacji, użycia, aktualizacji i restore na opublikowanych artefaktach.
- [ ] K02: Zapisać wyniki pilotażu RC; poprawki i kolejne RC prowadzić przez nowe jawne kroki/PR-y, jeśli są potrzebne.
- [ ] K03: Przygotować `1.0.0`, końcowy changelog, manifest kompatybilności i publikację stabilnych aliasów po weryfikacji wydania.

Odbiór fazy: GitHub Release, obrazy Docker i wymagane klienty są dostępne, instalacja działa, a wszystkie deklarowane kryteria stabilności zostały spełnione.

## 5. Rejestr postępu

Statusy etapów: **Planowany → W realizacji → Gotowy do review → Zmergowany**. Statusy faz: **Planowana → W realizacji → Gotowa do wydania → Wydana**. **Zablokowany** wymaga opisu konkretnej zależności i warunku odblokowania.

Rejestr uzupełniamy wraz z realizacją. W GitHub faza odpowiada milestone; etap może mieć issue z checklistą kroków oraz powiązany PR. Issue etapu zamykamy przez merge, milestone przez ukończoną publikację.

| Etap | Branch | PR | SHA commita po Squash & Merge | Status |
| --- | --- | --- | --- | --- |
| F01-E01 | `chore/setup-repository` | — | — | Planowany |

| Faza | Tag | GitHub Release | Manifest/digests Docker | Data wydania |
| --- | --- | --- | --- | --- |
| F01 | `v0.1.0` — planowany | — | — | — |

Przy każdym rozpoczynanym etapie dopisujemy wiersz; nie traktujemy planowanych branchy/tagów jako istniejących zasobów. Lista kroków jest źródłem statusu implementacji, rejestr PR-ów — statusu integracji, a rejestr wydań — statusu dystrybucji.

## 6. Źródła zasad wydawania i narzędzi jakości

- [Semantic Versioning 2.0.0](https://semver.org/lang/pl/) — znaczenie numerów wersji i niezmienność wydanej wersji.
- [GitHub: About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) — wydania oparte o tagi i dystrybucja artefaktów.
- [Docker Hub: Immutable tags](https://docs.docker.com/docker-hub/repos/manage/hub-images/immutable-tags/) — konfiguracja ochrony przed podmienianiem tagów; dostępność i ustawienia weryfikujemy przy konfiguracji repozytorium obrazów.
- [Oxc: Getting Started](https://oxc.rs/docs/guide/introduction) — Oxlint i Oxfmt jako narzędzia lintowania i formatowania.
- [Oxfmt: Quickstart](https://oxc.rs/docs/guide/usage/formatter/quickstart) — konfiguracja i uruchamianie formattera.
- [shadcn-ui/lint](https://github.com/shadcn-ui/lint) — pakiet `@shadcn/lint`, integracja z Oxlint i reguły design systemu Tailwind.

Ten dokument jest planem. Nie tworzy branchy, PR-ów, milestone'ów ani wydań i nie oznacza żadnego kroku implementacyjnego jako wykonanego.
