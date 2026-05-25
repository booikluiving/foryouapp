# For You Nieuwe Architectuur

Dit is de werkversie voor de fundamentele opschoning van For You.

Deze documentatie beschrijft het doelsysteem. Het is geen beschrijving van wat de huidige app-code al doet.

## Hoofdbesluit

For You wordt ontworpen als zeven los opererende modules plus een Gateway / Dashboard:

- Catalog Service;
- Paths Service;
- Algorithm Service;
- Runtime Service;
- Show Control Service;
- Audience Service;
- Script Agent Service;
- Gateway / Dashboard.

Daarnaast is er een eenvoudige Dropbox backup mirror. Die is ondersteunend, maar geen live domeinservice.

Elke service heeft in het doelbeeld:

- een eigen Express server;
- een eigen database;
- een eigen verantwoordelijkheid;
- eigen API-routes;
- live events waar dat nodig is.

Services delen contracten, schemas en minimale clients. Ze delen geen interne businesslogica.

## Waarom

De huidige architectuur heeft te veel domeinen in dezelfde laag gekregen. Catalogus, paden, runtime/order-state, algoritme, promptbouw, visualisaties en integraties hangen daardoor aan dezelfde centrale knoop.

Het nieuwe ontwerp maakt de grenzen hard:

| Domein | Eigenaar |
| --- | --- |
| Brondata | Catalog Service |
| Voorbereidende padenregels | Paths Service |
| Situation scoring | Algorithm Service |
| Live run state | Runtime Service |
| Technische cue-uitvoering | Show Control Service |
| Publieksapp, chat en signalen | Audience Service |
| AI-script, parser, teleprompter en captions | Script Agent Service |
| Dropbox backup en restore | Backup mirror tool |
| Bediening en visualisatie | Gateway / Dashboard |

## Kernflow

Voor een run mogen catalogus, paden en algorithm-config worden bewerkt.

Bij start run:

1. Runtime Service haalt een catalogus snapshot op.
2. Runtime Service haalt een paden snapshot op.
3. Runtime Service haalt een algorithm-config snapshot op.
4. Runtime Service bewaart die drie als showRunSnapshot.
5. De actieve run werkt alleen op die bevroren snapshot.

Tijdens de run:

1. Paths bepaalt pathAvailable en pathLocked.
2. Runtime past harde volgorderegels toe.
3. Runtime leest situation scores van Algorithm.
4. Runtime kiest preparedNext.
5. Runtime materialiseert resolvedPreparedNext.
6. Show Control vuurt technische cues af naar TD, audio, licht, camera's en bediening.
7. Script Agent bouwt/verwerkt scripttekst, parser-output, teleprompter en captions op basis van Runtime-output.
8. Integraties lezen Runtime-output, Script Agent-output of Show Control-status, afhankelijk van hun rol.

Algorithm kiest niet, rankt geen volgorde en schrijft geen order-state. Algorithm publiceert alleen scores. Runtime gebruikt die scores binnen eigen regels om te kiezen en schrijft live state.
Show Control kiest geen situatie. Show Control voert cues uit en bewaakt of targets reageren.

## Documenten

- [Catalogus als bronmodel](01-catalogus-bronmodel.md)
- [Runtime en volgorde contract](02-runtime-volgorde-contract.md)
- [Losgekoppelde services doelarchitectuur](03-losgekoppelde-services.md)
- [Show Control cue protocol](04-show-control-cue-protocol.md)
- [TouchDesigner command surface](05-touchdesigner-command-surface.md)
- [TouchDesigner cheat sheet](06-touchdesigner-cheat-sheet.md)
- [Algorithm service contract](07-algorithm-service-contract.md)
- [V2 implementatieplan](08-v2-implementatieplan.md)

## Belangrijkste Diagrammen

- [Module map](diagrams/service-module-map.mmd)
- [Doelarchitectuur services](diagrams/doelarchitectuur-services.mmd)
- [Start run snapshot flow](diagrams/start-run-snapshot-flow.mmd)
- [Prepared next service flow](diagrams/prepared-next-service-flow.mmd)
- [Live consumers flow](diagrams/live-consumers-flow.mmd)
- [Verantwoordelijkheidsgrenzen](diagrams/verantwoordelijkheidsgrenzen.mmd)
- [Show Control service](diagrams/show-control-service.mmd)
- [Algorithm service contract](diagrams/algorithm-service-contract.mmd)
- [Audience signals to score](diagrams/audience-signals-to-score.mmd)
- [Algorithm runtime boundary](diagrams/algorithm-runtime-boundary.mmd)
- [TouchDesigner command surface](diagrams/touchdesigner-command-surface.mmd)
- [TouchDesigner command list](diagrams/touchdesigner-command-list.mmd)
- [TouchDesigner cue protocol](diagrams/td-cue-protocol.mmd)
- [Cue snelheid en ack modes](diagrams/cue-lifecycle-ack.mmd)
- [Catalogus bronmodel](diagrams/catalogus-bronmodel.mmd)
- [Catalogus / algoritme grens](diagrams/catalogus-algoritme-grens.mmd)
- [Runtime / volgorde contract](diagrams/runtime-volgorde-contract.mmd)

## Niet In Scope Van Dit Document

Deze documentatie verandert geen app-code.

Nog niet vastgelegd:

- migratievolgorde;
- exacte poortnummers;
- exacte databasebestanden;
- definitieve request/response schemas;
- hoe de oude endpoints tijdelijk compatibel blijven.
- implementatie van de Dropbox backup mirror.
