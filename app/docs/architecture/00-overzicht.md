# For You Architectuur En Dataflow

Dit bestand is gegenereerd door `npm run docs:architecture`. Pas de bron-diagrammen aan in `docs/architecture/diagrams/` en draai daarna de generator opnieuw.

## Snel Lezen

- De app heeft een centrale Node/Express runtime in `app/server.js` met SQLite als canonieke runtime-database.
- Publiek gaat via QR/join naar de live chat; admin, stage, algoritme, paden, universe en teleprompter zijn aparte views op dezelfde runtime.
- `show-algorithm` bepaalt de volgorde/aanbeveling uit catalogusdata, paden en live feedback.
- TouchDesigner, SQ5, Camera Control, Stream Deck, UniFi, Dropbox en AI-providers hangen als integraties rondom de centrale app.
- For_universe is geen tweede runtime-database; het leest dezelfde `app/data/live.sqlite` read-only.

## Gegenereerde Kaarten

- [Routes](generated/routes.md): 170 route entries gevonden.
- [SQLite schema](generated/sqlite-schema.md): 30 tabellen gevonden.
- [Code dependencies](generated/code-deps.mmd): runtime `require(...)` relaties.

## 1. System Context

De hoofdkaart: wie praat met welke runtime, database en externe show-systemen.

```mermaid
flowchart LR
  audience["Publiek<br/>mobiele chat"] --> join["/join?token<br/>sessie toegang"]
  audience --> chat["/ client<br/>WebSocket chat"]

  operator["Operator / admin"] --> admin["/admin<br/>show-control"]
  operator --> algorithmUi["/algoritme<br/>catalogus en run-control"]
  operator --> padenUi["/paden<br/>route-editor"]
  operator --> apiPlayground["/api-playground<br/>operator AI"]
  operator --> teleUi["/teleprompter-parser<br/>script prep"]
  operator --> universeUi["/universe<br/>read-only visualisatie"]

  stageDisplay["Stage / OBS / TD browser"] --> stage["/stage<br/>publieke output"]
  stageDisplay --> liveCaptions["/teleprompter-parser/live-captions"]

  subgraph appServer["For You app server - app/server.js"]
    express["Express routes"]
    ws["WebSocket + Socket.IO compat"]
    showState["Show runtime state"]
    algorithm["show-algorithm engine"]
    teleStore["Teleprompter store"]
    operatorAi["Operator AI orchestrator"]
    oscControl["OSC control and output"]
    assetManager["Environment asset manager"]
  end

  sqlite[("data/live.sqlite<br/>runtime database")]
  files["Lokale files<br/>moderation, sim pools, script-output"]
  dropbox["Dropbox catalog mirror<br/>.foryou.md + database.md"]
  openai["OpenAI catalog sync<br/>optioneel"]
  providers["AI providers<br/>DeepSeek / OpenAI / Anthropic"]
  touchdesigner["TouchDesigner<br/>OSC + frame preview"]
  sq5["SQ5 sidecar<br/>HTTP/OSC -> MIDI TCP"]
  camera["Camera Control sidecar<br/>HTTP/OSC -> Blackmagic REST"]
  unifi["UniFi read-only agent"]
  universe["For_universe module<br/>read-only graph service"]

  join --> express
  chat --> ws
  admin --> express
  algorithmUi --> express
  padenUi --> express
  apiPlayground --> express
  teleUi --> express
  stage --> ws
  liveCaptions --> teleStore
  universeUi --> universe

  express <--> showState
  ws <--> showState
  showState <--> sqlite
  algorithm <--> sqlite
  teleStore --> express
  operatorAi --> providers
  operatorAi --> oscControl
  assetManager --> files
  universe --> sqlite

  sqlite <--> dropbox
  dropbox --> openai
  express --> files
  oscControl <--> touchdesigner
  touchdesigner --> express
  express --> sq5
  express --> unifi
  teleStore --> camera
  teleStore --> oscControl
  camera -. apart proces .-> operator
  sq5 -. apart proces .-> operator
```

## 2. Audience Session Flow

Van QR-token naar chat, moderatie, polls, engagement en algorithm metrics.

