# Paths Editor implementatienotitie

## Uitgangspunt

- De editor heeft: dezelfde HTML/CSS layout, chipbar, canvas, inspector, minimap, testmodus, path modal, kleurkiezer, drag/drop nodes, edge editing, eindnode-toggle, blokkade-toggle en funnel-stepper.
- `paden-graph.js` is als lokale rules-engine overgenomen. Daarmee blijven layout, startnode-detectie, edges, optional/loop edges, funnels, crossing thresholds, eindnodes, blokkades en path-statussen gelijk aan de V1 editor.
- De editor-state heeft voor de UI deze vorm: `catalog.scenes`, `catalog.paths`, `catalog.crossingThresholds`, `characters`, `situations` en `environments`.

## grenzen

- Mutaties gaan alleen naar de Paths store: `modules/paths/db/paths-store.json` of `PATHS_STORE_PATH`.
- Paths bepaalt alleen path available / path locked / blocked / played op basis van meegegeven facts. De module kiest geen runtime volgorde, preparedNext, scores, queue of show-control acties.
- Catalogusdata wordt niet door Paths geschreven. De editor leest catalogusvelden via de lokale read-only adapter zodat paths-logica en catalogusmutaties gescheiden blijven.

## API

- `GET /health`
- `GET /v0/paths/read-model`
- `GET /v0/paths/editor-state`
- `POST /v0/paths/paths/upsert`
- `PUT /v0/paths/paths/:id`
- `POST /v0/paths/crossing-thresholds/upsert`
- `PUT /v0/paths/crossing-thresholds/:sceneId`
- `POST /v0/paths/archive`
- `POST /v0/paths/delete`
- `POST /v0/paths/evaluate`
- `GET /v0/paths/validation`

## Tests

- `tests/unit-test.js` bewijst startnodes, locked successors, played facts, crossing thresholds en validatie.
- `tests/smoke-test.js` start de service, test health, read-model, editor-state, save/load, validation, evaluate en snapshot creation met een tijdelijke store.

# Universe implementatienotitie

## Uitgangspunt

- De Universe UI is mechanisch overgenomen uit `For_universe/src/public`: `index.html`, `stage.html`, `styles.css`, `sky-layout.js`, `sky-data-adapter.js`, `sky-renderer.js`, `app.js` en `stage-app.js`.
- De graph-normalisatie is overgenomen uit `For_universe/src/domain/normalize-paths.js`, zodat de termen, netwerkmap, crossings, loose scenes, node/edge rollen en samenvattingen dezelfde vorm houden als V1.
- Layout, kleuren, Big Bang/netwerkkaart wissel, labels/lijnen/losse-scenes/debug toggles, hover panel, info panel, stage output en motion controls blijven in de overgenomen UI gelijk aan V1.

## grenzen

- Universe draait binnen de Paths module en leest alleen de Paths editor-state via `buildPathsEditorState`.
- De adapter `universe/build-universe-state.js` vertaalt paths, nodes, edges, start/eindnodes, thresholds en blokkades naar de Universe graph-vorm.
- Universe schrijft niets naar Paths, Runtime, Algorithm, Catalog of Show Control.
- De gewone Universe pagina gebruikt `/v0/paths/universe-state`.
- Runtime live overlay is nog niet gekoppeld. De endpoint geeft bewust `runtime: null` terug met `source.runtimeOverlay: "not_connected"`, zodat de statische netwerkkaart werkt zonder Runtime-logica te mengen.
- De Universe Testpad-modus is client-side simulatie bovenop `POST /v0/paths/evaluate`. Klikken op vrije sterren voegt die situatie toe aan de gespeelde lijst; de volgende vrije/wacht/geblokkeerde status komt telkens uit dezelfde Paths rules-engine als de editor.

## API

- `GET /v0/paths/universe-state`
- `GET /universe/`
- `GET /universe/stage`
- `POST /v0/paths/evaluate` voor Universe Testpad

## Tests

- `tests/smoke-test.js` controleert naast de bestaande Paths checks ook `universe-state`, de Universe pagina, Testpad UI, de endpointverwijzingen in `app.js`, scene-click handling in de renderer en dat oude graph endpoints niet meer door de Universe pagina gebruikt worden.
- Browser-automatie is niet in deze implementatie-run uitgevoerd, omdat de beschikbare Playwright-wrapper een npm download van `@playwright/cli` vereiste en die escalatie is geweigerd. De module is wel via HTTP-smoke en JS syntaxchecks gecontroleerd.
