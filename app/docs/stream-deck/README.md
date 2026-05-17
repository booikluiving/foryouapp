# Stream Deck / Companion on the Mac Studio

Deze map legt vast hoe de Elgato Stream Deck XL op de Mac Studio via Bitfocus Companion wordt beheerd.

Belangrijkste afspraak: **pagina 1 in Companion blijft beschermd**. Die pagina bevat bestaande OSC-knoppen die door Jilles zijn ingesteld. Nieuwe show-knoppen horen op pagina 2 of hoger.

Er is bewust precies een uitzondering gemaakt: pagina 1 rechtsonder is nu een page-switcher. De OSC-knop die daar stond is intact verplaatst naar pagina 2 linksonder.

## Context

- Machine: Mac Studio show-machine.
- Bereikbaarheid: via Tailscale en SSH, meestal via lokale SSH-alias `foryou-studio`.
- For You app op de Mac Studio: `http://127.0.0.1:3310`.
- For You adminpagina op de Mac Studio: `http://127.0.0.1:3310/admin`.
- Companion admin/web UI: luistert lokaal op de Mac Studio op `127.0.0.1:8008`.
- Companion config: `/Users/for_you/Library/Application Support/companion/v4.3/`.
- Companion database: `/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite`.
- Companion draait als app, met ingebouwde Node-runtime in:
  `/Applications/Companion.app/Contents/Resources/node-runtimes/node22/bin/node`.

Geen Tailscale-IP's, private keys of andere secrets horen in deze map.

## Backup

Voor de eerste wijziging is deze backup gemaakt:

```text
docs/stream-deck/backups/20260517-140603/
```

Inhoud:

- `db.sqlite`: Companion-configuratie, inclusief pages, controls, instances en surfaces.
- `cache.sqlite`: Companion-cache.
- `SHA256SUMS`: checksums van de twee backupbestanden.

De remote backup staat ook op de Mac Studio:

```text
/Users/for_you/ForYou/companion-backups/20260517-140603/
```

Voor nieuwe risicovolle wijzigingen: maak eerst weer een nieuwe backup en zet die desnoods naast deze map.

Voor de stap waarin de extra pagina-2-links zijn toegevoegd is ook een remote backup gemaakt:

```text
/Users/for_you/ForYou/companion-backups/20260517-144727-before-page2-links/
```

Voor de stap waarin de dynamische serverknop is toegevoegd:

```text
/Users/for_you/ForYou/companion-backups/20260517-150400-before-server-toggle/
```

Voor de stap waarin de server-herstartknop is toegevoegd:

```text
/Users/for_you/ForYou/companion-backups/20260517-151611-before-server-restart-button/
```

Voor de stap waarin de OSC-showknoppen op rij 3 zijn toegevoegd:

```text
/Users/for_you/ForYou/companion-backups/20260517-153522-before-osc-show-buttons/
```

Voor de stap waarin rij 3 is omgezet naar website-acties en situatieknoppen zijn toegevoegd:

```text
/Users/for_you/ForYou/companion-backups/20260517-154553-before-web-show-buttons/
```

Voor de compacte label/style-pass op pagina 2:

```text
/Users/for_you/ForYou/companion-backups/20260517-174248-before-compact-page2-labels/
```

Voor de stap waarin server-afhankelijke knoppen dynamisch dimmen bij server-uit:

```text
/Users/for_you/ForYou/companion-backups/20260517-175349-before-dynamic-dim-web-buttons/
```

Voor de stap waarin de statuspoll naar 1 seconde is gezet en interacties een pulse krijgen:

```text
/Users/for_you/ForYou/companion-backups/20260517-175916-before-fast-poll-and-pulse/
```

Voor de stap waarin de page-switchers zijn toegevoegd en de oude pagina-1-rechtsonder OSC-knop is verplaatst:

```text
/Users/for_you/ForYou/companion-backups/20260517-181239-before-page-switchers/
```

Voor de stap waarin `START SHOW`/`STOP SHOW` en `VOLGENDE SITUATIE`/`STOP SITUATIE` zijn samengevoegd tot twee dynamische knoppen:

