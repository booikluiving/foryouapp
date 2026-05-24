# Show Control Cue Protocol v0

Dit document beschrijft het gewenste Show Control blok. Het is ontwerpdocumentatie, geen implementatie.

Show Control is de laag tussen Runtime en de technische uitvoer. Runtime bepaalt welke situatie klaarstaat of actief is. Show Control bepaalt welke cues naar welke systemen gaan, bewaakt of ze aankomen en geeft live status terug aan het dashboard.

## Waarom Een Apart Blok

In de huidige architectuur hangen technische acties te snel direct aan Runtime, TouchDesigner of losse sidecars. Daardoor wordt het lastig om te zien:

- welke cue precies is afgevuurd;
- welke targets tegelijk moesten reageren;
- welk target wel of niet heeft bevestigd;
- of een waarschuwing showkritisch is;
- waar de operator moet ingrijpen.

Show Control wordt daarom een eigen service met eigen Express server, eigen database en eigen interne logica.

## Eigenaarschap

| Laag | Eigenaar van |
| --- | --- |
| Runtime Service | showRun, activeSituation, resolvedPreparedNext en runtime waarheid. |
| Show Control Service | cues, cue fan-out, target status, ack tracking, warnings, retries en panic actions. |
| TouchDesigner | visuele/media-uitvoering nadat een cue is ontvangen. |
| SQ5 / audio | mixer-acties en audio-status. |
| DMX / Art-Net | lichtcues en dimmer/situatie-status. |
| Camera / Perfect Cue / Stream Deck | hardware-input en feedback rond bediening. |

Show Control kiest geen situatie. Het voert technische cues uit voor de situatie die Runtime al heeft gekozen en gematerialiseerd.

## Protocolprincipe

De nieuwe standaard is hybride:

| Kanaal | Gebruik |
| --- | --- |
| Express routes | Commands, payloads, statusvragen en debugging. |
| OSC | Snelle realtime cues naar TouchDesigner en andere realtime targets. |
| SSE/WebSocket | Live status, warnings en cue updates naar dashboard en Stream Deck feedback. |
| Art-Net | DMX/licht-uitvoer. |
| USB keyboard | Perfect Cue input als hardware-trigger. |

Grote of gestructureerde payloads hoeven niet volledig in OSC te zitten. OSC mag een `cueId`, `cueType` en `payloadId` sturen. TouchDesigner kan daarna via HTTP de payload ophalen.

Voor TouchDesigner is het doel een enkele OSC-controlpoort. Oude aparte stromen voor `up_next`, `current`, operator answer, scriptregels en environment-file polling horen niet in het nieuwe contract. Die worden vervangen door cue commands met payloads.

## Snelheidsregel

Show Control mag geen zware wachtrij worden. De normale flow is:

```text
Runtime publiceert state
Show Control stuurt cues parallel of geordend met kleine delays
Targets voeren uit
Status en warnings komen asynchroon terug
```

De belangrijkste regel:

- `prepare` mag wachten op readiness als dat expliciet nodig is;
- `go` wacht niet op acknowledgements;
- status, warnings en logs komen asynchroon terug naar dashboard;
- alleen cues met mode `required-ready` mogen vóór `go` blokkeren.

Sommige samengestelde cues moeten niet exact gelijktijdig naar alle apparaten. Show Control mag daarom per action een kleine `delayMs` gebruiken. Dat houdt de cue logisch één handeling, maar voorkomt dat hardware of TouchDesigner tegelijk te veel binnenkrijgt.

## Cue Types

| Type | Betekenis |
| --- | --- |
| prepare | Zet media, omgeving, teleprompter of target klaar zonder live te gaan. |
| go | Maak een voorbereide situatie, camera, omgeving of fase actief. |
| pulse | Korte actie zoals FX, transition, camera pulse of flash. |
| reset | Zet een target terug naar een bekende toestand. |
| panic | Stop of blackout voor showkritische noodsituaties. |
| status | Heartbeat, target-status of debuginformatie. |