```mermaid
flowchart TD
  admin["Admin maakt sessie<br/>/admin/session/new-with-token"] --> session["sessions<br/>actieve show-sessie"]
  admin --> token["session_join_tokens<br/>QR token + expiry"]
  token --> qr["Stage QR output<br/>/stage/session-qr"]
  qr --> join["Publiek opent<br/>/join?token=..."]
  join --> grant["session_access_grants<br/>cookie voor huidige sessie"]
  grant --> client["Publieke client /"]

  client --> ws["WebSocket / Socket.IO compat"]
  ws --> register["register<br/>naam + clientTag"]
  ws --> message["message<br/>chat tekst"]
  ws --> reaction["reaction<br/>emoji / heart / bored"]

  message --> moderation["Moderatie<br/>bad-words, mute, block, rate-limit"]
  moderation --> chatMessages["chat_messages<br/>accepted / rejected"]
  reaction --> engagement["session_engagement_scores<br/>leaderboard en activiteit"]
  chatMessages --> adminState["/admin/state<br/>moderatie + live chat"]
  chatMessages --> stage["/stage<br/>chat overlay"]
  engagement --> stage

  admin --> pollStart["/admin/polls/start"]
  pollStart --> polls["polls"]
  client --> pollVote["poll_vote via WS"]
  pollVote --> pollVotes["poll_votes"]
  polls --> stage
  pollVotes --> stage

  chatMessages --> algorithmMetrics["Actieve scene metrics<br/>comment_count"]
  reaction --> algorithmMetrics
  algorithmMetrics --> run["algorithm_scene_runs<br/>heart, bored, comments, score"]
  run --> recommendation["Volgende aanbeveling<br/>show-algorithm"]

  session --> end["/admin/session/end"]
  end --> close["ended_at gezet<br/>clients moeten opnieuw joinen"]
```

## 3. Algorithm Scene Flow

Hoe catalogusdata scene-keuzes, runs, TouchDesigner, SQ5 en teleprompter voedt.

```mermaid
flowchart TD
  subgraph catalog["Catalogus en routes"]
    performers["algorithm_performers"]
    characters["algorithm_characters"]
    situations["algorithm_situations"]
    labels["algorithm_labels"]
    environments["algorithm_environments"]
    scenes["algorithm_scenes"]
    paths["algorithm_paths + path nodes/edges"]
  end

  adminUi["/algoritme admin UI"] --> catalogApi["/admin/algorithm/* API"]
  padenUi["/paden editor"] --> catalogApi
  catalogApi <--> catalog
  catalog --> sqlite[("data/live.sqlite")]
  sqlite <--> dropbox["Dropbox catalog sync<br/>.foryou.md mirror"]
  sqlite --> databaseMd["database.md mirror<br/>GPT/context export"]

  sqlite --> state["getAlgorithmState"]
  state --> engine["show-algorithm engine"]
  engine --> validation["validatie<br/>cast, paden, thresholds"]
  engine --> scoring["ranking<br/>scores, cooldown, labels"]
  scoring --> queue["locked queue + prepared next"]

  queue --> start["Start scene<br/>/admin/algorithm/runs/start or begin"]
  start --> run["algorithm_scene_runs<br/>active run"]
  run --> publicState["broadcastPublicAlgorithmState"]
  publicState --> client["Publieke client<br/>stemmen en feedback"]
  publicState --> stage["/stage output"]
  publicState --> adminUi
  publicState --> universe["/universe graph<br/>read-only runtime"]

  start --> currentOsc["Current Scene OSC<br/>TouchDesigner"]
  start --> upNextOsc["Up Next OSC<br/>TouchDesigner"]
  start --> sq5["SQ5 all-mics queue<br/>HTTP sidecar"]
  start --> telePrepare["prepareTeleprompterFromAlgorithmPayload"]
  telePrepare --> teleStore["Teleprompter preparedScene"]

  client --> votes["algorithm_character_votes<br/>of skips"]
  votes --> run
  client --> reactions["hearts / bored / comments"]
  reactions --> run

  endScene["End scene<br/>admin, OSC, teleprompter"] --> closeRun["ended_at + score"]
  closeRun --> run
  closeRun --> nextOsc["Nieuwe Up Next OSC"]
  closeRun --> telePrepare
  closeRun --> queue
```

