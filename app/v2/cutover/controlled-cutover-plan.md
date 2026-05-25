# Controlled Cutover Plan V0

Status: planning artifact, not approval to cut over.

## Goal

Run V2 next to V1 until V2 has proven it can complete a show run with explicit rollback to V1. V1 remains the live fallback and oracle until all gates below are green.

## Non-Negotiable Gates

- V1 app code and `app/data/live.sqlite*` remain unchanged.
- `protectedV1HashesUnchanged: true` is proven before and after each rehearsal.
- V2 services use ports `3020` through `3027` only.
- Gateway routes commands only; Runtime owns order state.
- Show Control executes cues only; it does not choose situations.
- Algorithm publishes scores only; it does not publish order or `preparedNext`.
- Shadow-run report differences are reviewed before any live target receives V2 cues.

## Rehearsal 1: No Public Audience, No Hardware Targets

Run:

- Catalog, Paths, Algorithm, Runtime, Audience, Script Agent, Show Control and Gateway.
- Start run via Gateway.
- Prepare via Show Control.
- Start situation via Runtime/Gateway.
- GO via Show Control.
- Stop situation.
- Repeat for at least three situations.

Pass evidence:

- Runtime keeps ownership of `preparedNext`, `activeSituation`, `playedSituations`.
- Show Control cue log contains prepare, go, warnings and payload IDs.
- Script Agent output exists for each prepared situation.
- Audience signals can be absent without crashing Algorithm.
- Protected V1 hashes unchanged.

## Rehearsal 2: Limited Targets

Enable dry-run or non-critical target adapters first:

- TouchDesigner test project or local mock receiver.
- Stream Deck feedback only if safe.
- No live DMX, no live audio scene recall, no camera switching.

Pass evidence:

- TouchDesigner receives prepare/go command intent and fetches HTTP payload.
- Acks or warnings are visible in Show Control.
- GO remains non-blocking.
- Gateway can restart without module data corruption.
- V1 fallback remains untouched and ready.

## Rehearsal 3: Technical Run

Enable selected live targets in a controlled room:

- TouchDesigner visual output.
- Audio/SQ5 only with safe scene.
- DMX only with limited fixture group.
- Camera control only if operator can override manually.

Pass evidence:

- Start, prepare, go, stop and next work several times in a row.
- Cue warnings are non-fatal unless explicitly marked show-critical.
- Runtime never changes order because of a cue ack or hardware state.
- Shadow-run report is reviewed after the run.

## Live Cutover Conditions

Cutover is allowed only after:

- Latest Catalog, Paths, Runtime, Algorithm, Audience, Script Agent, Show Control and Gateway smoke tests pass.
- Latest shadow-run report has reviewed differences with accepted causes.
- Operator has a visible V1 fallback route.
- V2 can be stopped without touching V1 data.
- Hardware operators know which system is authoritative at each moment.

## Rollback

Rollback trigger examples:

- V2 Runtime cannot produce a valid `preparedNext`.
- Show Control emits repeated show-critical target failures.
- Gateway cannot route Runtime or Show Control commands.
- Protected V1 hashes change unexpectedly.
- Operator loses confidence in V2 state.

Rollback action:

1. Stop V2 Gateway first.
2. Stop V2 Show Control target output.
3. Leave V1 running or restart V1 using the existing legacy workflow.
4. Keep V2 logs and shadow reports for analysis.
5. Do not run migrations or repairs against V1 data from V2.

## Current Cutover Recommendation

Do not cut over yet.

The current V2 stack is ready for no-audience/no-hardware rehearsal. The latest shadow-run still shows a broad available-pool difference between the V1 oracle and V2 Paths/Runtime view. That difference is logged and explainable enough for analysis, but not yet enough for live trust.
