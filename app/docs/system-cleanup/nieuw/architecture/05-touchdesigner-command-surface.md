# TouchDesigner Command Surface v0

Dit document beschrijft het gewenste opgeschoonde TouchDesigner-oppervlak. Het is ontwerpdocumentatie, geen implementatie.

TouchDesigner blijft de showlaag voor video, camera/keying, compositing, lokale media/audio playback, DeckLink outputs en browser stages. De veranderlijke showlogica hoort niet in TouchDesigner, maar in Runtime en Show Control.

Het kernprincipe: TouchDesigner is een uitvoerder. Het mag razendsnel renderen, schakelen, mixen, effecten doen en hardware outputs aansturen, maar het bepaalt niet welke situatie gekozen wordt, welke prompt gebouwd wordt, welke catalogusdata geldig is of wat de volgorde-logica is.

## Hoofdbesluit

TouchDesigner krijgt in het doelbeeld geen losse oude stromen meer voor `up_next`, `current`, operator answers en scriptregels.

TouchDesigner krijgt:

- een enkele OSC-controlpoort voor cue commands;
- HTTP payloads voor grotere cue-data;
- browser/webstage URLs voor stage renders;
- stabiele IDs en canonical file refs voor assets;
- directe toegang tot mediabestanden in een gedeelde map;
- lichte async acknowledgements terug naar Show Control.

Show Control is de plek voor samengestelde cues, routing, kleine delays tussen acties, retries/warnings en live status. Runtime kiest de situatie. Algorithm levert scores. TD voert uit.

## Niet Meer Als Nieuwe Route Gebruiken

Deze oude inputs verdwijnen uit het doelbeeld:

| Oud | Waarom weg |
| --- | --- |
| `up_next` OSC-lijst | Runtime en webapps zijn eigenaar van prepared/next state. TD hoeft geen volledige situatielijst als losse OSC-velden te krijgen. |
| `current` OSC-lijst | Active state hoort uit Runtime/Show Control te komen als cue, niet als tweede losse situatie-stream. |
| Operator API / answer OSC | Operator-output wordt in de server/webapps afgehandeld. TD hoeft geen AI/chat-output als aparte tekststroom te ontvangen. |
| `/foryou/script/*` OSC | Teleprompter/captions krijgen een eigen contract; TD hoeft geen oude Text DAT-scriptflow te dragen. |
| `current-environment.txt` / Dropbox-file polling als bron | Environment moet via een cue komen; TD kiest daarna zelf de lokale media uit de mediamap. |
| Live captions als enige verplichte browser stage | Captions mogen zowel als browser fallback blijven bestaan als via tekstpayload naar TD gaan, zodat TD styling en compositing zelf kan doen. |
| Prompt/opbouwlogica in TD | Prompt en runtime-context worden server-side opgebouwd. TD krijgt alleen render/uitvoercommands. |
| Catalogusinhoud in TD | TD krijgt asset IDs en file refs, niet de volledige cataloguslijst. |

## Commands Die Wel Blijven

Alle commands lopen conceptueel via:

```text
Show Control -> TD OSC control port:
/td/cue cueId command payloadId

TD -> Show Control:
/td/ack cueId command stage status message
```

| Command | Doel | Mode |
| --- | --- | --- |
| `td.phase.set` | Zet showfase: inloop, wait/operator, cams. | acknowledged |
| `td.camera.set` | Zet camera 1, 2 of 3 actief in TD. Later kan dit ook camera-hardware raken, maar primair is dit de snelle TD-switch. | acknowledged |
| `td.environment.prepare` | Laad/prepare omgeving op basis van `environmentId` en asset refs uit de runtime snapshot. | required-ready |
| `td.environment.go` | Maak de voorbereide omgeving actief. | non-blocking |
| `td.asset.prepare` | Prepare background, soundscape, fx of special asset uit gedeelde mediamap. | required-ready als nodig |
| `td.audio.prepare` | Prepare lokale mp3/soundscape/fx en routing/mix richting audio-output/SQ5. | required-ready als nodig |
| `td.audio.go` | Start/stop/duck voorbereide audio. | non-blocking of acknowledged |
| `td.fx.trigger` | Trigger korte fx, transition of pulse. | fire-and-forget |
| `td.webstage.prepare` | Laad browser stage met vaste renderresolutie, layer en URL. | required-ready als nodig |
| `td.webstage.show` | Toon een browser stage als input/layer. | acknowledged |
| `td.webstage.hide` | Verberg een browser stage. | acknowledged |
| `td.caption.update` | Update captiontekst als payload, door TD zelf gestyled. | acknowledged |
| `td.caption.clear` | Leeg captions/overlay. | fire-and-forget |
| `td.reset` | Zet TD terug naar bekende veilige state. | acknowledged |
| `td.blackout` | Nood/veilig zwart of stop-output. | acknowledged |
| `td.status.heartbeat` | TD meldt dat het leeft en welke cue/status actief is. | status |

