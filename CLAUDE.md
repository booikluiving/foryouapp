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
