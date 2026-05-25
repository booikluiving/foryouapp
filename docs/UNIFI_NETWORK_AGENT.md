# For_You UniFi Network Agent

De network agent is een lokale, read-only koppeling tussen de For_You admin en de UniFi Network API.

## Wat hij nu doet

- Leest lokale configuratie uit `.env`, `.env.local` of environment variables.
- Gebruikt `UNIFI_API_KEY` alleen server-side.
- Toont in de admin een statuspaneel voor UniFi sites, devices, clients en networks.
- Weigert write-acties in de code. VLANs, SSIDs en firewallregels worden later pas als expliciete presets toegevoegd.

## Lokale configuratie

Maak op de Mac Studio een `.env` in de app-map:

```bash
UNIFI_AGENT_ENABLED=1
UNIFI_API_BASE_URL=https://192.168.1.1/proxy/network/integration/v1
UNIFI_API_KEY=REPLACE_WITH_LOCAL_KEY
UNIFI_API_INSECURE_TLS=1
UNIFI_API_TIMEOUT_MS=5000
```

`.env` en `.env.local` staan in `.gitignore`; plak echte keys dus niet in repo-bestanden.

## Testen

```bash
npm run unifi:status
npm run unifi:status -- --json
```

Als de lokale UniFi API een andere base URL toont in `UniFi Network > Control Plane > Integrations`, gebruik die exact:

```bash
npm run unifi:status -- --base-url https://192.168.1.1/andere/api/base
```

## Adminroute

De For_You server biedt deze statusroute via de admin-auth huls. Met `ADMIN_AUTH_DISABLED=1` is die huls frictieloos. Peer-sync blijft apart beveiligd en vereist dan nog steeds een expliciete `FORYOU_SYNC_SECRET` of `SYNC_SECRET`:

```text
GET /admin/network/status
```

Deze route haalt live status op bij UniFi. De gewone `/admin/state` toont alleen of de agent geconfigureerd is en doet geen router-call.

## Volgende fase

Voor write-acties bouwen we geen vrije API-proxy, maar een allowlist met presets, bijvoorbeeld:

- `show-network-enable`
- `show-network-disable`
- `guest-wifi-enable`
- `guest-wifi-disable`
- `snapshot-before-change`
- `rollback-last-preset`

Elke preset moet eerst een dry-run en audit log krijgen.
