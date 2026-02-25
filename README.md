# For You App

Realtime chat-app met:
- een publieke live chat (`/`)
- een uitgebreide admin console (`/admin`)
- ingebouwde bot-simulatie met instelbare stijl, sentiment en emoji-gedrag
- moderatie (woordenlijst, mute/block, user history)

De app draait op Node.js, gebruikt WebSockets voor live berichten, en slaat sessies/berichten op in SQLite.

## Projectbeschrijving
Deze app is gemaakt voor live interactieve shows/streams waar publiek realtime kan reageren.  
Je kunt als admin direct sturen op chatkwaliteit via moderatie, polls, botsimulatie en runtime-instellingen.

Belangrijke onderdelen:
- Live chat met naamkleur per gebruiker.
- Polls starten/sluiten vanuit admin.
- Bot-simulatie met sliders (aantal bots, message-rate, positief/negatief, emoji, topic).
- Segmenten in admin herschikbaar (drag & drop), inklapbaar en onthouden per apparaat.
- Donkere modus (admin + client).
- Server-restart en server-stop direct vanuit admin.
- "Onthoud dit apparaat" login voor admin (trusted device).
- Admin wachtwoord wijzigen vanuit de admin console (met sterkte-eisen).
- Nieuwe sessie + QR-flow: admin maakt een unieke join-token en QR, clients joinen via `/join?token=...`.
  - Toegang is sessiegebonden: bij een nieuwe sessie is opnieuw scannen/joinen vereist.
- Stage output pagina (`/stage`) voor OBS/Electron/TouchDesigner browser output met toggles en live styling (QR/chat/emoji, schaal, positie, achtergrond transparant/zwart).
- Open tabs (`/`, `/admin`, `/stage`) verversen automatisch na een server-restart op basis van server-instance detectie.

## Tech stack
- Node.js (vereist: Node 22+ vanwege `node:sqlite`)
- Express
- ws (WebSocket server)
- osc (OSC input/control)
- SQLite (`data/live.sqlite`)
- HTML/CSS/vanilla JS frontend

## Snel starten
```bash
npm install
npm start
```

Standaard luistert de server op `0.0.0.0:3000`.
Publieke stage/join links gebruiken automatisch het actuele LAN-IP + poort (fallback: localhost).

## Omgevingsvariabelen
Belangrijkste env vars:
- `PORT` (default: `3000`)
- `ADMIN_PASSWORD` (default: `admin`)
- `POLL_DURATION_SECONDS` (default: `60`)
- `ADMIN_RESTART_BOOT_DELAY_MS` (default: `0`)
- `ADMIN_RESTART_CHILD_BOOT_DELAY_MS` (default: `900`)
- `ADMIN_TRUSTED_DEVICE_TTL_DAYS` (default: `60`)
- `OSC_CONTROL_LISTEN_PORT` (default: `1234`)
- `OSC_CONTROL_LISTEN_ADDRESS` (default: `127.0.0.1`)
- `OSC_CONTROL_ALLOW_REMOTE` (default: `0`, alleen localhost toegestaan)
- `OSC_CONTROL_FEEDBACK_ADDRESS` (default: `/foryou/control/feedback`)
- `OSC_CONTROL_FEEDBACK_HOST` (optioneel vast send-target host voor feedback)
- `OSC_CONTROL_FEEDBACK_PORT` (optioneel vast send-target poort voor feedback)

Voorbeeld:
```bash
ADMIN_PASSWORD="kies-een-sterk-wachtwoord" PORT=3000 npm start
```

## NPM scripts
- `npm start` start de server (`server.js`)
- `npm run simulate` start de losse simulator CLI (`scripts/simulate-chatters.js`)

Mac launcher:
- `scripts/open-admin.command` start lokaal de server (indien nodig), opent admin via huidig LAN-IP (fallback localhost) en sluit daarna het Terminal-venster.
- Dubbelklik op dit `.command` bestand of zet er een snelkoppeling/icoon van op je bureaublad.

