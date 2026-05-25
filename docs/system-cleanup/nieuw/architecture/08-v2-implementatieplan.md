# V2 Implementatieplan

Dit document is het startpunt voor de gecontroleerde verhuizing van For You V1 naar For You V2.

Het doel is niet om snel een prototype te maken dat aan de buitenkant werkt. Het doel is om een nieuw systeem naast V1 te bouwen waarvan per fase bewezen wordt dat de onderliggende grenzen, contracten, data en runtime-regels kloppen.

## Kernbesluit

V1 blijft de werkende referentie en oracle.

## Migratieprotocol: V1-Pariteit Eerst

If it ain't broken, don't fix it.

V2 is een structurele opschoning van eigenaarschap, data, API's, contracten en runtime-grenzen. V2 is niet automatisch een redesign van de bestaande werkende interfaces.

Voor elke module geldt:

- bestaande V1 UI/UX en operator-workflows blijven de functionele referentie als ze goed werken;
- port of behoud bewezen interacties, layoutpatronen en feedback waar mogelijk;
- nieuwe modulepagina's gebruiken de gedeelde V2 stylesheet `app/v2/shared/ui/foryou-v2.css` als visuele basis;
- vervang vooral de onderliggende structuur: servicegrenzen, routes, stores, read models, events en tests;
- maak geen placeholder-UI als er al een goede V1 UI bestaat;
- maak geen versimpelde "ongeveer hetzelfde" versie van een bestaande workflow;
- elke zichtbare UI-afwijking van V1 moet nodig zijn voor V2 of expliciet gemotiveerd worden;
- eerst V1-pariteit bewijzen, daarna pas verbeteren.

Als een eerste V2-poging te ver afwijkt van V1 en daardoor moeilijk te herstellen is, mag die poging worden weggegooid. Dan is het beter om opnieuw te beginnen vanuit de bewezen V1 workflow en die aan te sluiten op V2-contracten dan om een verkeerde UI cosmetisch op te lappen.

Voorbeelden:

- Catalogus en Media Asset Manager moeten de compacte V1-workflow behouden, maar via Catalog Service werken.
- Paden Editor en Universe moeten qua UI en interactie zo intact mogelijk blijven; het werk zit vooral in het loskoppelen naar Paths Service.

V2 wordt parallel gebouwd in een aparte map:

```text
app/v2/
```

V2 mag V1-data alleen read-only gebruiken. Bestaande catalogusbestanden, sqlite-data, exports en legacy brondata blijven onaangeraakt.

Als V2 catalogusdata nodig heeft, maakt V2 een eigen snapshot, eigen database of eigen kopie onder `app/v2/`. V2 schrijft nooit terug naar V1 catalogusbestanden.

## Harde Veiligheidsregels

- Geen wijzigingen aan bestaande V1 app-code zonder expliciete toestemming.
- Geen wijzigingen aan bestaande catalogusbestanden, legacy sqlite-data, exports of brondata.
- Geen migraties over bestaande V1-bestanden heen.
- Geen writes vanuit V2 naar V1.
- Legacy data wordt alleen gelezen via een read-only adapter.
- V2 krijgt eigen modulemappen, eigen contracten en eigen data.
- V2 draait op andere poorten dan V1.
- Gateway mag geen nieuwe megaserver worden.
- Modules delen contracten, geen interne businesslogica.

## Voorgestelde Poorten

V1 draait op zijn eigen legacy poort. In oude setupdocs staat onder andere `3310`, en lokaal kan dat per machine verschillen. V2 moet daar niet mee botsen.

Voorstel:

| Onderdeel | Poort |
| --- | --- |
| V2 Gateway / Dashboard | `3020` |
| Catalog Service | `3021` |
| Paths Service | `3022` |
| Algorithm Service | `3023` |
| Runtime Service | `3024` |
| Show Control Service | `3025` |
| Audience Service | `3026` |
| Script Agent Service | `3027` |

Deze poorten moeten via env/config aanpasbaar blijven.

## Doelstructuur

