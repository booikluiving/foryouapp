# For You App

Realtime chat-app met:
- een publieke live chat (`/`)
- een uitgebreide admin console (`/admin`)
- een losse algoritme-regietafel (`/algoritme`) voor personages, omgevingen, speelbare situaties en TouchDesigner-prompts
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
- Admin-auth staat standaard uit voor het besloten technici-netwerk; de tokenlaag blijft als compatibiliteitshuls.
- Nieuwe sessie + QR-flow: admin maakt een unieke join-token en QR, clients joinen via `/join?token=...`.
  - Toegang is sessiegebonden: bij een nieuwe sessie is opnieuw scannen/joinen vereist.
- Stage output pagina (`/stage`) voor OBS/Electron/TouchDesigner browser output met toggles en live styling (QR/chat/emoji, schaal, positie, achtergrond transparant/zwart).
- Algoritme-pagina (`/algoritme`) voor vaste speelbare situaties, personage- en omgevingsbeschrijvingen, calibratie, live score en OSC-output naar TouchDesigner.
- Catalogus-saves op `/algoritme` spiegelen direct naar Dropbox en de lokale `database.md` mirror; API-playground/OpenAI tooling is deploybaar, maar secrets blijven per machine lokaal.
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
PORT=3010 npm start
```

Standaard voor deze lokale werkmap is `0.0.0.0:3010`.
Publieke stage/join links gebruiken automatisch het actuele LAN-IP + poort (fallback: localhost).

## Projectafspraak: poorten
De lokale app/show-server in deze werkmap draait op `3010`. Start geen tweede For You-server op `3000` of een willekeurige fallbackpoort als er al een server draait. Controleer eerst de bestaande poort en herstart dezelfde poort als dat nodig is.

De Mac Studio show-machine gebruikt via de launchd/setup-scripts `3310`. Dat is een aparte machine-afspraak. Wijzig `3010` of `3310` alleen bewust en expliciet.

## Omgevingsvariabelen
Belangrijkste env vars:
- `PORT` (lokale default: `3010`; Mac Studio setup: `3310`)
- `ADMIN_AUTH_DISABLED` (default: `1`; adminpagina's openen zonder wachtwoord)
- `ADMIN_PASSWORD` (default: `admin`; alleen actief als `ADMIN_AUTH_DISABLED=0`)
- `FORYOU_SYNC_SECRET` / `SYNC_SECRET` (expliciet nodig voor peer-sync wanneer `ADMIN_AUTH_DISABLED=1`; geen fallback naar `ADMIN_PASSWORD`)
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
- `UNIFI_AGENT_ENABLED` (optioneel, zet op `1` voor de read-only UniFi network agent)
- `UNIFI_API_BASE_URL` (default: `https://192.168.1.1/proxy/network/integration/v1`)
- `UNIFI_API_KEY` (lokale UniFi API-key, nooit committen)
- `UNIFI_API_INSECURE_TLS` (default: `1`, handig voor self-signed lokale UniFi HTTPS)

Voorbeeld:
```bash
ADMIN_AUTH_DISABLED=1 PORT=3010 npm start
```

Voor UniFi-configuratie: kopieer `.env.example` naar `.env` op de Mac Studio en vul daar de echte key in.

## NPM scripts
- `npm start` start de server (`server.js`)
- `npm run smoke -- --url http://127.0.0.1:3010` controleert health, pagina's en WebSockets
- `npm run test:algorithm` test de losse algoritme-engine
- `npm run simulate` start de losse simulator CLI (`scripts/simulate-chatters.js`)
- `npm run unifi:status` test de read-only UniFi network agent
- `scripts/mac-studio-setup.command` installeert/start de Mac Studio show-machine via launchd
- `scripts/mac-studio-update.command` pullt de laatste code, installeert dependencies, herstart en smoke-test
- `scripts/mac-studio-preview.command <branch>` start een losse branch-preview op poort `3311` zonder de live showserver te raken
- `scripts/mac-studio-status.command` toont launchd, health, URLs, git status en logs