## Ack Modes En Status

Niet elke cue hoeft door alle statuslagen. Een cue krijgt eerst een mode:

| Mode | Gebruik | Blokkeert de show? |
| --- | --- | --- |
| fire-and-forget | Simpele pulses, FX, camera pulse, Stream Deck feedback. | Nee. |
| acknowledged | Belangrijke triggers waarbij status nuttig is. | Nee, geeft waarschuwing bij timeout. |
| required-ready | Voorbereiding die echt klaar moet zijn voor `go`, zoals media laden. | Alleen vóór `go`. |

De statuslagen zijn debug- en dashboardtaal, geen verplichte runtime-wachtrij:

| Stage | Betekenis |
| --- | --- |
| queued | Show Control heeft de cue aangemaakt. |
| sent | Show Control heeft de cue naar het target gestuurd. |
| received | Target heeft de cue ontvangen. |
| applied | Target heeft de parameters toegepast. |
| loaded | Benodigde media of state is geladen. |
| visible | Het verwachte resultaat is zichtbaar of actief gemeld. |
| warning | Target reageerde, maar er is een risico of afwijking. |
| failed | Target kon de cue niet uitvoeren. |
| timedOut | Target gaf niet op tijd antwoord. |

Voor TouchDesigner is `visible` ideaal, maar niet altijd verplicht. Soms is `applied` of `loaded` genoeg. Dat wordt per cue/target geconfigureerd.

Voor de live show moet status licht blijven. De standaard is error-first: online/offline, command received, media missing/found, audio ready/error, applied/error en warning bij timeout. Uitgebreide logging hoort achter een debug-toggle.

## Failure Policy

De basisregel:

- showkritische cues krijgen status en waarschuwingen;
- een ontbrekende ack blokkeert niet automatisch de hele voorstelling;
- per cue kan worden ingesteld of een target required is;
- `go` cues zijn standaard non-blocking;
- operator-acties zijn retry, force complete, rollback en panic stop.

Cue-logging is nuttig voor debugging, maar moet het systeem niet vertragen. Daarom hoort logging configureerbaar te zijn: normaal compact, bij debug uitgebreider.

## TouchDesigner Cue Contract

Voor nieuwe TD-cues is het doel:

```text
PREPARE
Show Control -> TouchDesigner OSC:
/td/cue prepare cueId payloadId

TouchDesigner -> Show Control:
/td/ack cueId loaded ok

GO
Show Control -> TouchDesigner OSC:
/td/cue go cueId payloadId

TouchDesigner -> Show Control asynchroon:
/td/ack cueId targetId stage status message
```

Als de payload groter is:

```text
TouchDesigner -> Show Control HTTP:
GET /api/show-control/cues/:cueId/payload
```

Show Control publiceert daarna live status naar Gateway / Dashboard.

De concrete TouchDesigner commandlijst staat in [TouchDesigner command surface](05-touchdesigner-command-surface.md).

TouchDesigner krijgt in dit model vooral stabiele IDs en file refs. TD haalt jpg/mp3/mp4 lokaal uit de gedeelde mediamap en voert uit. Promptopbouw, cataloguslijsten, operator AI textflow en Dropbox/CSV polling horen niet meer in TD.

## Consequentie Voor De Architectuur

Live consumers splitsen in twee groepen:

- systemen die vooral runtime-output lezen, zoals Script Agent/API Playground en Universe;
- systemen die technische cues uitvoeren, zoals TouchDesigner, SQ5, camera's en DMX/licht.
- tekstsystemen zoals teleprompter en captions, die inhoudelijk bij Script Agent horen maar door Show Control gecued kunnen worden.

De technische uitvoergroep hangt in het doelbeeld achter Show Control. Tekstsystemen hangen inhoudelijk onder Script Agent, maar Show Control kan ze wel cueen. Runtime publiceert de waarheid, Show Control orkestreert de uitvoering.
