# TouchDesigner Q-hub Protocol Test v1

This folder contains the smallest TouchDesigner-side test surface for the
For You V2 Show Control cue protocol.

The goal is protocol proof, not final visuals:

- receive Show Control OSC cues on UDP `127.0.0.1:9100`;
- fetch cue payloads from `http://127.0.0.1:3025/api/show-control/payloads/:payloadId`;
- log every cue and payload visibly in TouchDesigner;
- send light acknowledgements back to Show Control on UDP `127.0.0.1:9101`.

## Protocol

Show Control sends:

```text
/td/cue cueId command payloadId
```

TouchDesigner returns:

```text
/td/ack cueId command stage status message
```

Supported v1 commands:

- `td.status.heartbeat`
- `td.environment.prepare`
- `td.environment.go`
- `td.camera.set`
- `td.phase.set`

Unknown commands are logged and acknowledged with `stage=error` and
`status=error`.

## TouchDesigner Setup

1. Open a new empty TouchDesigner project.
2. Open the Textport.
3. Run this file:

   ```python
   exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/bootstrap_touchdesigner_qhub_test.py').read())
   ```

4. Save the project as:

   ```text
   /Users/for_you/ForYou/main/show/td-qhub-test/ForYou TD QHub Test.toe
   ```

The bootstrap creates visible top-level nodes directly in `/project1`:

- `oscin_td_cue`
- `oscout_td_ack`
- `td_qhub_router`
- `cue_log`
- `payload_log`
- `status_state`
- `status_view`
- one visible `trigger_*` Base COMP per routed cue
- `asset_manager_demo/*` with live Catalog asset tables

No DeckLink, camera hardware, audio hardware, or media outputs are created.

## Automated Protocol Test

Run the self-contained fake-TD protocol test:

```bash
cd /Users/for_you/ForYou/main
npm run show-control:td-qhub:test
```

Run against a real open TouchDesigner test project:

```bash
cd /Users/for_you/ForYou/main
node show/td-qhub-test/protocol-test.js --live
```

The live test expects:

- Show Control HTTP on `127.0.0.1:3025`;
- Show Control TD ack listener on UDP `9101`;
- the TouchDesigner Q-hub test project listening on UDP `9100`.

Useful live check:

```bash
lsof -nP -iUDP:9100 -iUDP:9101
```

## Visible Trigger Nodes

The external OSC protocol stays one route, but the TD project now fans cues out
internally:

- `trigger_start_run_prepare`
- `trigger_start_situation_go`
- `trigger_stop_situation_prepare_next`
- `trigger_camera_1`
- `trigger_camera_2`
- `trigger_camera_3`
- `trigger_phase_set`
- `trigger_asset_prepare`
- `trigger_heartbeat`
- `trigger_unknown`

Each trigger contains its own `status_state`, `trigger_log`, and `payload_view`.
On every routed cue, the top-level trigger COMP changes color and the
trigger's `visual_state` Text DAT updates with hit count, command, cueId,
payloadId, stage, status, and payload summary. This makes camera 1/2/3 and
start/stop situation hits visible without needing to guess from the central
log.

## Asset Manager Demo

`asset_manager_demo` fetches present media assets from:

```text
http://127.0.0.1:3021/v0/catalog/media-assets
```

It fills:

- `asset_registry`
- `asset_filter_state`
- `selected_asset`
- `prepared_background` (Movie File In TOP preview)
- `prepared_background_status`
- `asset_prepare_log`

`td.asset.prepare` updates `selected_asset`. `td.environment.prepare` and
`td.environment.go` also select and preview the payload background asset when
Show Control includes one. This is a wiring demo only; no Audio File In,
DeckLink, or hardware outputs are created.
