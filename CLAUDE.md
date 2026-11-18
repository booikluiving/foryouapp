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
