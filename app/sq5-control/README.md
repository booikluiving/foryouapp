# SQ5 Control

Productie-bridge voor de Allen & Heath SQ-5 in de For You app. De SQ-5 luistert niet native naar OSC; deze bridge vertaalt HTTP en OSC naar Allen & Heath MIDI-over-TCP op poort `51325`.

De webinterface toont verticale live faders voor:

```text
Brent, Megan, Booi, Mac, Studio, MiniJack, Mics, Muziek, Sub, Main
```

## Start

Vanaf de repo-root:

```bash
SQ5_HOST=192.168.1.129 node app/sq5-control/server.js
```

Open:

```text
http://127.0.0.1:3105
```

Optionele env-vars:

```bash
SQ5_HOST=192.168.1.x \
SQ5_MIXER_PORT=51325 \
SQ5_MIDI_CHANNEL=1 \
SQ5_FADER_LAW=linear \
SQ5_OSC_PORT=53000 \
SQ5_STATUS_POLL_MS=1500 \
node app/sq5-control/server.js
```

## Mapping

```text
Brent       input 1
Megan       input 2
Booi        input 3
Mac         input 5
Studio      input 6
MacStudio   inputs 5+6 gekoppeld
MiniJack    inputs 7+8 gekoppeld
Mics        Group 1
Muziek      Group 2
Sub         Matrix 1
Main        Main LR
```

## Stream Deck / Companion

Gebruik voor Bitfocus Companion bij voorkeur HTTP, niet OSC. HTTP geeft responses terug en is makkelijker te gebruiken voor button feedback.

### Polling endpoint

Laat Companion elke `500ms` tot `1000ms` pollen:

```text
GET http://127.0.0.1:3105/api/streamdeck/state
```

Voorbeeld-response:

```json
{
  "brent": true,
  "megan": true,
  "booi": false,
  "allMics": false,
  "allMicsMixed": true,
  "mac": false,
  "studio": false,
  "macstudio": false,
  "minijack": true,
  "mics": true,
  "muziek": false,
  "sub": false,
  "main": false,
  "lastSyncAt": "2026-05-18T13:55:13.118Z"
}
```

Betekenis:

```text
true  = muted
false = unmuted
null  = nog geen state bekend
```

Gebruik voor feedback in Companion deze velden:

```text
brent
megan
booi
allMics
allMicsMixed
main
```

Voor kleurfeedback:

```text
muted true       rood / tekst MUTED
muted false      groen of donker / tekst ON
allMicsMixed     amber / tekst MIXED
```

### Stream Deck actie endpoints

Gebruik `toggle` voor gewone mute/unmute knoppen. De bridge bepaalt op basis van de laatst bekende SQ-state of hij moet muten of unmuten.

```text
POST http://127.0.0.1:3105/api/streamdeck/brent/toggle
POST http://127.0.0.1:3105/api/streamdeck/megan/toggle
POST http://127.0.0.1:3105/api/streamdeck/booi/toggle
POST http://127.0.0.1:3105/api/streamdeck/allmics/toggle
POST http://127.0.0.1:3105/api/streamdeck/main/toggle
```

Expliciet kan ook:

```text
POST /api/streamdeck/brent/mute
POST /api/streamdeck/brent/unmute
POST /api/streamdeck/main/mute
POST /api/streamdeck/main/unmute
```

Alle beschikbare Stream Deck targets:

```text
brent
megan
booi
allmics
mac
studio
macstudio
minijack
mics
muziek
sub
main
```

## OSC

OSC blijft beschikbaar voor TouchDesigner of andere show-control:

```text
host: <bridge-computer-ip>
port: 53000
```

Mute/unmute:

```text
/sq/input/brent/mute       1|0
/sq/input/megan/mute       1|0
/sq/input/booi/mute        1|0
/sq/input/mac/mute         1|0
/sq/input/studio/mute      1|0
/sq/input/macstudio/mute   1|0
/sq/input/minijack/mute    1|0

/sq/mics/mute              1|0
/sq/muziek/mute            1|0
/sq/sub/mute               1|0
/sq/main/mute              1|0
```

Levels blijven beschikbaar via dezelfde namen:

```text
/sq/input/macstudio/level  -14
/sq/input/minijack/level   -7
/sq/mics/level             -3
/sq/muziek/level           -22
/sq/sub/level              -34
/sq/main/level             -1
```

## Algemene HTTP API

Status:

```bash
curl -s http://127.0.0.1:3105/api/status
```

Handmatige sync:

```bash
curl -s -X POST http://127.0.0.1:3105/api/sync
```

Input mute:

```bash
curl -X POST http://127.0.0.1:3105/api/input/brent/mute \
  -H 'content-type: application/json' \
  -d '{"muted":true}'
```

Output mute:

```bash
curl -X POST http://127.0.0.1:3105/api/output/main/mute \
  -H 'content-type: application/json' \
  -d '{"muted":true}'
```

Read-only Stream Deck state:

```bash
curl -s http://127.0.0.1:3105/api/streamdeck/state
```

## Verify

Protocol fixtures:

```bash
node app/sq5-control/test-sq-midi.js
```

Read-only outputscan:

```bash
node app/sq5-control/scan-sq-outputs.js 192.168.1.129
```

Read-only volledige bridge scan:

```bash
node app/sq5-control/scan-bridge-state.js
```