```text
/Users/for_you/ForYou/companion-backups/20260517-182241-before-toggle-show-scene-buttons/
```

Voor de stap waarin de betekenis van `SITUATIE UIT` is aangescherpt:

```text
/Users/for_you/ForYou/companion-backups/20260517-183422-before-situatie-uit-semantics/
```

## Huidige Companion-status

- Pagina 1 is alleen op rij `3`, kolom `7` aangepast: die positie is nu een page-switcher.
- De OSC-knop die op pagina 1 rij `3`, kolom `7` stond is intact verplaatst naar pagina 2 rij `3`, kolom `0`.
- Alle bestaande control-values uit de oorspronkelijke backup bleven gelijk.
- Companion heeft nu 2 pagina's en 45 controls.
- Pagina 2 heet `FOR YOU`.
- Pagina 2 heeft op rij `0`, kolom `0` de dynamische serverknop en op kolom `1` de server-herstartknop.
- Pagina 2 heeft de paginalinks op rij `1`, kolommen `0` t/m `5`.
- Pagina 2 heeft de dynamische show- en situatieknoppen op rij `2`, kolommen `0` en `2`.
- Pagina 2 heeft op rij `3`, kolom `0` de verplaatste OSC-knop `osc1`.
- Pagina 1 en pagina 2 hebben rechtsonder een native Companion `pagedown` page-switcher.
- Er is een trigger `For You server status poll` die elke seconde de serverstatus leest, de serverknop bijwerkt en server-afhankelijke knoppen dimt wanneer de server uit staat.

Huidige pagina-2-knoppen:

| Rij | Kolom | Titel | Route/status | Actie |
| --- | --- | --- | --- | --- |
| 0 | 0 | `SERVER AAN` / `SERVER UIT` | `/health` | toggle launchd service |
| 0 | 1 | `SERVER HERSTART` | restart | stop, kill lingering port `3310` listeners, wait, start |
| 1 | 0 | `OPEN ADMIN` | `/admin` | `open http://127.0.0.1:3310/admin` |
| 1 | 1 | `ALGO RITME` | `/algoritme` | `open http://127.0.0.1:3310/algoritme` |
| 1 | 2 | `UNIVERSE` | `/universe` | `open http://127.0.0.1:3310/universe` |
| 1 | 3 | `PADEN` | `/paden` | `open http://127.0.0.1:3310/paden` |
| 1 | 4 | `API PLAY` | `/api-playground` | `open http://127.0.0.1:3310/api-playground` |
| 1 | 5 | `PUBLIEK CHAT` | `/` | `open http://127.0.0.1:3310/` |
| 2 | 0 | `START SHOW` / `STOP SHOW` | `session.isActive` | start of stop show via website endpoint |
| 2 | 2 | `VOLG. SITUATIE` / `STOP SITUATIE` / `SITUATIE UIT` | `activeRun` en `session.isActive` | start volgende situatie of stop actieve situatie |
| 3 | 0 | `osc1` | `/osc/osc32` | originele OSC-knop, verplaatst vanaf pagina 1 rechtsonder |
| 3 | 7 | Companion page-switcher | `pagedown` | wisselt bij de huidige twee pagina's naar de andere pagina |

Bij het toevoegen van de paginalinks op rij `1` zijn de routes eerst lokaal op de Mac Studio getest. Alle routes gaven HTTP `200`.

Als een toekomstige route niet actief is, maak de knop dan wel aan met de titel, maar:

- zet geen `exec` action op de knop;
- gebruik een gedimde stijl, bijvoorbeeld grijze tekst op zwarte achtergrond.

Dat benadert de gewenste 50%-opacity en voorkomt dat een inactieve knop toch iets opent.

## Page-switchers

Pagina 1 en pagina 2 hebben rechtsonder een native Companion `pagedown` control. Daarmee kan er op de Stream Deck zelf tussen de pagina's gewisseld worden.

In deze Companion-config gaat `pagedown` naar `-1` en wrapt hij. Met precies twee pagina's betekent dat: pagina 1 gaat naar pagina 2, en pagina 2 gaat terug naar pagina 1.