Mac launcher:
- `scripts/open-admin.command` gebruikt lokaal poort `3010`, start de server alleen als er nog geen For You-server draait, opent admin via huidig LAN-IP (fallback localhost) en sluit daarna het Terminal-venster. Gebruik geen extra fallbackpoort zonder bewuste reden.
- Dubbelklik op dit `.command` bestand of zet er een snelkoppeling/icoon van op je bureaublad.
- Zie `MAC_STUDIO_SETUP.md` voor de show-machine setup.

## Mac Studio branch-workflow
Ontwikkelen op branches mag. De afspraak is alleen: live deploy naar poort `3310` loopt standaard via `main`.

Voor branch-werk op de Mac Studio:

```bash
cd "$HOME/ForYou/main/app"
./scripts/mac-studio-preview.command codex/mijn-branch
```

Dat maakt/gebruikt een worktree onder `$HOME/ForYou/worktrees`, start die branch op `http://127.0.0.1:3311/` en laat de live showserver op `3310` ongemoeid. Gebruik `FORYOU_PREVIEW_PORT=3312` als er al een preview draait.

Stoppen:

```bash
./scripts/mac-studio-preview.command stop codex/mijn-branch
```

Mergen naar `main` en live herstarten blijft een expliciete stap na review. Alleen als je heel bewust een branch op de live poort wilt draaien, zet je `FORYOU_ALLOW_LIVE_BRANCH=1`; doe dat niet als gewone preview.

CLI hulp:
```bash
node scripts/simulate-chatters.js --help
node scripts/smoke-test.js --help
```

Smoke-test met optionele join-checks. Admin API-checks draaien zonder wachtwoord als `ADMIN_AUTH_DISABLED=1`.
```bash
npm run smoke -- --url http://127.0.0.1:3010
SMOKE_JOIN_TOKEN="token-uit-admin-qr" npm run smoke -- --url http://127.0.0.1:3010 --send-comment
```

## Routes
- `GET /` publieke client
- `GET /join?token=...` registreert scan/join en stuurt door naar client
  - zet een sessie-access cookie voor alleen de actuele sessie
- `GET /admin` admin console
- `GET /algoritme` algoritme-regietafel
- `GET /paden` visuele padeneditor voor algoritme-situaties
- `GET /stage` stage output (portrait 1080x1920)
- `GET /health` healthcheck
- `GET /debug-log` uitlezen debugregels (alleen admin-token, en alleen als `DEBUG_LOG_ENABLED=1`)

Admin API endpoints (subset):
- `/admin/login`, `/admin/logout`, `/admin/login/device`
- `/admin/state`
- `/admin/session/new`
- `/admin/session/new-with-token`
- `/admin/stage/settings` (stage toggles/styling)
- `/admin/algorithm/state` en `/admin/algorithm/*` (catalogus, scene-runs, aanbeveling, TouchDesigner-send)
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
  - `/foryou/algorithm/state`
  - `/foryou/algorithm/next`
  - `/foryou/algorithm/start_scene`
  - `/foryou/algorithm/end_scene`
  - `/foryou/algorithm/select_scene`
  - `/foryou/sim/start`
  - `/foryou/sim/stop`
  - `/foryou/sim/toggle`
  - `/foryou/sim/update_json`
  - `/foryou/sim/save_defaults_json`
  - `/foryou/admin/stop`

## Bestandsstructuur
- `server.js` backend + WebSocket + admin API + simulator
- `lib/show-algorithm.js` algoritme-engine voor scene-score, aanbevelingen en promptcompositie
- `public/index.html` client UI
- `public/admin.html` admin console UI
- `public/algoritme.html` algoritme-regietafel
- `public/paden.html`, `public/paden-editor.js`, `public/paden-graph.js` visuele padeneditor
- `scripts/simulate-chatters.js` standalone botsimulator
- `moderation/bad-words.txt` tekstwoorden voor filtering
- `moderation/blocked-words.json` extra/gestructureerde blocked words
- `brainrot.txt` woordenlijst voor bot-stijl
- `data/sim/*.txt` bot-datapools (zinnen, templates, namen, emoji’s), 1 regel per item
- `data/` lokale SQLite data

