# For_universe

For_universe is de Big Bang / sterrenbeeld-visualisatielaag van de For You app.

Het is geen losse runtime-app meer. De code staat nog in een aparte map zodat de visualisatie overzichtelijk blijft, maar hij draait binnen dezelfde For You server, op dezelfde poort en tegen dezelfde SQLite database.

## Routes

Start de normale For You app:

```bash
cd ../app
npm start
```

Open daarna:

```txt
http://127.0.0.1:3010/universe
http://127.0.0.1:3010/universe/stage
```

De bestaande For You stage blijft bestaan op:

```txt
http://127.0.0.1:3010/stage
```

## Databron

De enige canonieke bron is:

```txt
../app/data/live.sqlite
```

For_universe gebruikt geen eigen database en leest niet meer uit `../star-map/data/live.sqlite`.

De verbinding blijft read-only. Universe visualiseert paden, scenes, sessies en runs, maar schrijft niets terug.

## API

De API hangt onder de For You server:

- `GET /api/universe/health`
- `GET /api/universe/source-schema`
- `GET /api/universe/graph`
- `GET /api/universe/runtime`

De publieke interface en stage gebruiken dezelfde endpoints.

## Projectvorm

- `src/public`: browser assets, operator-view en stage-output.
- `src/domain`: normalisatie, runtime-state en graph-model voor visualisatie.
- `src/data`: read-only SQLite queries tegen `app/data/live.sqlite`.
- `src/integration`: Express-integratie voor de For You server.

`server.js` is bewust gedeactiveerd. Start For_universe niet op een aparte poort; gebruik de For You app.

## Checks

```bash
npm run check
npm run test:runtime-filter
npm run audit:data
```

`audit:data` vergelijkt de canonieke app-database met de oude star-map-kopie en rapporteert verschillen. Het importeert of wijzigt niets.

## Begrippen

- `path`: rij uit `algorithm_paths`
- `node`: scene binnen een pad, uit `algorithm_path_scenes` plus `algorithm_scenes`
- `edge`: verbinding uit `algorithm_path_edges`
- `entry`: afgeleide start/ingang binnen een route
- `end`: expliciete eindnode via `is_end_node`
- `isolated`: node in een pad zonder inkomende en uitgaande edge
- `unassigned`: scene die in geen enkel pad voorkomt
- `crossing`: scene die in meerdere paden voorkomt

De frontend mag deze nodes visueel als sterren renderen; de databron blijft het bestaande For You algoritme- en padensysteem.