```text
app/
  v2/
    gateway/
      dashboard/
      routing/
      health/

    shared/
      contracts/
      event-types/
      schema-utils/
      test-fixtures/

    modules/
      catalog/
        server/
        legacy-readonly/
        editor/
        media-asset-manager/
        validation/
        read-model/
        snapshots/
        contracts/
        db/
        tests/

      paths/
        server/
        editor/
        rules-engine/
        universe/
        snapshots/
        contracts/
        db/
        tests/

      algorithm/
        server/
        scoring/
        score-history/
        reactions-lab/
        contracts/
        db/
        tests/

      runtime/
        server/
        run-control/
        snapshots/
        order-state/
        materialization/
        run-log/
        contracts/
        db/
        tests/

      show-control/
        server/
        cue-engine/
        cue-library/
        adapters/
        status/
        contracts/
        db/
        tests/

      audience/
        server/
        public-app/
        chat/
        reactions/
        moderation/
        sessions/
        signal-normalizer/
        contracts/
        db/
        tests/

      script-agent/
        server/
        api-playground/
        operator-ai/
        prompt-builder/
        text-parser/
        teleprompter/
        live-captions/
        script-output/
        contracts/
        db/
        tests/

    tools/
      dropbox-mirror/
        backup/
        restore/
        status/
```

De Dropbox mirror is een tool, geen live module.

## Definition Of Done Per Fase

Een fase is pas klaar als:

1. De module eigen routes, eigen data en eigen contracten heeft.
2. Er tests zijn die de belangrijkste contracten bewijzen.
3. Er een smoke test is met echte of representatieve V1-data.
4. Er logging of inspectie is om beslissingen te verklaren.
5. Er geen onverwachte wijzigingen aan V1 zijn.
6. Er een checkpoint voor de gebruiker is met: wat werkt, wat nog onzeker is, wat het volgende risico is.

## Testbare Hypotheses

Elke fase moet beginnen met een hypothese en eindigen met bewijs.

Voorbeeld:

```text
Hypothese:
Catalog Service kan V1 catalogusdata read-only normaliseren naar een V2 read model zonder V1 te muteren.

Bewijs:
- V1-bestanden blijven byte-for-byte onaangeraakt.
- GET /v0/catalog/read-model levert geldig contract.
- GET /v0/catalog/validation meldt fouten zonder crash.
- POST /v0/catalog/snapshots schrijft alleen onder app/v2/.
```

## Fase 0: Migratiegrenzen Vastzetten

Hypothese: V2 kan naast V1 worden ingericht zonder legacy gedrag te breken.

Werk:

- Maak de definitieve V2-mapgrenzen expliciet.
- Leg vast welke V1-bronnen read-only gelezen mogen worden.
- Leg vast welke V1-bestanden verboden zijn om te schrijven.
- Leg poorten en env-namen vast.
- Leg per module vast: eigenaar, input, output, database, events.

Bewijs:

- `git status` toont geen onverwachte V1-wijzigingen.
- Er is een lijst met read-only legacy bronnen.
- Er is een lijst met verboden write targets.
- V2 poorten botsen niet met V1.

Checkpoint voor gebruiker:

- Akkoord op `app/v2/`.
- Akkoord op read-only V1-regels.
- Akkoord op poortplan.

## Fase 1: Contracts Skeleton

Hypothese: modules kunnen los gebouwd worden als hun contracten eerst vaststaan.

Werk:

- Maak shared contracts voor:
  - catalog read model;
  - paths snapshot/evaluation;
  - algorithm score feed;
  - runtime state/events;
  - show control cues/acks;
  - audience signals;
  - script agent output.
- Maak voorbeeldpayloads.
- Maak invalid-payload tests.

Bewijs:

- Contracttests slagen.
- Voorbeeldpayloads valideren.
- Ongeldige payloads falen voorspelbaar.
- Geen module importeert interne code van een andere module.

Checkpoint voor gebruiker:

- Gebruiker ziet welke data tussen modules stroomt.
- Nog geen domeinlogica wordt gebouwd zonder akkoord.

## Fase 2: Legacy Read-Only Adapter

Hypothese: V2 kan bestaande V1-data lezen zonder V1 te veranderen.

Werk:

- Bouw een legacy-readonly adapter onder `app/v2/modules/catalog/legacy-readonly/`.
- Inventariseer de betrouwbaarste legacy bron:
  - SQLite;
  - bestaande JSON/data;
  - bestaande server read endpoints;
  - andere lokale exports.