## Dropbox catalogus-sync
De app kan de catalogus continu spiegelen naar `Dropbox/For You/Database/`.
Daar staan canonieke `.foryou.md` bestanden voor personages, omgevingen, situaties en stijlregels, plus exports voor runs/scores en interne chatlogs.
Bestandsnamen beginnen met de naam en bevatten daarna type plus vast ID, zoals `peter-character-0002.foryou.md`, zodat Dropbox en GPT makkelijker kunnen zoeken.
Chatlogs worden zowel als machineleesbare JSONL als leesbare Markdown-transcripts geëxporteerd.

Belangrijk: `data/live.sqlite` zelf wordt niet via Dropbox gesynct. SQLite blijft de lokale runtime-database; de Dropbox-map is de gedeelde bestandslaag voor redactie, analyse en GPT-context. Speelbare scène-compositie blijft in SQLite en wordt niet als aparte GPT-facing catalogusmap geëxporteerd.

Configuratie:
- `FORYOU_DROPBOX_CATALOG_DIR` (default: `~/Dropbox/For You/Database`, met macOS CloudStorage-detectie)
- `FORYOU_DROPBOX_CATALOG_ENABLED=0` om uit te zetten
- `FORYOU_DROPBOX_CATALOG_INTERVAL_MS` (default: `2000`)

Zie `docs/DROPBOX_CATALOG_SYNC.md` voor de volledige structuur en conflictregels.

## Padeneditor
De inhoudelijke padstructuur wordt centraal opgeslagen in de SQLite database van de runtime (`data/live.sqlite`) via de bestaande algorithm path API. Dat geldt voor paden, geselecteerde situaties, pijlen, naam/kleur/beschrijving, deactiveren en verwijderen.

De handmatige canvas-layout en nodeposities worden op dit moment per browser in `localStorage` bewaard. Meerdere editors delen dus dezelfde inhoudelijke padstructuur, maar niet automatisch elkaars handmatig verschoven canvasposities. Dit is bewust gedaan zonder database-migratie. Bij gelijktijdig bewerken van hetzelfde pad geldt voorlopig: laatste save wint.

## API playground
De API playground is deploybaar naar de Mac Studio. Secrets blijven per machine lokaal in `.env.local` en staan niet in Git.

Via `/api-playground` kun je als admin de instellingen openen en waarden voor `OPENAI_API_KEY` en `ANTHROPIC_API_KEY` opslaan. De server schrijft die naar `.env.local` met beperkte bestandsrechten en stuurt de waarden nooit terug naar de browser.

## Moderatie en botstijl aanpassen
- Voeg woorden toe in `moderation/bad-words.txt` voor blokkeren.
- Gebruik `brainrot.txt` om bot-vocabulaire/stijl bij te sturen.
- Pas botzinnen/emojis/namen aan via `data/sim/*.txt` (line-by-line, zonder quotes).
- Regels met `#` of `//` en lege regels worden genegeerd.
- Wijzigingen in `data/sim/*.txt` en `brainrot.txt` worden automatisch ingeladen tijdens runtime.
- In admin kun je simulatie live tunen met sliders en defaults opslaan.

## Veiligheid
- `ADMIN_AUTH_DISABLED=1` is bedoeld voor het besloten technici-netwerk.
- Zet `ADMIN_AUTH_DISABLED=0` en configureer `ADMIN_PASSWORD` als admin-auth weer actief moet zijn.
- Peer-sync blijft apart beveiligd: zet `FORYOU_SYNC_SECRET` of `SYNC_SECRET` expliciet als sync gebruikt wordt.
- Controleer wie netwerktoegang heeft tot `/admin`.
- Debug logging staat standaard uit. Zet alleen tijdelijk aan met `DEBUG_LOG_ENABLED=1` bij troubleshooting.

## Licentie
ISC