## 4. Teleprompter And Camera Flow

Hoe prepared scenes, ready/reveal, cueing, live captions en camera-pulsen lopen.

```mermaid
flowchart LR
  algorithm["Actieve / volgende scene<br/>algorithm payload"] --> prepare["prepareTeleprompterFromAlgorithmPayload"]
  adminParser["Teleprompter parser UI<br/>/teleprompter-parser"] --> parse["/admin/teleprompter-parser/parse"]
  adminParser --> ready["/admin/teleprompter-parser/ready"]
  adminParser --> reveal["/admin/teleprompter-parser/reveal"]

  prepare --> store["teleprompt-store<br/>current, cue, captionStyle, preparedScene"]
  parse --> store
  ready --> store
  reveal --> store

  store --> sse["/api/teleprompter-parser/events<br/>SSE"]
  store --> current["/api/teleprompter-parser/current"]
  sse --> stage["/teleprompter-parser/stage<br/>operator cue UI"]
  sse --> captions["/teleprompter-parser/live-captions<br/>stage captions"]
  current --> stage
  current --> captions

  stage --> cue["/api/teleprompter-parser/cue"]
  cue --> store
  cue --> autoCamera["Auto camera switch<br/>speaker slot mapping"]
  reveal --> autoCamera
  autoCamera --> tdCamera["TouchDesigner camera OSC pulse<br/>/osc/osc25..27"]
  autoCamera --> cameraSidecar["Camera Control sidecar<br/>optioneel via OSC/HTTP"]

  stage --> endCard["End-card advance"]
  captions --> endButton["End scene button"]
  endCard --> endScene["/api/teleprompter-parser/end-scene"]
  endButton --> endScene
  endScene --> showEnd["endActiveAlgorithmSceneRun"]
  showEnd --> prepare
  showEnd --> nextPulse["TouchDesigner next pulse"]

  style["Caption style API"] --> store
  store --> captionStyleFile["caption-style local file"]
```

## 5. Integration Sidecars

De losse show-processen rond de app: Stream Deck, TouchDesigner, SQ5, Camera Control, UniFi en Dropbox.

```mermaid
flowchart TD
  streamDeck["Stream Deck / Companion"] --> companionScripts["docs/stream-deck scripts<br/>HTTP buttons + polling"]
  companionScripts --> foryouHttp["For You HTTP admin API<br/>show, ready, start-scene"]
  companionScripts --> sq5Http["SQ5 HTTP API<br/>/api/streamdeck/*"]

  touchdesigner["TouchDesigner"] --> oscIn["OSC in<br/>For You listens on 1234 default"]
  oscIn --> oscCommands["OSC command router<br/>session, stage, sim, algorithm"]
  oscCommands --> showState["show runtime state"]
  showState --> oscOut["OSC out<br/>Up Next, Current Scene, pulses"]
  oscOut --> touchdesigner

  touchdesigner --> tdFrames["POST /admin/td-preview/frame<br/>JPEG preview frames"]
  tdFrames --> tdPreview["/admin/td-preview<br/>health and visual preview"]
  tdPreview --> sq5Status["SQ5 status health<br/>http://127.0.0.1:3105/api/status"]

  sq5Http --> sq5Sidecar["sq5-control/server.js"]
  sq5Osc["OSC 53000"] --> sq5Sidecar
  sq5Sidecar --> midiTcp["MIDI-over-TCP 51325"]
  midiTcp --> mixer["Allen & Heath SQ-5"]

  cameraUi["Camera Control UI<br/>127.0.0.1:3110"] --> cameraSidecar["camera-control/server.js"]
  cameraOsc["OSC 53100"] --> cameraSidecar
  cameraSidecar --> blackmagic["Blackmagic cameras<br/>REST API"]
  teleprompter["Teleprompter auto-camera"] --> oscOut
  oscOut --> cameraOsc

  unifi["UniFi agent<br/>read-only"] --> network["UniFi Network API"]
  foryouHttp --> unifi

  dropbox["Dropbox catalog folder"] <--> dropboxSync["dropbox-catalog-sync.js"]
  dropboxSync <--> sqlite[("data/live.sqlite")]
  openai["OpenAI catalog sync<br/>optioneel"] --> dropbox
```

