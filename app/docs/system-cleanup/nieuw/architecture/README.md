# Architecture Maps

Deze map is een losse documentatielaag voor de dataflow en projectstructuur van For You. Het is bewust geen extra webpagina in de app.

Open eerst:

- [00-overzicht.md](00-overzicht.md)
- [01-catalogus-bronmodel.md](01-catalogus-bronmodel.md)
- [02-runtime-volgorde-contract.md](02-runtime-volgorde-contract.md)
- [03-losgekoppelde-services.md](03-losgekoppelde-services.md)
- [04-show-control-cue-protocol.md](04-show-control-cue-protocol.md)
- [05-touchdesigner-command-surface.md](05-touchdesigner-command-surface.md)
- [06-touchdesigner-cheat-sheet.md](06-touchdesigner-cheat-sheet.md)
- [07-algorithm-service-contract.md](07-algorithm-service-contract.md)

De Mermaid-bronbestanden staan in `diagrams/`. De afgeleide kaarten staan in `generated/` en worden opnieuw opgebouwd met:

```bash
npm run docs:architecture
```

## Wat zit hierin

- `diagrams/system-context.mmd`: hoofdcomponenten en externe systemen.
- `diagrams/audience-session-flow.mmd`: QR, sessie, chat, polls en engagement.
- `diagrams/algorithm-scene-flow.mmd`: score feed, runtime-keuze, situatie-start/einde en outputs.
- `diagrams/teleprompter-camera-flow.mmd`: teleprompter, ready/reveal en camera-pulsen.
- `diagrams/integration-sidecars.mmd`: Show Control, TouchDesigner, SQ5, Camera Control, DMX/licht en Stream Deck.
- `diagrams/database-model.mmd`: vereenvoudigd datamodel.
- `generated/routes.md`: actuele Express-routes uit de code.
- `generated/sqlite-schema.md`: SQLite-tabellen uit de code.
- `generated/code-deps.mmd`: module-dependency kaart uit `require(...)`.
- `diagrams/catalogus-bronmodel.mmd`: werkkaart voor catalogus als bron van het systeem.
- `diagrams/catalogus-algoritme-grens.mmd`: werkkaart voor de grens tussen catalogus en algoritme.
- `diagrams/catalogus-entiteiten.mmd`: werkkaart voor catalogustabellen en runtime-grens.
- `diagrams/runtime-volgorde-contract.mmd`: werkkaart voor showRun, situationRun, preparedNext en pathLocked.
- `diagrams/service-module-map.mmd`: doelbeeld voor mapstructuur met zeven module-eilanden plus Gateway.
- `diagrams/doelarchitectuur-services.mmd`: doelbeeld met zeven losse modules, eigen DB's en API/event-communicatie.
- `diagrams/start-run-snapshot-flow.mmd`: start run flow waarin Runtime catalogus, paden en algorithm-config bevriest.
- `diagrams/prepared-next-service-flow.mmd`: flow waarin Paths vrijgave bepaalt, Algorithm scores levert en Runtime kiest.
- `diagrams/live-consumers-flow.mmd`: consumers die Runtime-output lezen in plaats van editor-data.
- `diagrams/verantwoordelijkheidsgrenzen.mmd`: write/read-grenzen per service.
- `diagrams/show-control-service.mmd`: Show Control als cue orchestrator tussen Runtime en hardware.
- `diagrams/algorithm-service-contract.mmd`: Algorithm Service als scoremachine buiten paden/order/preparedNext.
- `diagrams/audience-signals-to-score.mmd`: flow van actieve situatie naar observed score en dynamische predicted scores.
- `diagrams/algorithm-runtime-boundary.mmd`: harde grens tussen Algorithm scores en Runtime volgorde.
- `diagrams/touchdesigner-command-surface.mmd`: opgeschoond TD-oppervlak met een OSC-controlpoort, payloads, assets en webstages.
- `diagrams/touchdesigner-command-list.mmd`: commandlijst voor fases, camera's, environment/assets, webstages, captions en status.
- `diagrams/td-cue-protocol.mmd`: voorgesteld TouchDesigner cue/ack protocol.
- `diagrams/cue-lifecycle-ack.mmd`: cue snelheid en ack modes: fire-and-forget, acknowledged async en required-ready.

## Werkwijze

Pas de handgeschreven diagrammen in `diagrams/` aan wanneer het conceptuele systeem verandert. Draai daarna `npm run docs:architecture`; dat werkt `00-overzicht.md` en de gegenereerde kaarten bij.