CLI hulp:
```bash
node scripts/simulate-chatters.js --help
```

## Routes
- `GET /` publieke client
- `GET /join?token=...` registreert scan/join en stuurt door naar client
  - zet een sessie-access cookie voor alleen de actuele sessie
- `GET /admin` admin console
- `GET /stage` stage output (portrait 1080x1920)
- `GET /health` healthcheck
- `GET /debug-log` uitlezen debugregels (alleen admin-token, en alleen als `DEBUG_LOG_ENABLED=1`)

Admin API endpoints (subset):
- `/admin/login`, `/admin/logout`, `/admin/login/device`
- `/admin/state`
- `/admin/session/new`
- `/admin/session/new-with-token`
- `/admin/stage/settings` (stage toggles/styling)
- `/admin/polls/start`, `/admin/polls/close`
- `/admin/sim/start`, `/admin/sim/update`, `/admin/sim/stop`, `/admin/sim/defaults`
- `/admin/users/mute`, `/admin/users/unmute`, `/admin/users/block`, `/admin/users/unblock`, `/admin/users/kick`
- `/admin/restart`
- `/admin/stop`
- `/admin/settings/osc-listen-port` (OSC inbound listen poort)
- `/admin/settings/osc-feedback-target` (OSC feedback send target: host+poort, of leeg voor reply-to-sender)

## OSC control (TouchDesigner -> server)
- OSC outbound voor losse chat/reaction-events is uitgezet om load te beperken.
- Server luistert inbound op OSC voor control-commando's.
- Belangrijke commando's sturen feedback terug op OSC (`ok`/`error`) via `/foryou/control/feedback`.
- Feedback gaat standaard terug naar de afzender van het OSC commando, of naar een vast send target als je dat instelt in admin.
- Commando-overzicht staat live in de admin console onder `Techniek`.
- Basiscommando's:
  - `/foryou/session/new`
  - `/foryou/session/new_with_token`
  - `/foryou/session/end`
  - `/foryou/stage/show_qr`
  - `/foryou/stage/show_chat`
  - `/foryou/stage/show_emojis`
  - `/foryou/stage/patch_json`
  - `/foryou/sim/start`
  - `/foryou/sim/stop`
  - `/foryou/sim/toggle`
  - `/foryou/sim/update_json`
  - `/foryou/sim/save_defaults_json`
  - `/foryou/admin/stop`

## Bestandsstructuur
- `server.js` backend + WebSocket + admin API + simulator
- `public/index.html` client UI
- `public/admin.html` admin console UI
- `scripts/simulate-chatters.js` standalone botsimulator
- `moderation/bad-words.txt` tekstwoorden voor filtering
- `moderation/blocked-words.json` extra/gestructureerde blocked words
- `brainrot.txt` woordenlijst voor bot-stijl
- `data/sim/*.txt` bot-datapools (zinnen, templates, namen, emoji’s), 1 regel per item
- `data/` lokale SQLite data

## Moderatie en botstijl aanpassen
- Voeg woorden toe in `moderation/bad-words.txt` voor blokkeren.
- Gebruik `brainrot.txt` om bot-vocabulaire/stijl bij te sturen.
- Pas botzinnen/emojis/namen aan via `data/sim/*.txt` (line-by-line, zonder quotes).
- Regels met `#` of `//` en lege regels worden genegeerd.
- Wijzigingen in `data/sim/*.txt` en `brainrot.txt` worden automatisch ingeladen tijdens runtime.
- In admin kun je simulatie live tunen met sliders en defaults opslaan.

## Veiligheid
- Zet altijd `ADMIN_PASSWORD` via environment variable in productie.
- Gebruik niet de default `admin`.
- Controleer wie toegang heeft tot `/admin`.
- Debug logging staat standaard uit. Zet alleen tijdelijk aan met `DEBUG_LOG_ENABLED=1` bij troubleshooting.

## Licentie
ISC
