# TouchDesigner Cheat Sheet v0

Dit is het praktische werkdocument voor de menselijke TouchDesigner-inrichting. Het doel is dat TD volgende week zo simpel mogelijk kan worden aangesloten op Show Control.

## Besluit

Gebruik één OSC-ingang voor alle cues naar TouchDesigner.

```text
Show Control -> TouchDesigner
UDP / OSC port: 9100
address: /td/cue
args: cueId, command, payloadId
```

Gebruik één OSC-uitgang voor lichte feedback terug naar Show Control.

```text
TouchDesigner -> Show Control
UDP / OSC port: 9101
address: /td/ack
args: cueId, command, stage, status, message
```

Niet per onderdeel een losse poort maken. Dus geen aparte poorten voor camera, environment, captions, audio en fx. Eén poort is rustiger, makkelijker te testen en veel minder foutgevoelig.

## TD Structuur

Maak in TouchDesigner één duidelijke plek voor show control:

```text
/project1/show_control
  oscin_td_cue       OSC In DAT
  oscout_td_ack      OSC Out DAT
  td_cue_router      Text DAT met Python callbacks
  cue_state          Table DAT met ontvangen cues/status
  media_registry     Table DAT met assetId -> lokaal bestandspad
```

### `oscin_td_cue`

Instellingen:

```text
Network Port: 9100
Callbacks DAT: td_cue_router
Active: On
```

### `oscout_td_ack`

Instellingen:

```text
Network Address: IP van Show Control
Network Port: 9101
Active: On
```

Op dezelfde machine kan de Show Control host voorlopig `127.0.0.1` zijn. Op de Mac Studio of in een netwerksetup wordt dit het IP-adres van de Show Control service.

## Berichtvorm

Elke cue ziet er hetzelfde uit:

```text
/td/cue cue-001 td.environment.prepare payload-001
/td/cue cue-002 td.phase.set payload-002
/td/cue cue-003 td.camera.set payload-003
/td/cue cue-004 td.environment.go payload-004
```

TD routeert intern op `command`.

Voorbeelden van commands:

| Command | Wat TD doet |
| --- | --- |
| `td.phase.set` | Zet fase naar `inloop`, `wait_operator` of `cams`. |
| `td.camera.set` | Zet camera 1, 2 of 3 actief. |
| `td.environment.prepare` | Laadt environment-assets alvast klaar. |
| `td.environment.go` | Maakt de voorbereide environment actief. |
| `td.asset.prepare` | Controleert/laadt specifieke media-assets. |
| `td.audio.prepare` | Zet soundscape/fx/audio klaar. |
| `td.audio.go` | Start, stopt of duckt audio. |
| `td.fx.trigger` | Vuurt een korte video/audio-fx af. |
| `td.webstage.prepare` | Laadt browser stage met vaste resolutie. |
| `td.webstage.show` | Toont browser stage/layer. |
| `td.webstage.hide` | Verbergt browser stage/layer. |
| `td.caption.update` | Zet captiontekst als TD-payload. |
| `td.caption.clear` | Leegt captionlaag. |
| `td.reset` | Terug naar veilige basisstaat. |
| `td.blackout` | Output zwart/noodstand. |

## Payloads

OSC moet snel en klein blijven. Daarom stuurt OSC alleen een `payloadId`. TD haalt grotere data via HTTP op bij Show Control.

```text
TouchDesigner -> Show Control
GET /api/show-control/payloads/:payloadId
```

Voorbeeld payload voor camera:

```json
{
  "cameraId": "camera_2"
}
```

Voorbeeld payload voor fase:

```json
{
  "phase": "cams"
}
```

Voorbeeld payload voor environment prepare:

```json
{
  "environmentId": "env_cafe",
  "assets": {
    "background": {
      "assetId": "asset_bg_cafe",
      "file": "/Volumes/ForYouMedia/environments/cafe/background.jpg"
    },
    "soundscape": {
      "assetId": "asset_sound_cafe",
      "file": "/Volumes/ForYouMedia/environments/cafe/soundscape.mp3"
    },
    "fx": [
      {
        "assetId": "asset_fx_doorbell",
        "file": "/Volumes/ForYouMedia/fx/doorbell.mp3"
      }
    ]
  },
  "webstages": [
    {
      "stageId": "chat_overlay",
      "url": "http://127.0.0.1:3000/stage",
      "width": 1920,
      "height": 1080
    }
  ]
}
```

Gebruik stabiele IDs voor logica. Namen zijn voor mensen, IDs zijn voor techniek.

## Ack Terugsturen

TD stuurt geen zware statusstream terug. Alleen lichte acknowledgements.

Voorbeelden:

```text
/td/ack cue-001 td.environment.prepare received ok ontvangen
/td/ack cue-001 td.environment.prepare loaded ok media_found
/td/ack cue-002 td.camera.set applied ok camera_2
/td/ack cue-003 td.asset.prepare loaded error file_missing
/td/ack cue-004 td.environment.go applied ok go_sent
```

Betekenis:

| Stage | Betekenis |
| --- | --- |
| `received` | TD heeft de cue ontvangen. |
| `loaded` | Vereiste media/state is gevonden of geladen. |
| `applied` | De cue is toegepast. |
| `warning` | Cue is ontvangen, maar er is iets verdachts. |
| `error` | TD kon de cue niet uitvoeren. |

Status is bedoeld voor dashboard en debugging. `go` wacht niet op deze acknowledgements.

## Copy-Paste Router

Plak dit in `td_cue_router`, het callbacks Text DAT van `oscin_td_cue`.

Pas daarna alleen de functies onder `TD ACTIES` aan naar de echte operatornamen in jullie TD-file.

```python
import json
import os
import urllib.request

SHOW_CONTROL_HTTP = 'http://127.0.0.1:9200'


def ack(cue_id, command, stage, status='ok', message=''):
    out = op('oscout_td_ack')
    if out is None:
        return
    out.sendOSC('/td/ack', [
        str(cue_id),
        str(command),
        str(stage),
        str(status),
        str(message)
    ])


def log_state(cue_id, command, stage, status, message=''):
    table = op('cue_state')
    if table is None:
        return
    if table.numRows == 0:
        table.appendRow(['cueId', 'command', 'stage', 'status', 'message'])
    table.appendRow([
        str(cue_id),
        str(command),
        str(stage),
        str(status),
        str(message)
    ])


def fetch_payload(payload_id):
    if not payload_id or payload_id == '-':
        return {}

    url = SHOW_CONTROL_HTTP + '/api/show-control/payloads/' + str(payload_id)
    with urllib.request.urlopen(url, timeout=1.0) as response:
        raw = response.read().decode('utf-8')
    return json.loads(raw)


def require_file(path):
    if not path:
        return
    if not os.path.exists(path):
        raise FileNotFoundError(path)


def check_assets(payload):
    assets = payload.get('assets') or {}

    for slot_name in ['background', 'soundscape']:
        asset = assets.get(slot_name)
        if asset:
            require_file(asset.get('file'))

    for asset in assets.get('fx') or []:
        require_file(asset.get('file'))

    for asset in assets.get('specials') or []:
        require_file(asset.get('file'))


# -------------------------------------------------------------------
# TD ACTIES
# Vervang hier de placeholder-regels door echte operatornamen.
# -------------------------------------------------------------------

def set_phase(payload):
    phase = payload.get('phase', '')
    # Voorbeeld:
    # op('/project1/phase_switch').par.index = {'inloop': 0, 'wait_operator': 1, 'cams': 2}[phase]
    return phase


def set_camera(payload):
    camera_id = payload.get('cameraId', '')
    # Voorbeeld:
    # op('/project1/camera_switch').par.index = {'camera_1': 0, 'camera_2': 1, 'camera_3': 2}[camera_id]
    return camera_id


def prepare_environment(payload):
    check_assets(payload)
    # Voorbeeld:
    # background = payload.get('assets', {}).get('background', {})
    # op('/project1/background_movie').par.file = background.get('file', '')
    return payload.get('environmentId', '')


def go_environment(payload):
    # Voorbeeld:
    # op('/project1/environment_crossfade').par.triggerpulse.pulse()
    return payload.get('environmentId', 'prepared')


def prepare_audio(payload):
    check_assets(payload)
    # Voorbeeld:
    # soundscape = payload.get('assets', {}).get('soundscape', {})
    # op('/project1/soundscape_audio').par.file = soundscape.get('file', '')
    return 'audio_ready'


def go_audio(payload):
    # Voorbeeld:
    # op('/project1/soundscape_audio').par.play = 1
    return payload.get('action', 'audio_go')


def trigger_fx(payload):
    # Voorbeeld:
    # op('/project1/fx_trigger').par.triggerpulse.pulse()
    return payload.get('fxId', 'fx')


def prepare_webstage(payload):
    # Voorbeeld:
    # op('/project1/webstage').par.url = payload.get('url', '')
    # op('/project1/webstage').par.resolutionw = int(payload.get('width', 1920))
    # op('/project1/webstage').par.resolutionh = int(payload.get('height', 1080))
    return payload.get('stageId', 'webstage')


def update_caption(payload):
    text = payload.get('text', '')
    # Voorbeeld:
    # op('/project1/caption_text').text = text
    return 'caption_update'


def reset_td(payload):
    # Voorbeeld:
    # op('/project1/reset_all').par.triggerpulse.pulse()
    return 'reset'


def blackout(payload):
    # Voorbeeld:
    # op('/project1/output_blackout').par.value0 = 1
    return 'blackout'


COMMANDS = {
    'td.phase.set': ('applied', set_phase),
    'td.camera.set': ('applied', set_camera),
    'td.environment.prepare': ('loaded', prepare_environment),
    'td.environment.go': ('applied', go_environment),
    'td.asset.prepare': ('loaded', prepare_environment),
    'td.audio.prepare': ('loaded', prepare_audio),
    'td.audio.go': ('applied', go_audio),
    'td.fx.trigger': ('applied', trigger_fx),
    'td.webstage.prepare': ('loaded', prepare_webstage),
    'td.webstage.show': ('applied', prepare_webstage),
    'td.webstage.hide': ('applied', prepare_webstage),
    'td.caption.update': ('applied', update_caption),
    'td.caption.clear': ('applied', update_caption),
    'td.reset': ('applied', reset_td),
    'td.blackout': ('applied', blackout),
}


def onReceiveOSC(dat, rowIndex, message, bytes, timeStamp, address, args, peer):
    if address != '/td/cue':
        return

    cue_id = str(args[0]) if len(args) > 0 else ''
    command = str(args[1]) if len(args) > 1 else ''
    payload_id = str(args[2]) if len(args) > 2 else '-'

    ack(cue_id, command, 'received', 'ok', 'ontvangen')
    log_state(cue_id, command, 'received', 'ok', payload_id)

    if command not in COMMANDS:
        ack(cue_id, command, 'warning', 'unknown_command', command)
        log_state(cue_id, command, 'warning', 'unknown_command', command)
        return

    stage, handler = COMMANDS[command]

    try:
        payload = fetch_payload(payload_id)
        result = handler(payload)
        ack(cue_id, command, stage, 'ok', result)
        log_state(cue_id, command, stage, 'ok', result)
    except Exception as error:
        ack(cue_id, command, 'error', 'failed', str(error))
        log_state(cue_id, command, 'error', 'failed', str(error))
```

