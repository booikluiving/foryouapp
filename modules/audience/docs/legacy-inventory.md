# V2 Audience legacy inventory

Onderzocht:
- `app/public/index.html`: publieke telefoon-app met naam, chat, hearts, bored, poll UI, reconnect/heartbeat, sessie-lock feedback en Socket.IO-polling fallback bovenop WebSocket-achtige berichten.
- `app/public/admin.html`: brede legacy admin. Audience-relevant zijn sessie/QR, live users, chatlog, moderatie, polls, crowd simulation en stage/QR/chat styling. Niet-Audience zijn runtime/algorithm/order, OSC/hardware, UniFi/network, server restart/stop, sync en catalog tooling.
- `legacy/server.js`: legacy gebruikt `ws` plus `socket.io` polling fallback; sessiejoin loopt via `/join?token=...` naar een HttpOnly access-cookie; WebSocket weigert zonder actieve token/grant. Nieuwe sessie sluit oude clients en reset poll/reactions/mutes/blocks/rate limits.
- `crowd-system/`: zelfstandige crowd engine met modes/cues/traits. Overgenomen als submodule binnen `modules/audience/crowd-system/`.
- `app/scripts/simulate-chatters.js`: externe WS-simulator met bot chat, reacties en poll votes. V2 Audience integreert dezelfde functionele stroom intern via de Audience-service zodat bot-signalen dezelfde opslag en realtime update-route gebruiken als echte clients.
- Bestaande V2 Audience: dunne REST-service met JSON-bestanden voor sessions/signals en Runtime-linking. V2 houdt de Runtime-koppeling read-only en vervangt opslag door Audience-eigen SQLite.

Meegenomen in V2:
- Public app look/workflow uit legacy public client.
- Nieuwe V2 routes voor public, admin, realtime, algorithm input en health.
- Sessie start/stop, join-token, QR-link flow en cookie-grant.
- Live users, live chat, moderation actions, enforcement state, mutes, unmute, block, unblock en kick.
- Poll start/close, votes, results en live updates.
- Crowd simulation met modes/cues en bot-signalen als `isBot`/`simulated`.
- Ruwe chat en signaalcounts beschikbaar voor Algorithm; Runtime active situation wordt alleen gelezen en nooit door Audience geschreven.

Bewust niet meegenomen:
- UniFi/network-agent UI en endpoints.
- OSC/runtime settings, server restart/stop, sync, catalog, oude algorithm/order controls en show-control/hardware bediening.
- Operator-stage AI drafting. Stage/QR/chat styling blijft als audience/stage-achtige open uitbreiding; de V2 basis levert join-link/QR en audience state.