## Prepare En Go

Prepare mag al gebeuren zodra de vorige situatie is gestopt en Runtime een `preparedNext` heeft gekozen. Dan kan TD media vinden, audio klaarmaken en browser stages alvast laden.

Go is altijd non-blocking. Als de operator of Runtime een situatie start, mag Show Control niet wachten op TD. Acks komen achteraf terug voor status, warnings en debugging.

Een `ready` betekent minimaal:

- command ontvangen;
- verplichte mediafile gevonden;
- audio klaar als audio onderdeel van de cue is;
- browser stage geladen als die required-ready is.

`ready` betekent niet dat TD een zware visuele inspectie of 4K preview hoeft terug te sturen. Status moet licht blijven, anders wordt het show-systeem zelf trager.

## Fases

Voor nu zijn er drie fases:

- inloop;
- wait/operator;
- cams.

Nieuwe fases kunnen later, maar ze horen niet alvast in het contract zolang ze nog niet nodig zijn.

## Webstages

Deze blijven bruikbaar als browserbronnen in TD:

| Stage | Route | Opmerking |
| --- | --- | --- |
| Chat overlay | `/stage` | Naam is historisch generiek, inhoudelijk chat/publiek overlay. |
| Universe | `/universe/stage` | Netwerk/wereldvisualisatie. |
| Script Agent / API Playground | `/api-playground/stage` | Operator/AI output stage. |
| Session QR | `/stage/session-qr` | QR voor publiek. |
| Wifi QR | `/stage/wifi-qr` | Wifi QR. |
| Script Agent / Teleprompter | `/teleprompter-parser/stage` | Teleprompter output. |

Open punt: deze browserbronnen lijken nu zwaar te zijn, mogelijk door 4K rendering in TouchDesigner. In het doelcontract krijgt een webstage daarom een vaste renderresolutie mee. De stage mag niet per ongeluk als zware 4K browserlaag blijven draaien als dat niet nodig is.

Captions krijgen twee routes:

- browser/HTML overlay als fallback;
- tekstpayload naar TD, waarbij TD styling en compositing zelf doet.

## Assets

Assets zijn geen runtime-streams.

De gewenste flow:

```text
Catalog Service beheert asset metadata
Runtime bevriest environment en asset refs in snapshot
Show Control stuurt prepare/go cue naar TD
TouchDesigner kiest en leest lokale media zelf uit gedeelde map
```

Asset types:

- background image/video;
- soundscape/audio;
- fx image/video/audio;
- specials voor impact, korte video-effecten of extra geluidseffecten.

De basis bestaat uit vaste slots, maar die slots zijn optioneel. Een omgeving hoeft dus niet altijd een background, soundscape en fx te hebben. Belangrijk is dat Runtime/Show Control stabiele IDs en file refs meestuurt, niet alleen menselijke namen.

## Audio En Licht

Audio hoort in TouchDesigner voorbereid en afgespeeld te kunnen worden, omdat TD hier waarschijnlijk stabieler en sneller is dan web. TD kan soundscapes en fx uit lokale bestanden kiezen en richting SQ5/audio-output sturen.

Licht wordt niet via TouchDesigner als centrale hub ontworpen. Show Control stuurt licht via Art-Net/DMX. Een environment cue kan wel een sfeerwaarde bevatten, bijvoorbeeld voor een RGB key light dat bij de achtergrond past.

## Cue Builder UI

Show Control krijgt conceptueel een cue editor/dashboard.

Daarin kan de operator of maker:

- een cue naam geven;
- een korte omschrijving geven;
- een of meer TD actions toevoegen;
- targets kiezen;
- optionele `delayMs` tussen actions zetten;
- aangeven welke actions required-ready zijn;
- zien welke actions actief, klaar, failed of timed out zijn;
- een cue koppelen aan Stream Deck, Perfect Cue of een runtime event.

Een cue mag meerdere dingen doen, maar Show Control mag acties met kleine delays afvuren zodat apparaten niet verward raken door exact gelijktijdige commands. Dat kan om milliseconden gaan.

Bijvoorbeeld:

```text
Cue: Start camera situation
- td.phase.set -> cams
- td.camera.set -> camera 2
- td.environment.go -> cafe
- sq5.scene.set -> performers open
- dashboard status -> active
```

Stream Deck mag live status terugkrijgen, bijvoorbeeld een knop die wisselt tussen start situatie en stop situatie. Perfect Cue is in dit model alleen input: die kan een cue triggeren, maar krijgt geen live status terug.

Show Control bewaakt de uitvoering. TouchDesigner voert uit.

## Status En Fouten

TD stuurt lichte status terug:

- online/offline;
- command received;
- media found/missing;
- audio ready/error;
- cue applied/error;
- warnings bij timeout.

Niet elke succesvolle microstap hoeft continu gespamd te worden. Error-first en debug-togglebaar is beter voor stabiliteit.
