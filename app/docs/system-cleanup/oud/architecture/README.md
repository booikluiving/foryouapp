# Architecture Maps

Deze map is een losse documentatielaag voor de dataflow en projectstructuur van For You. Het is bewust geen extra webpagina in de app.

Open eerst:

- [00-overzicht.md](00-overzicht.md)

De Mermaid-bronbestanden staan in `diagrams/`. De afgeleide kaarten staan in `generated/` en worden opnieuw opgebouwd met:

```bash
npm run docs:architecture
```

## Wat zit hierin

- `diagrams/system-context.mmd`: hoofdcomponenten en externe systemen.
- `diagrams/audience-session-flow.mmd`: QR, sessie, chat, polls en engagement.
- `diagrams/algorithm-scene-flow.mmd`: catalogus, ranking, scene-start/einde en outputs.
- `diagrams/teleprompter-camera-flow.mmd`: teleprompter, ready/reveal en camera-pulsen.
- `diagrams/integration-sidecars.mmd`: TouchDesigner, SQ5, Camera Control en Stream Deck.
- `diagrams/database-model.mmd`: vereenvoudigd datamodel.
- `generated/routes.md`: actuele Express-routes uit de code.
- `generated/sqlite-schema.md`: SQLite-tabellen uit de code.
- `generated/code-deps.mmd`: module-dependency kaart uit `require(...)`.

## Werkwijze

Pas de handgeschreven diagrammen in `diagrams/` aan wanneer het conceptuele systeem verandert. Draai daarna `npm run docs:architecture`; dat werkt `00-overzicht.md` en de gegenereerde kaarten bij.
