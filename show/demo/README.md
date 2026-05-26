# For You TouchDesigner Demo

Dit mapje is een losse demo voor Jilles. Het laat zien hoe de For You Q-hub cues in TouchDesigner binnenkomen, hoe ze worden geroute, en hoe een environment background wordt geladen.

## Snel Starten

Dubbelklik op:

```text
start-demo.command
```

Dit opent een Terminal-venster, start de demo-server, opent de demo-webpagina en opent de TouchDesigner-file. Laat het Terminal-venster open zolang je de demo gebruikt.

De webpagina is:

```text
http://127.0.0.1:3035
```

Zie je in je browser iets met "Show Control"? Dan zit je op de verkeerde pagina. De demo gebruikt `3035`, niet `3025`.

## Handmatig Starten

1. Open Terminal in deze map:

   ```sh
   cd /pad/naar/show/demo
   ```

2. Start de demo-server:

   ```sh
   node demo-server.js
   ```

   Op macOS kan ook `start-demo.command` dubbelgeklikt worden.

3. Open `ForYou TD Demo.toe` in TouchDesigner.

4. Open de webpagina:

   ```text
   http://127.0.0.1:3035
   ```

5. Klik op de knoppen in de webpagina.

## Wat je hoort te zien

- `Prepare Tennis`, `Prepare Ziekenhuis` en `Prepare Keuken` laten `trigger_start_run_prepare` oplichten.
- De Movie File In TOP `prepared_background` toont het gekozen plaatje.
- `Start Situatie` laat `trigger_start_situation_go` oplichten.
- `Stop + Prepare Next` laat `trigger_stop_situation_prepare_next` oplichten en kiest de volgende demo-omgeving.
- `Camera 1`, `Camera 2` en `Camera 3` laten de bijbehorende camera-trigger in TouchDesigner oplichten.
- De webpagina toont de laatste cue en de laatste ack die van TouchDesigner terugkomt.

## Poorten

De demo gebruikt standaard:

```text
3035  webpagina + payload API
3031  catalog/media API
9110  OSC naar TouchDesigner
9111  ack terug van TouchDesigner
```

Als een poort bezet is, stopt de server met een foutmelding. Sluit dan de andere app die die poort gebruikt, bijvoorbeeld een draaiende ForYou Show Control, en start opnieuw.

Voor een tijdelijke test kun je andere poorten kiezen:

```sh
DEMO_UI_PORT=3045 DEMO_CATALOG_PORT=3041 DEMO_TD_OSC_PORT=9120 DEMO_TD_ACK_PORT=9121 node demo-server.js
```

Let op: de meegeleverde TouchDesigner-file luistert standaard op `9110` en stuurt acks naar `9111`, dus voor de normale demo zijn de standaardpoorten het handigst.

## Inhoud

```text
show/demo/
  ForYou TD Demo.toe
  demo-server.js
  README.md
  UITLEG.md
  start-demo.command
  assets/
    tennis.jpg
    ziekenhuis.jpg
    keuken.jpg
```

Er is geen `npm install` nodig. De server gebruikt alleen standaard Node.js modules.
