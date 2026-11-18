# For_You-app: instructies voor Claude

## Eén app, geen versies

- Dit is de For_You-app. Er is één versie: wat op `main` staat.
- Gebruik de woorden legacy, V1 en V2 niet voor de app of onderdelen ervan: niet in gesprekken, documenten, paginatitels, URL's, bestands- of mapnamen, variabelen en code.
- Maak geen tweede versie van iets naast het bestaande. Pas het bestaande onderdeel aan. De vorige stand staat in de git-historie.
- Het team hoeft geen versies te kennen of te begrijpen.

Wat er bewust nog staat, en alleen op ja van Booi verandert omdat het opgeslagen showdata of TouchDesigner raakt:

- Velden en kolommen die met `legacy` beginnen (zoals `legacyId`, `legacy_id`, `legacySituationId`) en de waarde `legacy` bij paden. Dat zijn de oorspronkelijke nummers van personages, omgevingen en situaties; de data verwijst ernaar.
- Het voorvoegsel `/v0/` in de interne API-adressen en `-v0` in `shared/contracts`.
- Een tijdelijke doorverwijzing in `modules/audience/server/app.js` voor twee podiumpagina's, tot `show/td-qhub-test/apply_publiek_adres_patch.py` in TouchDesigner is gedraaid.

Niet van ons en dus ongemoeid: de teller in TouchDesigner-bestandsnamen (`v1.14.toe`) en `/control/api/v1` van de Blackmagic-camera's.

## Stream Deck

Elke knop volgt het ontwerpsysteem in `modules/show-control/hardware/streamdeck-control/companion/ONTWERP.md`: een vaste soort per knop, kleuren alleen uit `deck.json` → `ontwerp`. `deck.sh check` moet slagen. Op het echte deck alleen na een ja van Booi.

## TouchDesigner: één TD, de nieuwste versie

De waakhond `scripts/td-waakhond.sh` (LaunchAgent `nl.foryou.td-waakhond`) houdt precies één TouchDesigner open: de show-TD met het showbestand. Een leeg project, een tweede show-TD of een ander bestand gaat dicht.

- Welke versie geldt staat in `~/ForYou/td-versie.txt`. Werk altijd op die versie. Na het bewaren van een nieuwe versie staat hij er vanzelf in.
- Een andere TD (bijvoorbeeld de Greenscreen Lab) vraagt eerst toestemming: `scripts/td-waakhond.sh toestemming greenscreen 60 greenscreen-lab`. Klaar: `scripts/td-waakhond.sh klaar greenscreen`, dan gaat hij dicht. Een verlopen toestemming sluit hem ook.
- Logboek: `~/Library/Logs/ForYou/td-waakhond.log`. Test: `scripts/td-waakhond-test.sh`.

## Regie: één weg voor run en scènes

Starten, stoppen, klaarzetten, overslaan en reset van de run gaan alleen via show control (:3025). Nooit rechtstreeks naar de runtime (:3024) en nooit een eigen omweg. Show control doet ze één voor één en zet ook TouchDesigner, licht, microfoons en teleprompter.

- Stand staat op de regiepagina `http://<show-mac>:3025/regie/` en in `GET /v0/show-control/regie`: `show` (pad en publiek kiezen), `test` of `random` (één eigenaar).
- Een scène testen of bekijken: eerst de regie overnemen, met je eigen naam (bijvoorbeeld de naam van je sessie). Stuur bij elke vraag de kop `x-foryou-wie: <naam>` mee.
  - `POST /v0/show-control/regie/overnemen {"stand":"test"}`
  - `POST /v0/show-control/regie/laad {"situationId":"situation:96","start":true}` (zonder schrijven: het laatst bewaarde script; `"schrijven":true` laat het taalmodel schrijven)
  - `POST /v0/show-control/regie/stop`, `/start`, `/random`
  - Klaar: `POST /v0/show-control/regie/vrijgeven`. De scène stopt en de run gaat terug naar het begin.
- Heeft iemand anders de regie, dan krijg je 423 met de naam. Wacht, of vraag Booi. Neem nooit over met `forceer` zonder ja van Booi.
- De knoppen in de zaal (Stream Deck, klikker, ready van de spelers) werken altijd.
- Bewaker (in show control): kijkt om de paar seconden of TouchDesigner (fase) en de teleprompter (klaargezette scène) de runtime volgen en herstelt het; ziet een herstart van TouchDesigner aan de pid in `~/Library/Application Support/ForYouApp/td-show.json` (schrijft de TD-waakhond). Wat hij vond staat op de regiepagina onder Controle en in `GET /v0/show-control/regie` → `controle`.
- Proef zonder show: `node modules/show-control/tests/regie-proef.js` (pagina op :4325/regie/). Tests: `regie-test.js`, `bewaker-test.js` in `modules/show-control/tests`.