- Kies voor milestone 1 de minst invasieve route.
- Normaliseer legacy data naar V2 catalog read model.

Bewijs:

- Test leest V1-data en maakt V2 output.
- Test faalt als adapter probeert naar V1 te schrijven.
- Aantal performers, personages, omgevingen, situaties, labels en assets is verklaarbaar.
- V1 blijft onaangeraakt.

Checkpoint voor gebruiker:

- Gebruiker ziet welke V1-bron gebruikt wordt.
- Gebruiker bevestigt of de data herkenbaar en compleet is.

## Fase 3: Catalog Service V0

Hypothese: Catalog kan zelfstandig brondata leveren zonder runtime-, paths- of algorithm-logica.

Werk:

- Bouw `app/v2/modules/catalog/` als aparte Express-service.
- Default poort: `3021`.
- Routes:
  - `GET /health`
  - `GET /v0/catalog/read-model`
  - `GET /v0/catalog/validation`
  - `POST /v0/catalog/snapshots`
- Read model bevat:
  - performers;
  - personages;
  - omgevingen;
  - situaties;
  - labels;
  - media assets.
- Snapshots zijn immutable JSON onder `app/v2/`.

Bewijs:

- Legacy app-code is onaangeraakt.
- Catalog draait als aparte Express-service op eigen poort.
- `GET /health` werkt.
- `GET /v0/catalog/read-model` levert het nieuwe contract.
- `GET /v0/catalog/validation` meldt ontbrekende of ongeldige relaties zonder crash.
- `POST /v0/catalog/snapshots` maakt een immutable JSON snapshot.
- Snapshot bevat `snapshotId`, `createdAt`, `source`, `schemaVersion` en catalogusdata.
- Geen Runtime, Algorithm, Paths of Gateway domeinlogica in Catalog.
- Smoke test start Catalog v0, haalt read-model op, valideert en maakt snapshot.

Checkpoint voor gebruiker:

- Gebruiker controleert catalogusinhoud.
- Gebruiker geeft akkoord voordat Paths of Runtime hierop gebouwd worden.

## Fase 4: Paths Service V0

Hypothese: Paths kan pathAvailable/pathLocked bepalen zonder order of algorithm te bezitten.

Werk:

- Bouw `app/v2/modules/paths/`.
- Eigen poort: `3022`.
- Eigen snapshot/evaluation contract.
- Paden verwijzen naar situation IDs uit Catalog snapshot.
- Universe is read-only visualisatie, geen bron van waarheid.

Bewijs:

- Test: start-situaties zijn available.
- Test: path locked situaties zijn nooit speelbaar.
- Test: played situation facts unlocken nieuwe situaties volgens padregels.
- Test: Paths schrijft geen Runtime state.

Checkpoint voor gebruiker:

- Gebruiker ziet paden als voorbereiding, los van Runtime.

## Fase 5: Runtime Service V0

Hypothese: Runtime kan een showRun beheren als enige eigenaar van live state.

Werk:

- Bouw `app/v2/modules/runtime/`.
- Eigen poort: `3024`.
- `start run` maakt snapshots van Catalog, Paths en Algorithm config.
- Runtime bezit:
  - showRun;
  - showRunSnapshot;
  - preparedNext;
  - resolvedPreparedNext;
  - activeSituation;
  - situationRunId;
  - playedSituations;
  - materialization;
  - run log.

Bewijs:

- Test: start run maakt frozen snapshot.
- Test: preparedNext verandert niet door nieuwe scores.
- Test: active situation wordt pas played na stop.
- Test: played situations komen niet terug in eligible pool.
- Test: Runtime schrijft geen Catalog/Paths/Algorithm database.

Checkpoint voor gebruiker:

- Gebruiker ziet de run lifecycle zonder technische cues.

## Fase 6: Algorithm Service V0

Hypothese: Algorithm kan nuttig zijn zonder order, paths of runtime state te bezitten.

Werk:

- Bouw `app/v2/modules/algorithm/`.
- Eigen poort: `3023`.
- Input:
  - catalog/run snapshot;
  - gekoppelde audience observations;
  - situation stopped events.
- Output:
  - observed score voor gespeelde situatie;
  - predicted scores voor alle situaties.
- Geen available pool, geen preparedNext, geen volgorde-eigenaar.