## Hoe Je Dit In TD Gebruikt

1. Maak `/project1/show_control`.
2. Voeg `oscin_td_cue`, `oscout_td_ack`, `td_cue_router`, `cue_state` en eventueel `media_registry` toe.
3. Zet `oscin_td_cue` op poort `9100`.
4. Zet `oscin_td_cue` callbacks naar `td_cue_router`.
5. Zet `oscout_td_ack` naar Show Control host en poort `9101`.
6. Plak het script in `td_cue_router`.
7. Vervang alleen de functies onder `TD ACTIES` door jullie echte TD-operatornamen.
8. Test eerst `td.phase.set`, daarna `td.camera.set`, daarna pas media/assets.

## Testvolgorde

Begin klein:

1. `td.phase.set` naar `inloop`.
2. `td.phase.set` naar `cams`.
3. `td.camera.set` naar `camera_1`, `camera_2`, `camera_3`.
4. `td.environment.prepare` met één bestaande background.
5. `td.environment.go`.
6. `td.audio.prepare` met één bestaande mp3.
7. `td.fx.trigger`.
8. `td.webstage.prepare` met vaste resolutie.
9. `td.caption.update`.

Pas als dit stabiel is, samengestelde cues testen.

## Samengestelde Cue

Show Control mag één cue maken met meerdere acties:

```json
{
  "cueId": "cue-start-situation-042",
  "actions": [
    {
      "command": "td.environment.prepare",
      "payloadId": "payload-env-cafe",
      "mode": "required-ready"
    },
    {
      "command": "td.phase.set",
      "payloadId": "payload-phase-cams",
      "delayMs": 0,
      "mode": "acknowledged"
    },
    {
      "command": "td.camera.set",
      "payloadId": "payload-camera-2",
      "delayMs": 20,
      "mode": "acknowledged"
    },
    {
      "command": "td.environment.go",
      "payloadId": "payload-env-cafe",
      "delayMs": 40,
      "mode": "non-blocking"
    }
  ]
}
```

Dit voelt voor de operator als één knop, maar technisch worden de acties met kleine tussenstapjes gestuurd. Dat is bewust: sommige apparaten of TD-patches worden onrustig als alles exact tegelijk binnenkomt.

## Niet Doen

- Geen losse OSC-poort per TD-onderdeel.
- Geen volledige cataloguslijst naar TD sturen.
- Geen promptbouw in TD.
- Geen runtime/order-state in TD.
- Geen Dropbox/CSV/file polling als waarheid voor huidige environment.
- Geen zware constante preview/status terugsturen als dat performance kost.
- Geen 4K browserstage als 1080p genoeg is.

## Vuistregel

```text
Runtime kiest.
Show Control orkestreert.
TouchDesigner voert uit.
TouchDesigner stuurt lichte feedback terug.
```

