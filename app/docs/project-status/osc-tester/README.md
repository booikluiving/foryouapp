# For You OSC Tester

Small local OSC sender and feedback monitor for Show control.

## Start

From the repository root:

```bash
node app/docs/project-status/osc-tester/server.js
```

Open:

```text
http://127.0.0.1:3099
```

## Use

1. Make sure the For You app is running on `http://127.0.0.1:3010`.
2. Open the tester page.
3. Click `Gebruik lokale feedback target`.
   This temporarily sets the app OSC feedback target to `127.0.0.1:9002`.
4. Click `Send /foryou/show/start` or `Send /foryou/show/stop`.
5. Watch the OSC log for `/foryou/control/feedback`.
6. Click `Herstel originele OSC target` when done.

The tool also restores the original OSC target on `Ctrl+C` when it previously changed it.

## Defaults

- Tool page: `127.0.0.1:3099`
- App HTTP: `127.0.0.1:3010`
- App OSC receive: `127.0.0.1:1234`
- Local feedback monitor: `0.0.0.0:9002`

Override ports with environment variables:

```bash
OSC_TOOL_PORT=3099 \
FORYOU_APP_HOST=127.0.0.1 \
FORYOU_APP_PORT=3010 \
FORYOU_OSC_RECEIVE_PORT=1234 \
FORYOU_OSC_MONITOR_PORT=9002 \
node app/docs/project-status/osc-tester/server.js
```