De oude pagina-1-rechtsonder OSC-knop is niet opnieuw opgebouwd, maar met `controls.moveControl` verplaatst naar pagina 2 linksonder. De JSON van die control is daarna vergeleken met de backup van vlak voor deze wijziging en was identiek.

Bestand op de Mac Studio:

```text
/Users/for_you/ForYou/companion-scripts/configure-page-switchers.js
```

Bronkopie in deze repo:

```text
docs/stream-deck/configure-page-switchers.js
```

## Server aan/uit knop

De serverknop gebruikt launchd, niet de admin `/admin/stop` route. Dat is belangrijk omdat de live showserver met `KeepAlive` draait; een gewone process-exit wordt anders automatisch opnieuw gestart.

Bestanden op de Mac Studio:

```text
/Users/for_you/ForYou/companion-scripts/foryou-server-toggle.sh
/Users/for_you/ForYou/companion-scripts/foryou-server-status-to-companion.js
/Users/for_you/ForYou/companion-scripts/configure-status-poll-interval.js
```

Bronkopieën in deze repo:

```text
docs/stream-deck/foryou-server-toggle.sh
docs/stream-deck/foryou-server-status-to-companion.js
docs/stream-deck/configure-status-poll-interval.js
```

Gedrag:

- Health OK op `http://127.0.0.1:3310/health`: knop is groen met `SERVER AAN`.
- Health niet OK: knop is rood met `SERVER UIT`.
- Klik op de knop:
  - als de server aan is: `launchctl bootout` van `nl.foryou.app`;
  - als de server uit is: `launchctl bootstrap`/`kickstart` van `nl.foryou.app`.
- Klik op `SERVER HERSTART`:
  - voert hetzelfde script uit met argument `restart`;
  - zet launchd uit;
  - ruimt eventuele resterende processen op die nog op poort `3310` luisteren;
  - wacht standaard 2 seconden;
  - start de launchd-service opnieuw.

De Companion trigger `For You server status poll` draait elke seconde:

```bash
/Applications/Companion.app/Contents/Resources/node-runtimes/node22/bin/node \
  /Users/for_you/ForYou/companion-scripts/foryou-server-status-to-companion.js \
  <server-button-control-id>
```

Dat script opent geen browser. Het leest alleen `/health` en zet via Companion tRPC de tekst/kleur van de serverknop.
De status wordt gecachet in:

```text
/Users/for_you/Library/Caches/ForYouApp/streamdeck-server-status.json
```

Daardoor worden de pagina-2 knoppen niet onnodig elke seconde herschreven. De paginalinks worden alleen bijgewerkt bij een serverstatus-wissel, bij een expliciete `--force`, of bij een pulse. De dynamische show/situatieknoppen worden ook bijgewerkt wanneer de app-state verandert.

Als de server uit staat, dimt hetzelfde script ook de web-afhankelijke knoppen op pagina 2:

- rij `1`, kolommen `0` t/m `5`: de pagina-links;
- rij `2`, kolommen `0` en `2`: show- en situatieknoppen.

Bij de paginalinks worden alleen `color` en `bgcolor` aangepast. Bij de twee dynamische show/situatieknoppen mag de statuspoll ook tekst en kleur aanpassen, zodat de knoppen hun actuele functie tonen.

Tijdens de korte feedback na een druk op de show- of situatieknop schrijft `foryou-web-button.js` een tijdelijke busy-marker naar:

```text
/Users/for_you/Library/Caches/ForYouApp/streamdeck-action-feedback.json
```

Zolang die marker actief is, laat de statuspoll de dynamische show/situatieknoppen met rust. Daardoor wordt `WACHT`, `SHOW GESTART` of `SIT. GESTOPT` niet meteen overschreven door de poll.

Bij een serverstatus-wissel geeft het script de server-afhankelijke knoppen kort een pulse en zet ze daarna naar de juiste actief/gedimde kleur.

Poll-interval opnieuw instellen:

