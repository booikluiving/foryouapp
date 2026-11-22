# Toegang tot de show-Mac: dicht en weer open

## Stand

Sinds 22 nov 2026 staat de show-Mac **dicht**: show-diensten, sync-agent en Companion zijn uit, ook na een herstart.

| Ingang | Bereikbaar vanaf | Stand |
|---|---|---|
| Show-diensten (`nl.foryou.*`, poorten 3020–3027, 4210, 4240) | lokaal netwerk | dicht |
| Sync-agent website → show (`nl.foryou.sync`) | belt zelf naar buiten | dicht |
| Companion (16622–16623, 8008) | lokaal netwerk / Tailscale | dicht |
| Cloudflare-tunnel `live.foryouniverse.nl` → `127.0.0.1:3030` (alleen de telefoonpagina) | internet | blijft aan; zonder show-diensten alleen een foutpagina (503), met de diensten aan is de telefoonpagina vanzelf terug |
| AnyDesk | internet | open (in gebruik) |
| SSH (Externe login) | lokaal netwerk + Tailscale | open, sluiten vraagt het beheerderswachtwoord |
| Tailscale | eigen apparaten | open |
| Parsec | — | verwijderd |

Werk de tabel bij als je iets opent of sluit.

## Show-diensten, sync-agent en Companion weer open

```bash
cd ~/ForYou/main && for n in gateway show-control runtime audience catalog algorithm script-agent paths camera-control dmx-control sq5-control perfect-cue-control streamdeck-control deck-status muziek lichtspel spelersfoto hand-ready claude-api companion-tailscale-proxy sync; do launchctl enable gui/$(id -u)/nl.foryou.$n; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/nl.foryou.$n.plist; done; open -a Companion
```

Daarna: regie op `http://<show-mac>:3025/regie/`. De regie stond bij het sluiten nog op een verlopen testrun (Jillis, 20 nov).

## Weer dicht

```bash
for n in gateway show-control runtime audience catalog algorithm script-agent paths camera-control dmx-control sq5-control perfect-cue-control streamdeck-control deck-status muziek lichtspel spelersfoto hand-ready claude-api companion-tailscale-proxy sync; do launchctl disable gui/$(id -u)/nl.foryou.$n; launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/nl.foryou.$n.plist; done; osascript -e 'quit app "Companion"'
```

Companion staat als inlog-onderdeel en start na een herstart weer, tenzij je hem uit Systeeminstellingen → Algemeen → Inlogonderdelen haalt.

## Cloudflare-tunnel

Dicht:
```bash
sudo launchctl bootout system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
```
Open:
```bash
sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
```
Zonder show-diensten geeft de tunnel een foutpagina; met de tunnel dicht wijst `www.foryouniverse.nl/live` (NAS) nergens heen.

## AnyDesk

Onbewaakte toegang: AnyDesk → Instellingen → Beveiliging. Helemaal uit/aan:
```bash
sudo launchctl bootout system /Library/LaunchDaemons/com.philandro.anydesk.service.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.philandro.anydesk.service.plist
```

## SSH

Systeeminstellingen → Algemeen → Delen → Externe login.
