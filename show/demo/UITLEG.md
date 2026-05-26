# Uitleg in gewone taal

Deze demo bestaat uit twee delen:

- een kleine lokale webserver met knoppen
- een TouchDesigner-project dat OSC cues ontvangt

De webserver speelt in deze demo de rol van Show Control. TouchDesigner hoeft dus niet met de echte ForYou-stack te praten.

## De route van een cue

Als je op een knop klikt, maakt de webserver een cue. Daarna stuurt hij een klein OSC-bericht naar TouchDesigner:

```text
/td/cue cueId command payloadId
```

Dat bericht komt binnen in TouchDesigner bij:

```text
/project1/oscin_td_cue
```

Die OSC In DAT roept de Python-router aan:

```text
/project1/td_qhub_router
```

De router haalt daarna de volledige payload op bij de webserver:

```text
http://127.0.0.1:3035/api/show-control/payloads/:payloadId
```

Dat is waarom het OSC-bericht zelf klein kan blijven. OSC zegt alleen welke cue het is; de echte inhoud wordt via HTTP opgehaald.

In deze losse demo is de webpagina:

```text
http://127.0.0.1:3035
```

De echte ForYou Show Control gebruikt vaak `3025`. Daarom gebruikt deze demo bewust `3035`, zodat je niet per ongeluk naar het verkeerde scherm kijkt.

## Hoe TouchDesigner kiest welke trigger oplicht

De payload heeft een `command`, bijvoorbeeld:

```text
td.environment.prepare
td.environment.go
td.camera.set
td.status.heartbeat
```

De router vertaalt die naar een zichtbare trigger-node:

```text
td.environment.prepare  -> trigger_start_run_prepare
td.environment.go       -> trigger_start_situation_go
td.camera.set camera 1  -> trigger_camera_1
td.camera.set camera 2  -> trigger_camera_2
td.camera.set camera 3  -> trigger_camera_3
```

Elke trigger-node heeft eigen logs en een `visual_state` Text DAT. Zo kun je zien welke cue geraakt is, welke payload erbij hoorde, en welke status de router heeft teruggestuurd.

## Hoe assets worden geladen

Bij een prepare-cue zet de webserver het gekozen background asset in de payload. Daarin staat onder andere:

```text
environmentId
assetId
filePath
backgroundAsset
```

De `filePath` is een absoluut pad naar een bestand in deze demo-map, bijvoorbeeld:

```text
/.../show/demo/assets/tennis.jpg
```

TouchDesigner leest dat pad uit de payload en zet het op:

```text
/project1/prepared_background
```

Dat is een Movie File In TOP. Daarom verandert het plaatje wanneer je `Prepare Tennis`, `Prepare Ziekenhuis` of `Prepare Keuken` klikt.

## Hoe acks teruggaan

Als TouchDesigner klaar is met verwerken, stuurt de router een ack terug:

```text
/td/ack cueId command stage status message
```

Die ack gaat via:

```text
/project1/oscout_td_ack
```

terug naar de demo-server op poort `9111`. De webpagina toont de laatste ack, zodat je kunt zien dat TouchDesigner echt heeft gereageerd.

## Camera knoppen

De knoppen `Camera 1`, `Camera 2` en `Camera 3` sturen echte `td.camera.set` cues. In deze demo laten ze alleen de bijbehorende trigger-node oplichten.

Ze schakelen dus nog geen echte camera-feed. De logica is wel klaar om later aan een Switch TOP of een echte camera-compositie te koppelen:

```text
camera 1 -> trigger_camera_1
camera 2 -> trigger_camera_2
camera 3 -> trigger_camera_3
```

De volgende stap zou zijn om in de router of in TouchDesigner zelf te zeggen: als `trigger_camera_2` geraakt wordt, zet dan een Switch TOP naar input 2.
