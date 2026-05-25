# For You V2

Deze repo-root is de nieuwe V2-app. De oude V1-app staat onder `legacy/` en blijft alleen referentie, importbron of oracle voor expliciete tools.

## Structuur

```text
.
├── gateway/       # V2 dashboard/router, geen domeinlogica
├── modules/       # Losse V2 services
├── shared/        # Gedeelde contracten en UI-basics
├── shadow-run/    # Dev-only vergelijking met legacy/oracle
├── cutover/       # Overgangsplannen
├── docs/          # Architectuur- en projectdocs
└── legacy/        # V1 app en oude supportmodules
```

## Legacy Conventie

Default legacy root:

```text
./legacy
```

Tools die legacy als bron/oracle nodig hebben mogen dit overschrijven met:

```text
V2_LEGACY_ROOT=/pad/naar/legacy
```

V2 runtime-services mogen niet terugvallen op legacy. Legacy lezen hoort alleen bij expliciete import-, oracle- of shadow-run flows.

## V2 Commands

Draai commands vanaf de repo-root:

```bash
npm run catalog:smoke
npm run paths:smoke
npm run runtime:smoke
npm run algorithm:smoke
npm run audience:smoke
npm run script-agent:smoke
npm run show-control:smoke
npm run gateway:smoke
```

Start losse services ook vanaf de repo-root, bijvoorbeeld:

```bash
npm run catalog:start
npm run paths:start
npm run gateway:start
```

## Belangrijke Regel

V1-bestanden onder `legacy/` blijven onaangeraakt tijdens V2-tests. Media-assets onder `modules/catalog/media/` zijn lokaal en worden niet als gewone brondata meegecommit, behalve `.gitkeep` en documentatie.
