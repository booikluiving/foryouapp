# For You OSC Tester

Small local OSC sender and feedback monitor for all OSC receive commands exposed by the app.

## Start

From the repository root:

```bash
node app/docs/project-status/osc-tester/server.js
```

Open:

```text
http://127.0.0.1:3099
```

The page also links to For_universe on the same For You app server. In the browser, the link uses the same hostname as the tester page and port `3010`, so it also works when you open the tester through a LAN IP:

```text
http://127.0.0.1:3010/universe
http://<macbook-lan-ip>:3010/universe
```

## Use

1. Make sure the For You app is running on `http://127.0.0.1:3010`.
2. Open the tester page.
3. Click `Reload commands` to load the OSC command overview.
   Without admin auth this uses the live app registry.
   With admin auth it shows a built-in fallback list until you log in.
4. If admin auth is enabled, log in with the admin password or paste an `x-admin-token`, then click `Reload commands` again for live settings.
5. Click `Gebruik lokale feedback target`.
   This temporarily sets the app OSC feedback target to `127.0.0.1:9002`.
6. Use the quick situation buttons or the `Send` button next to any receive command.
7. Watch the OSC log for `/foryou/control/feedback`.
8. Click `Herstel originele OSC target` when done.

The tester shows friendly labels above the raw OSC paths. The situation controls are:

- `Check volgende situatie` -> `/foryou/algorithm/next`
- `Start volgende situatie` -> `/foryou/algorithm/start_next`
- `Stop huidige situatie` -> `/foryou/algorithm/end_scene`

Commands that stop/restart/end sessions ask for a browser confirm before sending.

Argument fields accept:

- empty input for commands without args
- comma-separated args, for example `My session, 60`
- JSON arrays, for example `["My session", 60]`
- JSON objects as one string arg, for commands that expect JSON patches

The tool also restores the original OSC target on `Ctrl+C` when it previously changed it.

## Defaults

- Tool page: `127.0.0.1:3099`
- App HTTP: `127.0.0.1:3010`
- For_universe: same browser host on app port `3010`, path `/universe`
- App OSC receive: `127.0.0.1:1234`
- Local feedback monitor: `0.0.0.0:9002`

Override ports with environment variables:

```bash
OSC_TOOL_PORT=3099 \
FORYOU_APP_HOST=127.0.0.1 \
FORYOU_APP_PORT=3010 \
FOR_UNIVERSE_PATH=/universe \
FORYOU_OSC_RECEIVE_PORT=1234 \
FORYOU_OSC_MONITOR_PORT=9002 \
node app/docs/project-status/osc-tester/server.js
```

Use `FOR_UNIVERSE_URL` only when you explicitly want to override the generated link.
