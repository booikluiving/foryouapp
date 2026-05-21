# Camera Control Sidecar

Standalone Blackmagic Micro Studio Camera 4K G2 control surface for the For You setup. This sidecar is intentionally separate from the main show server, like `sq5-control/`.

## Start

From `main/`:

```bash
cd app
CAMERA_CONTROL_HOST=127.0.0.1 CAMERA_CONTROL_PORT=3110 node camera-control/server.js
```

Open:

```text
http://127.0.0.1:3110
```

Default cameras:

```text
cam1 192.168.1.165
cam2 192.168.1.166
cam3 192.168.1.167
```

Override:

```bash
CAMERA_CONTROL_CAM1_HOST=192.168.1.165 \
CAMERA_CONTROL_CAM2_HOST=192.168.1.166 \
CAMERA_CONTROL_CAM3_HOST=192.168.1.167 \
node camera-control/server.js
```

## Safety

HTTP and OSC bind to localhost by default.

Remote HTTP requires an explicit token:

```bash
CAMERA_CONTROL_HOST=0.0.0.0 \
CAMERA_CONTROL_TOKEN=change-me \
node camera-control/server.js
```

Then open:

```text
http://<machine-ip>:3110/?token=change-me
```

Remote OSC is not token-protected and must be explicitly enabled:

```bash
CAMERA_CONTROL_ALLOW_REMOTE=1 \
CAMERA_CONTROL_OSC_LISTEN_ADDRESS=0.0.0.0 \
node camera-control/server.js
```

## Browser UI

The UI shows three camera panels with:

- REST/WebSocket health
- app-level tally state
- preview tile
- focus, iris, zoom
- contrast pivot and adjust
- lift, gamma, gain, and offset color controls
- fine mode for smaller slider movements

Preview is configured with URLs and embedded as an iframe:

```bash
CAMERA_CONTROL_CAM1_PREVIEW_URL=http://127.0.0.1:8889/cam1 \
CAMERA_CONTROL_CAM2_PREVIEW_URL=http://127.0.0.1:8889/cam2 \
CAMERA_CONTROL_CAM3_PREVIEW_URL=http://127.0.0.1:8889/cam3 \
node camera-control/server.js
```

V1 expects OBS/WebRTC or another local video pipeline to provide these URLs. Camera control and video preview remain separate systems.

## HTTP API

State:

```bash
curl -s http://127.0.0.1:3110/api/state
```

Sync camera state:

```bash
curl -X POST http://127.0.0.1:3110/api/sync
```

Lens:

```bash
curl -X POST http://127.0.0.1:3110/api/camera/cam1/focus \
  -H 'content-type: application/json' \
  -d '{"normalised":0.5}'

curl -X POST http://127.0.0.1:3110/api/camera/cam1/iris \
  -H 'content-type: application/json' \
  -d '{"normalised":0.25}'

curl -X POST http://127.0.0.1:3110/api/camera/cam1/zoom \
  -H 'content-type: application/json' \
  -d '{"normalised":0.75}'
```

Contrast:

```bash
curl -X POST http://127.0.0.1:3110/api/camera/cam1/contrast \
  -H 'content-type: application/json' \
  -d '{"pivot":0.5,"adjust":1.0}'
```

Color:

```bash
curl -X POST http://127.0.0.1:3110/api/camera/cam1/color/lift \
  -H 'content-type: application/json' \
  -d '{"luma":0,"red":0,"green":0,"blue":0}'
```

Generic safe control endpoint:

```bash
curl -X POST http://127.0.0.1:3110/api/camera/cam1/control \
  -H 'content-type: application/json' \
  -d '{"endpoint":"/lens/focus","value":{"normalised":0.5}}'
```

App-level tally:

```bash
curl -X POST http://127.0.0.1:3110/api/tally \
  -H 'content-type: application/json' \
  -d '{"camera":"cam1","state":"program"}'

curl -X POST http://127.0.0.1:3110/api/tally/all \
  -H 'content-type: application/json' \
  -d '{"state":"none"}'
```

Tally is displayed by this sidecar. The Blackmagic REST documentation exposes `GET /camera/tallyStatus`, but no documented `PUT` for forcing physical camera tally lights in this API version. On the current Micro Studio Camera 4K G2 units this endpoint may return `404`; the sidecar therefore treats physical tally status as optional and keeps external HTTP/OSC tally as the v1 source of truth.

## OSC

Default:

```text
host 127.0.0.1
port 53100
```

Supported OSC inputs:

```text
/camera/cam1/focus           0..1
/camera/cam1/iris            0..1
/camera/cam1/zoom            0..1
/camera/cam1/contrast/pivot  0..1
/camera/cam1/contrast/adjust 0..2
/camera/cam1/color/lift/luma -4..4
/camera/cam1/color/lift/red  -4..4
/camera/tally/cam1           program|preview|none
```

Use `cam2` and `cam3` for the other cameras.

## Verify

Read-only camera API scan:

```bash
node camera-control/test-camera-api.js
```

Start the server, then send harmless tally OSC loopback messages:

```bash
node camera-control/test-osc-loopback.js
```

Syntax check:

```bash
node --check camera-control/server.js
node --check camera-control/public/app.js
```

## Official References

- [Blackmagic developer page](https://www.blackmagicdesign.com/developer/products/camera/sdk-and-software)
- [REST API for Blackmagic Cameras PDF](https://documents.blackmagicdesign.com/DeveloperManuals/RESTAPIforBlackmagicCameras.pdf?_v=1754550010000)
