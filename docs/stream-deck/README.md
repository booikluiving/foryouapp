# Stream Deck XL (For_You)

Eén bron van waarheid: `modules/show-control/hardware/streamdeck-control/companion/`.

| Bestand | Wat |
|---|---|
| `deck.json` | pagina's en knoppen: plek `[rij, kolom]`, `key`, `label`, `actie` |
| `bouw.js` | bouwt de hele Companion-indeling uit `deck.json` (pagina's, knoppen, variabelen, surface); idempotent |
| `deck-actie.js` | wat een knop doet; Companion roept `deck-actie.js <key>` aan |
| `deck-status.js` | statusdienst (LaunchAgent `nl.foryou.deck-status`); zet per knop `fy_<key>_t` (tekst) en `fy_<key>_s` (staat), alleen bij verandering |
| `deck.sh` | `check`, `test start/stop/druk <key>`, `toepassen --ja`, `terugdraaien [map]`, `status` |
| `browser-tabs.sh`, `stack.sh` | browsertabbladen openen, show-stack aan/uit/restart |

## Opzet

- Deck via direct USB in Companion. Elgato-app en Elgato-plugin staan uit.
- De deck werkt alleen als `for_you` de actieve consolegebruiker is. Staat een ander account vooraan (snelle gebruikerswissel), dan blokkeert macOS USB-HID voor Companion ("Cannot write to hid device").
- Knoppen met een actie starten `deck-actie.js` los van Companion; uitkomst in `~/Library/Logs/ForYouV2/deck.log`.
- Kleur per staat staat in `deck.json` → `staten`.

## Acties in `deck.json`

| `actie` | Doet |
|---|---|
| `{ "cue": "<naam>" }` | cue via show-control :3025 (namen: `CUES` in `deck-actie.js`) |
| `{ "link": "<url>" }` | tabblad openen of naar voren halen |
| `{ "pagina": "<id>" }` | andere pagina op het deck; met `"status": true` krijgt de knop ook status |
| `{ "stack": "toggle" \| "restart" }` | show-stack |
| `{ "td": "open" }` | `scripts/open-current-showcontrol-td.command open` |
| geen | alleen statuslampje |

## Wijzigen

1. `deck.json` aanpassen.
2. `deck.sh check`
3. `deck.sh test start` → http://127.0.0.1:18008/emulator/streamdeck-xl (kopie van de echte config, knoppen doen niets buiten Companion).
4. `deck.sh toepassen --ja` (stopt Companion, back-up van de hele Companion-map naar `~/ForYou/companion-backups/deck-revamp-<tijd>/`, installeert naar `~/ForYou/streamdeck/`, start alles weer).
5. Terug: `deck.sh terugdraaien` (laatste back-up) of `deck.sh terugdraaien <map>`.