## 6. Database Model

Een vereenvoudigd ER-model van de belangrijkste runtime-tabellen.

```mermaid
erDiagram
  sessions {
    INTEGER id PK
    TEXT name
    TEXT started_at
    TEXT ended_at
  }

  chat_messages {
    INTEGER id PK
    INTEGER session_id FK
    TEXT client_key
    TEXT name
    TEXT text
    TEXT status
  }

  moderation_actions {
    INTEGER id PK
    INTEGER session_id FK
    TEXT action_type
    TEXT client_key
    TEXT expires_at
  }

  polls {
    INTEGER id PK
    INTEGER session_id FK
    TEXT question
    TEXT options_json
    TEXT status
  }

  poll_votes {
    INTEGER id PK
    INTEGER poll_id FK
    TEXT client_key
    INTEGER option_index
  }

  session_engagement_scores {
    INTEGER session_id PK
    TEXT engagement_key PK
    TEXT client_key
    INTEGER emoji_count
    INTEGER comment_count
  }

  session_join_tokens {
    INTEGER id PK
    INTEGER session_id FK
    TEXT token
    TEXT expires_at
  }

  session_access_grants {
    INTEGER id PK
    INTEGER session_id FK
    TEXT grant_id
    TEXT expires_at
  }

  algorithm_performers {
    INTEGER id PK
    TEXT name
    INTEGER role_slot
  }

  algorithm_characters {
    INTEGER id PK
    TEXT name
    INTEGER performer_id FK
    TEXT label_scores_json
  }

  algorithm_situations {
    INTEGER id PK
    TEXT name
    TEXT required_character_ids_json
    TEXT allowed_character_ids_json
  }

  algorithm_labels {
    INTEGER id PK
    TEXT name
  }

  algorithm_environments {
    INTEGER id PK
    TEXT name
    TEXT label_scores_json
  }

  algorithm_scenes {
    INTEGER id PK
    TEXT title
    TEXT character_slots_json
    TEXT situation_ids_json
    INTEGER environment_id FK
    INTEGER context_scene_id FK
  }

  algorithm_paths {
    INTEGER id PK
    TEXT name
    TEXT color
    TEXT edge_mode
  }

  algorithm_path_scenes {
    INTEGER id PK
    INTEGER path_id FK
    INTEGER scene_id FK
    INTEGER is_end_node
  }

  algorithm_path_edges {
    INTEGER id PK
    INTEGER path_id FK
    INTEGER from_scene_id FK
    INTEGER to_scene_id FK
    TEXT edge_type
  }

  algorithm_scene_runs {
    INTEGER id PK
    INTEGER session_id FK
    INTEGER scene_id FK
    INTEGER run_order
    REAL score
  }

  algorithm_character_votes {
    INTEGER id PK
    INTEGER session_id FK
    INTEGER run_id FK
    INTEGER scene_id FK
    INTEGER character_id FK
  }

  settings {
    TEXT key PK
    TEXT value
    TEXT updated_at
  }

  sessions ||--o{ chat_messages : has
  sessions ||--o{ moderation_actions : has
  sessions ||--o{ polls : has
  polls ||--o{ poll_votes : has
  sessions ||--o{ session_engagement_scores : scores
  sessions ||--o{ session_join_tokens : issues
  sessions ||--o{ session_access_grants : grants
  sessions ||--o{ algorithm_scene_runs : runs

  algorithm_performers ||--o{ algorithm_characters : plays
  algorithm_environments ||--o{ algorithm_scenes : selected_by
  algorithm_scenes ||--o{ algorithm_scene_runs : executed_as
  algorithm_scenes ||--o{ algorithm_character_votes : receives
  algorithm_characters ||--o{ algorithm_character_votes : receives
  algorithm_scene_runs ||--o{ algorithm_character_votes : contains

  algorithm_paths ||--o{ algorithm_path_scenes : contains
  algorithm_paths ||--o{ algorithm_path_edges : contains
  algorithm_scenes ||--o{ algorithm_path_scenes : appears_in
  algorithm_scenes ||--o{ algorithm_path_edges : from_or_to
```
