# Repo Reality Check - 2026-05-26

Dit rapport bewaart de auditbevindingen van 2026-05-26, zodat een latere debugronde niet opnieuw bij nul hoeft te beginnen.

## Kort oordeel

De V2-code volgt de nieuwe architectuur op hoofdlijn: Runtime bezit volgorde en live run state, Algorithm scoort, Show Control voert cues uit, Script Agent bezit prompt/script/teleprompter/captions, en Gateway blijft dun.

De grootste risico's zitten niet in de basisverdeling, maar in verouderde documentatie, te grote opgeslagen cue-resultaten en een paar servicegrenzen die in uitzonderingspaden lekken.

## Wat klopt goed

- Runtime weigert Algorithm-payloads met runtime-eigenaarsvelden zoals `preparedNext`, `resolvedPreparedNext`, `activeSituation`, `playedSituations` en `order`.
- `startRun`, `startSituation` en `stopSituation` volgen het doelmodel: Runtime maakt snapshots, materialiseert `preparedNext`, promoveert naar `activeSituation` en beheert played state.
- `stopSituation` reageert snel en zet finalisatie daarna in een queue, zodat Show Control niet onnodig hoeft te wachten.
- Show Control heeft een echte cue hub met prepare/go/compound flows en aparte adapters.
- De prepared-next flow gebruikt inmiddels compact `runtimeOutput` richting Script Agent.
- Algorithm weigert runtime/order/promptvelden en blijft in de kern scoremachine.

## Belangrijkste risico's

1. Show Control slaat te veel Runtime-state op.
   Runtime-adapter-resultaten bewaren volledige `runtimeState` in cue-resultaten. Daardoor werd `modules/show-control/db/cues.json` ongeveer 80 MB voor 391 cues. Dit is bloat en een domeinlek: Show Control hoort status, route en compacte referenties te bewaren, niet volledige Runtime snapshots.

2. De cue-store herschrijft het hele JSON-bestand.
   `saveCue` leest de hele cue-array, past een cue aan en schrijft alles terug. Dat werkt voor kleine aantallen, maar wordt kwetsbaar zodra cue-resultaten groot blijven.

3. Script Agent importeert Catalog internals als fallback.
   `modules/script-agent/client/catalog-client.js` gebruikt `modules/catalog/read-model/build-read-model` direct wanneer de Catalog HTTP-service niet beschikbaar is. Dat is praktisch, maar niet zuiver volgens de servicegrenzen.

4. Teleprompter end-scene kan Show Control omzeilen.
   De bridge probeert eerst Show Control, maar valt bij error terug op een directe Runtime `stop-situation`. Dat kan nuttig zijn in nood, maar het maakt een verborgen pad buiten de Show Control audit/queue.

5. Audience doet live-score orkestratie.
   Audience leest Runtime, stuurt signalen naar Algorithm en stuurt scoreFeed terug naar Runtime. Dat werkt, maar Audience is daarmee meer dan alleen publieke signal input. Documenteer dit expliciet of verplaats het later naar een duidelijkere dispatcher.

## Documentatiebesluit

De oude top-level architectuurdocs, `docs/system-cleanup/oud` en de stale generated kaarten binnen `nieuw` zijn verwijderd. De handgeschreven docs en Mermaid-diagrammen onder `docs/system-cleanup/nieuw/architecture` zijn nu leidend.

Generated route-, SQLite- en dependency-kaarten mogen pas terugkomen als er een V2-generator is die de huidige `modules/`, `gateway/` en `shared/` werkelijkheid leest.

## Aanbevolen volgende sanering

1. Maak Show Control adapter results compact: bewaar route, command, showRunId, situationId, target status en waarschuwingen, niet volledige `runtimeState`.
2. Voeg pruning of opslag per cue toe aan Show Control, of verplaats cue history naar SQLite.
3. Verwijder of expliciteer de Script Agent catalog fallback.
4. Maak teleprompter end-scene fail-visible als Show Control niet beschikbaar is, tenzij directe Runtime fallback bewust als noodpad wordt gehouden.
5. Werk de architectuurdocs bij wanneer Audience live-score dispatcher bewust onderdeel van het ontwerp blijft.

## Update

De eerste sanering is direct daarna opgepakt: Show Control runtime-adapter results worden compact opgeslagen als `runtimeStateRef`, en bestaande cue-history kan non-destructief worden gecompact met een backup via `npm run show-control:cues:compact -- --write`.