Bewijs:

- Test: Algorithm schrijft geen Runtime state.
- Test: Algorithm publiceert scores voor alle situaties.
- Test: gelijke scores blijven gelijk; Runtime mag later randomizen.
- Test: observed data na stop situation beinvloedt volgende scoreberekening.

Checkpoint voor gebruiker:

- Gebruiker ziet dat Algorithm score-only blijft.

## Fase 7: Audience Service V0

Hypothese: publiekssignalen kunnen los binnenkomen, maar Runtime blijft eigenaar van actieve situationRun.

Werk:

- Bouw `app/v2/modules/audience/`.
- Eigen poort: `3026`.
- Public app, chat, hearts, bored, raw messages.
- Audience vraagt of ontvangt active situation context van Runtime.
- Runtime koppelt signalen aan situationRunId.

Bewijs:

- Test: heart tijdens actieve situation wordt gekoppeld aan juiste situationRunId.
- Test: signalen buiten actieve situation worden voorspelbaar gelogd of genegeerd.
- Test: raw chat kan naar Algorithm als input.
- Test: Audience kiest geen volgorde.

Checkpoint voor gebruiker:

- Gebruiker ziet publieke app/signalen los van Runtime-keuze.

## Fase 8: Script Agent Service V0

Hypothese: prompts, scripts, parser, teleprompter en captions kunnen los van Runtime bestaan.

Werk:

- Bouw `app/v2/modules/script-agent/`.
- Eigen poort: `3027`.
- Krijgt resolvedPreparedNext en runtime context via contract.
- Bouwt prompt/script/parser-output.
- Teleprompter en captions lezen Script Agent output.

Bewijs:

- Test: resolvedPreparedNext levert stabiele prompt-input.
- Test: parser kan personages/rollen verifieren tegen snapshot.
- Test: teleprompter toont performer slots uit runtime-output.
- Test: Script Agent schrijft geen Runtime order state.

Checkpoint voor gebruiker:

- Gebruiker ziet tekstlaag los van order en catalog editor.

## Fase 9: Show Control Service V0

Hypothese: technische cues kunnen snel en stabiel worden uitgevoerd zonder show-logica te bezitten.

Werk:

- Bouw `app/v2/modules/show-control/`.
- Eigen poort: `3025`.
- Cue engine, cue library, target adapters, ack tracking.
- TouchDesigner via een OSC controlpoort plus HTTP payloads.
- SQ5, DMX, camera, Stream Deck, Perfect Cue als adapters.

Bewijs:

- Test: prepare cue stuurt payload en krijgt ack of warning.
- Test: GO cue is non-blocking.
- Test: timeout geeft warning, geen Runtime crash.
- Test: samengestelde cue met kleine delays vuurt in juiste volgorde.
- Test: Show Control kiest geen situation.

Checkpoint voor gebruiker:

- Gebruiker ziet Show Control als uitvoerder, niet als brein.

## Fase 10: Gateway / Dashboard V0

Hypothese: operator kan alles bedienen via een plek zonder dat Gateway domeinlogica krijgt.

Werk:

- Bouw `app/v2/gateway/`.
- Eigen poort: `3020`.
- Routing, health, dashboards, live views.
- Commands worden doorgestuurd naar juiste service.
- Gateway bevat geen Catalog, Paths, Algorithm, Runtime of Show Control beslislogica.

Bewijs:

- Test: dashboard haalt status van alle modules op.
- Test: start/stop gaat via Runtime API.
- Test: cues gaan via Show Control API.
- Test: Gateway kan uitvallen zonder moduledata te corrumperen.

Checkpoint voor gebruiker:

- Gebruiker ziet een operatorplek zonder nieuwe centrale megaserver.

## Fase 11: Shadow Run Tegen V1

Hypothese: V2 kan naast V1 dezelfde showdata verwerken en verklaarbare keuzes maken.

Werk:

- V1 blijft leidend.
- V2 draait in shadow mode.
- V2 leest dezelfde catalogus/paden/signalen waar mogelijk, maar stuurt niets live aan.
- V2 logt eigen decisions en vergelijkt die met V1.

Bewijs:

- Vergelijk V1 en V2 available pools.
- Vergelijk preparedNext en redenatie.
- Log verschillen met oorzaak.
- V2 schrijft niet naar V1.

