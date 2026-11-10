# Publieke ingang (één QR, eigen mobiele data)

Twee omgevingsvariabelen in `nl.foryou.audience`:

| Variabele | Waarde | Effect |
|---|---|---|
| `AUDIENCE_PUBLIC_PORT` | `3030` | tweede server, alleen op `127.0.0.1`, met alleen de publieke app |
| `AUDIENCE_PUBLIC_JOIN_URL` | `https://www.foryouniverse.nl/live` | QR wordt `…/live?t=<token>` |

Zonder deze variabelen werkt alles zoals eerder (QR naar het LAN-adres).

Keten: QR → `www.foryouniverse.nl/live?t=…` → Cloudflare-doorverwijzing → `live.foryouniverse.nl/live?t=…` → tunnel op de show-Mac → `127.0.0.1:3030`.

Op de publieke poort: `/`, `/live`, `/join`, `/health` (zonder db-pad), `/audience/public/*`, `/audience/realtime`, `/audience/socket.io`, `/audience/vendor`. Al het andere geeft 404.

Publieke deelnemers: geen IP-adres en geen apparaat opgeslagen; in admin heten ze `pub-<schuilnaam>` (per toegangspas). Mute/blokkeren werkt per telefoon.

Scheldwoordenfilter: `modules/audience/moderation/bad-words.txt`, één woord per regel, wordt opnieuw ingelezen bij wijziging.

Test: `npm run audience:public-test`.