```bash
ssh foryou-studio "/Applications/Companion.app/Contents/Resources/node-runtimes/node22/bin/node /Users/for_you/ForYou/companion-scripts/configure-status-poll-interval.js 1"
```

Veilige statuscheck zonder togglen:

```bash
ssh foryou-studio "/Users/for_you/ForYou/companion-scripts/foryou-server-toggle.sh status"
```

Herstart handmatig uitvoeren, alleen als je de live server bewust kort wilt onderbreken:

```bash
ssh foryou-studio "/Users/for_you/ForYou/companion-scripts/foryou-server-toggle.sh restart"
```

De Stream Deck herstartknop start deze restart op de achtergrond en schrijft output naar:

```text
/Users/for_you/Library/Logs/ForYouApp/streamdeck-restart.log
```

## Show- en situatieknoppen

De show- en situatiebediening staat op pagina 2, rij `2`:

- kolom `0`: een dynamische showknop, `START SHOW` of `STOP SHOW`;
- kolom `2`: een dynamische situatieknop, `VOLG. SITUATIE`, `STOP SITUATIE` of `SITUATIE UIT`.

Kolommen `1` en `3` zijn bewust leeg gemaakt.

Bestanden op de Mac Studio:

```text
/Users/for_you/ForYou/companion-scripts/foryou-web-button.js
/Users/for_you/ForYou/companion-scripts/configure-page2-show-buttons.js
/Users/for_you/ForYou/companion-scripts/style-page2-labels.js
```

Bronkopieen in deze repo:

```text
docs/stream-deck/foryou-web-button.js
docs/stream-deck/configure-page2-show-buttons.js
docs/stream-deck/style-page2-labels.js
```

Gedrag:

- De knoppen gebruiken de For You web/admin-endpoints op `http://127.0.0.1:3310`, niet de OSC receive-poort.
- Bij indrukken zet het script de ingedrukte knop eerst op `WACHT`.
- Daarna toont dezelfde knop kort het resultaat, bijvoorbeeld `SHOW GESTART`, `SHOW AL STIL`, `RUN GESTART`, `SITUATIE GESTART`, `SITUATIE GESTOPT` of `GEEN SITUATIE`.
- Na standaard 3,5 seconden valt de knop terug naar de actuele status/functie.
- De labels op pagina 2 gebruiken vaste tekstgroottes in plaats van `auto`, zodat woorden niet middenin afbreken in de Companion-preview.
- Bij indrukken geeft `foryou-web-button.js` alleen de ingedrukte knop kort een pulse, en toont daarna de feedback op diezelfde knop.
- De showknop leest `session.isActive` uit `/admin/algorithm/state`:
  - als de show uit staat: POST `/admin/show/start`;
  - als de show aan staat: POST `/admin/show/stop`.
- De situatieknop leest `session.isActive` en `activeRun` uit `/admin/algorithm/state`:
  - als de show uit staat: de knop toont `SITUATIE UIT`;
  - als er een actieve situatie loopt: POST `/admin/algorithm/runs/end`;
  - als er geen actieve situatie loopt en er een volgende situatie is: start de run of de up-next situatie;
  - als de show aan staat maar er geen volgende situatie meer is: de knop toont `SITUATIE UIT`;
  - als de app-state niet gelezen kan worden: de knop toont `SIT. ERROR`.
- `VOLG. SITUATIE` volgt de website-logica:
  - als de algoritme-run nog niet gestart is: POST `/admin/algorithm/runs/begin`;
  - als er geen actieve situatie is en er een up-next situatie klaarstaat: POST `/admin/algorithm/runs/start`;
  - als er geen volgende situatie klaarstaat: de knop toont `GEEN VOLGENDE`.

De show/situatieknoppen zijn niet met `controls.hotPressControl` getest, omdat dat de show of actuele situatie echt zou starten/stoppen. Wel geverifieerd:

- remote scripts laden met de Companion Node-runtime;
- de For You web/admin-state endpoint is bereikbaar;
- Companion-actions verwijzen naar de juiste control-id en `show-toggle`/`scene-toggle` argumenten;
- pagina 2 rij `2`, kolommen `1` en `3` zijn leeg;
- pagina 1 is alleen bewust gewijzigd op rechtsonder voor de page-switcher;
- originele control-values uit de oorspronkelijke backup zijn ongewijzigd.