Checkpoint voor gebruiker:

- Gebruiker ziet of V2 logisch genoeg is om live te vertrouwen.

## Fase 12: Controlled Cutover

Hypothese: V2 kan een volledige showrun draaien met rollback naar V1.

Werk:

- Rehearsal zonder publiek.
- Rehearsal met beperkte targets.
- Technische run met TouchDesigner/Show Control.
- Pas daarna live.

Bewijs:

- Start run, prepare, go, stop en next werken meerdere keren achter elkaar.
- TouchDesigner ontvangt cues en stuurt ack/warnings.
- Algorithm scores veranderen dynamisch, maar Runtime blijft eigenaar van keuze.
- Logs tonen per situation:
  - waarom gekozen;
  - welke cues;
  - welke signalen;
  - welke output.
- Rollback naar V1 blijft mogelijk.

Checkpoint voor gebruiker:

- Go/no-go voor echte overstap.

## Beantwoorde Keuzes Voor De Startprompt

Deze keuzes maken het implementatieplan concreet genoeg om als Codex-doel te gebruiken.

### V1-bron Voor Catalogus

De eerste read-only bron wordt de huidige V1 SQLite database:

```text
app/data/live.sqlite
```

Daarin staan de huidige catalogus- en padentabellen, zoals `algorithm_performers`, `algorithm_characters`, `algorithm_situations`, `algorithm_environments`, `algorithm_labels`, `algorithm_scenes` en `algorithm_paths`.

V2 mag deze database alleen lezen. De V2 adapter moet de V1-tabellen normaliseren naar het nieuwe Catalog read model.

Belangrijk: V2 mag niet schrijven naar `app/data/live.sqlite`, `app/data/live.sqlite-wal` of `app/data/live.sqlite-shm`.

### V2 Locatie

Alle nieuwe V2-code en V2-data komen onder:

```text
app/v2/
```

V1 blijft de oude app en wordt voorlopig alleen gebruikt als legacy bron en werkende referentie.

### V2 Poorten

De V2-poorten worden voorlopig:

```text
3020-3027
```

V1 draait op zijn eigen poort en mag niet door V2 gestoord worden.

### Milestone 1

Milestone 1 is alleen:

```text
Catalog Service V0
```

Er komt nog geen echte Gateway, Runtime, Algorithm, Paths of editor bij. Het punt van milestone 1 is eerst bewijzen dat V2 veilig en read-only V1-catalogusdata kan lezen en daar een eigen V2-contract van kan maken.

Een minimale `/health` route in Catalog Service is genoeg. Een Gateway health-pagina komt later.

### Snapshots Eerst Als JSON

Snapshots beginnen als immutable JSON files onder `app/v2/`.

Waarom JSON eerst:

- je kunt het bestand zelf openen en controleren;
- het is makkelijk te diffen in Git;
- het is minder verborgen dan een nieuwe database;
- het bewijst eerst het datacontract voordat er weer extra databasecomplexiteit bijkomt.

Een V2 sqlite database kan later komen als het contract bewezen is.

### Geen Editor In Catalog V0

Catalog v0 krijgt nog geen editor.

Eerst alleen:

- read-only legacy adapter;
- read model;
- validation;
- immutable snapshots;
- smoke test.

De editor komt pas als bewezen is dat de data klopt en V2 geen V1-bestanden raakt.

### Verplichte Catalog V0 Data

Catalog v0 moet minimaal dit kunnen teruggeven:

- performers;
- personages;
- omgevingen;
- situaties;
- labels;
- media assets.

### Bewijs Voor Milestone 1

Milestone 1 is pas klaar als:

- V1 en V2 tegelijk kunnen bestaan;
- V1 app-code onaangeraakt blijft;
- V1 catalogusdata onaangeraakt blijft;
- V2 Catalog Service op eigen poort draait;
- V2 een read model kan ophalen;
- V2 validatie kan draaien;
- V2 een snapshot kan maken onder `app/v2/`;
- een smoke test dit automatisch bewijst.

## Voorstel Voor Eerste Codex Doel

Gebruik dit als startprompt voor een nieuwe sessie:

