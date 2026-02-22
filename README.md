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
- Server-restart direct vanuit admin.
- "Onthoud dit apparaat" login voor admin (trusted device).
- Admin wachtwoord wijzigen vanuit de admin console (met sterkte-eisen).
- Nieuwe sessie + QR-flow: admin maakt een unieke join-token en QR, clients joinen via `/join?token=...`.
  - Toegang is sessiegebonden: bij een nieuwe sessie is opnieuw scannen/joinen vereist.

## Tech stack
- Node.js (vereist: Node 22+ vanwege `node:sqlite`)
- Express
- ws (WebSocket server)
- osc (OSC output)
- SQLite (`data/live.sqlite`)
- HTML/CSS/vanilla JS frontend

## Snel starten
```bash
npm install
npm start
```

Standaard draait de server op `http://localhost:3000`.

## Omgevingsvariabelen
Belangrijkste env vars:
- `PORT` (default: `3000`)
- `ADMIN_PASSWORD` (default: `admin`)
- `POLL_DURATION_SECONDS` (default: `60`)
- `ADMIN_RESTART_BOOT_DELAY_MS` (default: `0`)
- `ADMIN_RESTART_CHILD_BOOT_DELAY_MS` (default: `900`)
- `ADMIN_TRUSTED_DEVICE_TTL_DAYS` (default: `60`)

Voorbeeld:
```bash
ADMIN_PASSWORD="kies-een-sterk-wachtwoord" PORT=3000 npm start
```

## NPM scripts
- `npm start` start de server (`server.js`)
- `npm run simulate` start de losse simulator CLI (`scripts/simulate-chatters.js`)

CLI hulp:
```bash
node scripts/simulate-chatters.js --help
```

## Routes
- `GET /` publieke client
- `GET /join?token=...` registreert scan/join en stuurt door naar client
  - zet een sessie-access cookie voor alleen de actuele sessie
- `GET /admin` admin console
- `GET /health` healthcheck
- `GET /debug-log` uitlezen debugregels (alleen admin-token, en alleen als `DEBUG_LOG_ENABLED=1`)

Admin API endpoints (subset):
- `/admin/login`, `/admin/logout`, `/admin/login/device`
- `/admin/state`
- `/admin/session/new`
- `/admin/session/new-with-token`
- `/admin/polls/start`, `/admin/polls/close`
- `/admin/sim/start`, `/admin/sim/update`, `/admin/sim/stop`, `/admin/sim/defaults`
- `/admin/users/mute`, `/admin/users/unmute`, `/admin/users/block`, `/admin/users/unblock`, `/admin/users/kick`
- `/admin/restart`

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