## Companion API-aanpak

Gebruik bij voorkeur Companion's eigen tRPC API in plaats van direct in `db.sqlite` te schrijven. Dan houdt Companion zijn runtime-state en database zelf consistent.

De tRPC WebSocket endpoint is:

```text
ws://127.0.0.1:8008/trpc
```

Berichten hebben deze vorm:

```json
{
  "id": 1,
  "jsonrpc": "2.0",
  "method": "mutation",
  "params": {
    "path": "pages.insert",
    "input": {}
  }
}
```

Handige mutaties:

- `pages.insert` met `{ "asPageNumber": 2, "pageNames": ["FOR YOU"] }`
- `controls.resetControl` om een control op een locatie te verwijderen of maken.
- `controls.resetControl` met `{ "newType": "pagedown" }` om een native page-switcher te maken.
- `controls.moveControl` om een bestaande knop met behoud van configuratie te verplaatsen.
- `controls.setStyleFields` om knoptekst/kleur te zetten.
- `controls.entities.add` om een action toe te voegen.
- `controls.entities.setOption` om action-opties te vullen.
- `controls.hotPressControl` om een knop via Companion te testdrukken.
- Trigger-actions gebruiken entity location `trigger_actions`, niet `actions`.

Let op:

- `pageNumber` is 1-based.
- `row` en `column` zijn 0-based.
- `pages.insert` maakt automatisch navigatieknoppen aan op de nieuwe pagina. Als er echt maar een testknop moet staan, verwijder die navigatieknoppen daarna alleen op de nieuwe pagina met `controls.resetControl`.
- Voor de interne `exec` action moeten option values als expression-wrapper gezet worden:

```json
{
  "isExpression": false,
  "value": "open http://127.0.0.1:3310/admin"
}
```

Een kale string voor `controls.entities.setOption` wordt door Companion geweigerd.

## Testen

Voor testen zonder fysieke Stream Deck-druk kun je `controls.hotPressControl` gebruiken met de actuele `surfaceId`.

Lees de actuele surface-id eerst uit:

```bash
ssh foryou-studio "sqlite3 '/Users/for_you/Library/Application Support/companion/v4.3/db.sqlite' 'SELECT id, value FROM surfaces;'"
```

De eerste test gebruikte de surface-id:

```text
elgato-plugin:cb4bc85e4106
```

Testdrukken van `Open Admin` opent echt de adminpagina in de default browser op de Mac Studio. Doe dat dus bewust, anders stapelen browser-tabs of vensters zich op.

## Browser-tabs opruimen

De `Open Admin` knop gebruikt macOS `open`. Afhankelijk van de default browser opent dat een nieuw tabblad, hergebruikt het een bestaand tabblad, of opent het een venster.

Na herhaald testen: sluit alleen tabs/vensters met deze URL:

```text
http://127.0.0.1:3310/admin
```

Dat kan handmatig op de Mac Studio, of via AppleScript over SSH. Houd dit beperkt tot bekende browsers en sluit niet blind alle browserprocessen.

Voor Safari, Google Chrome, Brave Browser en Arc werkt deze aanpak meestal:

```bash
scp docs/stream-deck/close-admin-tabs.applescript foryou-studio:/tmp/close-admin-tabs.applescript
ssh foryou-studio "osascript /tmp/close-admin-tabs.applescript"
```

Als deze docs al op de Mac Studio zelf staan, kan het script ook direct vanaf de repo daar worden gestart.

## Terugzetten

Terugzetten is een noodactie. Stop Companion eerst, kopieer `db.sqlite` en `cache.sqlite` terug naar de Companion config-map, start Companion daarna opnieuw.

Doe dit alleen als duidelijk is dat de huidige Companion-config kapot is. In normale workflow: liever een nieuwe backup maken, wijziging op pagina 2 uitvoeren, en daarna beschermde pagina-1-posities plus bestaande controls vergelijken met de backup.