```text
Doel:
Start de parallelle V2-herbouw van For You volgens het implementatieplan.

Werk in de For You repo op main met de laatste commit als actuele basis.

Lees eerst:
- app/docs/system-cleanup/nieuw/architecture/00-overzicht.md
- app/docs/system-cleanup/nieuw/architecture/03-losgekoppelde-services.md
- app/docs/system-cleanup/nieuw/architecture/08-v2-implementatieplan.md

Belangrijk:
- V1 blijft de werkende referentie en oracle.
- Bouw V2 apart onder app/v2/.
- Raak bestaande V1 app-code niet aan zonder expliciete toestemming.
- Raak bestaande catalogusbestanden, sqlite-data, exports en legacy brondata niet aan.
- V2 mag V1-data alleen read-only gebruiken via een legacy-readonly adapter.
- V2 draait op andere poorten dan V1.
- Gateway is alleen UI/router, geen domeinbrein.
- Algorithm is score-only: geen order, geen paths, geen preparedNext.
- Runtime is eigenaar van showRun, snapshots, preparedNext, activeSituation, played history en materialisatie.

Eerste taak:
Maak een concreet uitvoeringsplan voor Milestone 1: Catalog Service V0, zonder nog bestanden aan te maken of code te wijzigen.

Beantwoord:
1. welke app/v2/-mappen nodig zijn voor Catalog Service V0;
2. hoe app/data/live.sqlite read-only gelezen wordt zonder V1 te muteren;
3. hoe de V1 algorithm_* tabellen naar het V2 Catalog read model worden genormaliseerd;
4. welke shared contracts als eerste nodig zijn;
5. welke smoke test bewijst dat read-model, validation en snapshots werken;
6. welke commands/tests ik kan draaien om dit zelf te verifieren.

Vraag expliciet akkoord voordat je bestanden aanmaakt of code wijzigt.
```

## Voorstel Voor Milestone 1 Na Akkoord

Als Fase 0 en Fase 1 akkoord zijn, is de eerste bouwstap:

```text
Milestone 1:
Bouw Catalog Service V0 onder app/v2/modules/catalog/.
```

Acceptatiecriteria:

- Legacy app-code is onaangeraakt.
- Bestaande catalogusbestanden blijven onaangeraakt.
- Catalog Service draait als aparte Express-service op eigen poort.
- `GET /health` werkt.
- `GET /v0/catalog/read-model` geeft performers, personages, omgevingen, situaties, labels en assets in nieuw contract terug.
- `GET /v0/catalog/validation` meldt ontbrekende of ongeldige relaties zonder crash.
- `POST /v0/catalog/snapshots` maakt een immutable JSON snapshot onder `app/v2/`.
- Snapshot bevat `snapshotId`, `createdAt`, `source`, `schemaVersion` en catalogusdata.
- Geen Runtime, Algorithm, Paths, Show Control, Audience, Script Agent of Gateway domeinlogica in Catalog.
- Een smoke test kan Catalog v0 starten, read-model ophalen, valideren en snapshot maken.

## Belangrijkste Risico's

### V2 schrijft per ongeluk naar V1

Mitigatie:

- Legacy adapter read-only maken.
- Tests die write attempts blokkeren.
- Snapshots alleen onder `app/v2/`.

### Gateway wordt opnieuw een centrale server

Mitigatie:

- Gateway mag alleen routes, health en UI bevatten.
- Elke domeinactie gaat naar de eigenaarservice.
- Tests/checks op verboden imports.

### Algorithm krijgt opnieuw ordermacht

Mitigatie:

- Algorithm contract publiceert alleen scores.
- Geen preparedNext of available pool in Algorithm output.
- Runtime-test bewijst dat Runtime kiest.

### Paths en Runtime lopen door elkaar

Mitigatie:

- Paths evalueert pathAvailable/pathLocked.
- Runtime bewaart showRun state en past harde volgorderegels toe.
- Runtime werkt vanaf start run op snapshot.

### Catalog wordt te vroeg een editorproject

Mitigatie:

- Catalog v0 begint met read-model, validation en snapshots.
- Editor pas later als contract en data betrouwbaar zijn.

### Shadow mode lijkt te werken maar verklaart niets

Mitigatie:

- Elke Runtime-keuze moet een decision log hebben.
- Verschillen tussen V1 en V2 worden expliciet verklaard.
