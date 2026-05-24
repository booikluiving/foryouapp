# Losgekoppelde Services Doelarchitectuur

Dit document beschrijft het gewenste nieuwe systeembeeld. Het is ontwerpdocumentatie, geen implementatie.

Het doel is een fundamentele opschoning: catalogus, paden, algoritme, runtime, show control, audience, script agent en dashboard moeten los van elkaar kunnen opereren. De zeven modules hebben eigen Express-servers, eigen databases en communiceren via expliciete routes en live events. Gateway / Dashboard hangt daarboven als bediening en router, niet als domeinbrein.

De Dropbox mirror blijft een simpele backup-tool. Die hoort niet bij de live showlogica en is geen achtste domeinservice.

## Waarom Dit Nodig Is

In het huidige systeem zijn meerdere domeinen historisch samengekomen in dezelfde pagina, dezelfde API-laag en dezelfde databasefamilie.

Daardoor lopen deze verantwoordelijkheden door elkaar:

- brondata bewerken;
- paden voorbereiden;
- runtime state beheren;
- situation scores berekenen;
- technische cues uitvoeren;
- publieksapp, chat en publieksreacties verzamelen;
- AI-script, parser, teleprompter en captions aansturen;
- integraties voeden en controleren;
- live bediening tonen.

Het nieuwe systeem voorkomt dat een wijziging in de catalogus automatisch door dezelfde codepaden naar runtime, algoritme, promptbouw en visualisaties lekt. Elk domein krijgt een duidelijke eigenaar en een expliciet contract.

## Serviceblokken

### Catalog Service

Catalog Service is eigenaar van brondata:

- performers;
- personages;
- omgevingen;
- media assets;
- situaties;
- labels.

Catalog Service schrijft alleen catalogusdata. Andere services lezen catalogus via een read model of een versie/snapshot.

Voor media assets beheert Catalog Service de metadata en paden naar mediabestanden. De mediabestanden zelf kunnen in een gedeelde TD-leesbare map staan.

Binnen Catalog Service hoort de bestaande Media Asset Manager. Die blijft onderdeel van Catalog omdat assets brondata zijn.

Catalog Service mag geen runtime state, preparedNext, activeSituation of scores schrijven.

### Paths Service

Paths Service is eigenaar van voorbereidende padregels:

- start-situaties;
- padennetwerk;
- unlock-relaties;
- path locked-logica;
- crossing/funnel/threshold-regels.

Paths Service verwijst naar situaties uit Catalog Service, maar kopieert de situatie-inhoud niet tijdens voorbereiding.

Tijdens een live run werkt Runtime Service op een bevroren paths snapshot.

### Algorithm Service

Algorithm Service is eigenaar van scores:

- scoreconfig;
- observed scores na een gespeelde situatie;
- predicted scores voor alle situaties;
- relatieve normalisatie voor publieksgrootte en duur;
- intern scorelog.

Algorithm Service mag de hele catalogus of run snapshot zien en mag publieksdata verwerken. Het mag geen paden, available pool, preparedNext, played uitsluiting, ranking of volgorde bepalen. Runtime leest de scores en maakt daarna zelf de keuze binnen eigen regels.

### Runtime Service

Runtime Service is eigenaar van de live voorstelling:

- showRun;
- showRun snapshot;
- preparedNext;
- resolvedPreparedNext;
- activeSituation;
- situationRuns;
- playedSituations;
- situationSignals;
- gelezen situation scores;
- logs.

Bij start run bevriest Runtime Service een volledige snapshot van catalogus, paden en algorithm-config. Vanaf dat moment gebruikt de actieve run die snapshot, niet de live editor-data.

Runtime kiest en materialiseert. Algorithm publiceert alleen scores.

### Show Control Service

Show Control Service is eigenaar van technische uitvoering:

- cue records;
- cue fan-out naar meerdere targets tegelijk of geordend met kleine delays;
- target status;
- ack tracking;
- warnings;
- retries;
- panic actions;
- optionele debug logging.

Show Control leest Runtime-output, maar kiest geen situatie. Het krijgt bijvoorbeeld activeSituation of resolvedPreparedNext van Runtime Service en vertaalt die naar cues voor TouchDesigner, SQ5, DMX/licht, camera's, teleprompter, Stream Deck feedback en andere hardware.

TouchDesigner krijgt snelle cues via een enkele OSC-controlpoort. Grote of gestructureerde payloads kunnen via Express routes opgehaald worden. Licht blijft via Show Control/Art-Net lopen; TD is niet de centrale lighthub. Targets geven lichte status of ack terug aan Show Control.

Show Control schrijft geen Runtime state. Runtime blijft eigenaar van preparedNext, activeSituation en played history.

### Audience Service

Audience Service is eigenaar van de publieke kant:

- public app;
- chat;
- hearts;
- bored;
- publieksreacties;
- moderatie;
- sessies/toegang;
- signal normalizer.

Audience Service is de bron van ruwe publieksinput. Runtime Service is eigenaar van de koppeling tussen publieksinput en de actieve situationRun. Audience mag de actieve situatie tonen aan het publiek, maar bepaalt niet zelf welke situationRun waar is. Algorithm Service mag de gekoppelde signalen lezen of ontvangen om scores te berekenen.

### Script Agent Service

Script Agent Service is eigenaar van AI-script en tekstverwerking:

- API Playground;
- Operator AI;
- prompt builder;
- text parser;
- teleprompter;
- live captions;
- script-output.

Script Agent leest resolved Runtime-output en catalogus/run snapshots via contracten. Het bouwt prompts, verwerkt gegenereerde tekst, maakt parser-output en voedt teleprompter/captions.

Script Agent kiest geen preparedNext en schrijft geen runtime-order. Het schrijft alleen eigen script-, prompt-, parser- en caption-state.

### Gateway / Dashboard

Gateway / Dashboard is geen domeineigenaar.

Het dashboard:

- toont editor- en live-schermen;
- routeert commands naar de juiste service;
- leest service state via API's;
- luistert naar live events;
- bevat geen domeinlogica.

Gateway mag dus niet zelf bepalen wat path locked is, welke situatie wint, of welke random omgeving gekozen wordt.

### Dropbox Backup Mirror

De Dropbox mirror is ondersteunend gereedschap, geen live module.

De mirror:

- maakt backups via publieke modulecontracten of exports;
- kan restore-bestanden klaarzetten;
- schrijft niet direct in module-databases;
- is geen live bron voor Runtime, Algorithm, Paths of Show Control.

OpenAI catalog export/import hoort niet in de nieuwe kern.

## Mapstructuur

Het doelbeeld gebruikt zeven module-eilanden plus een Gateway / Dashboard.

```text
app/
  gateway/
    dashboard/
    routing/
    health/
    auth/

  modules/
    catalog/
      editor/
      media-asset-manager/
      import-export/
      validation/
      read-model/
      contracts/
      db/

    paths/
      editor/
      rules-engine/
      universe/
      contracts/
      db/

    algorithm/
      scoring/
      score-history/
      optional-inputs/
      contracts/
      db/

    runtime/
      run-control/
      snapshots/
      order-state/
      materialization/
      run-log/
      contracts/
      db/

    show-control/
      cue-engine/
      cue-library/
      adapters/
        touchdesigner/
        sq5/
        cameras/
        dmx/
        streamdeck/
        perfect-cue/
      status/
      contracts/
      db/

    audience/
      public-app/
      chat/
      reactions/
      moderation/
      sessions/
      signal-normalizer/
      contracts/
      db/

    script-agent/
      api-playground/
      operator-ai/
      prompt-builder/
      text-parser/
      teleprompter/
      live-captions/
      script-output/
      contracts/
      db/

  tools/
    dropbox-mirror/
      backup/
      restore/
      status/

  shared/
    contracts/
    event-types/
    schema-utils/
```

`shared` mag alleen contracten, schemas, event types en kleine schema-hulpen bevatten. Geen gedeelde businesslogica.

## Communicatie

Services communiceren via expliciete vormen:

| Vorm | Gebruik |
| --- | --- |
| Express routes | Commands en queries, zoals catalogus lezen, run starten en scorelijsten lezen. |
| SSE/WebSocket events | Live status, preparedNext updates, activeSituation updates, warnings en dashboard refresh. |
| OSC | Snelle realtime cues tussen Show Control en TouchDesigner. |
| Art-Net | DMX/licht-uitvoer vanuit Show Control. |

Er zijn geen directe imports van businesslogica tussen services.

Toegestaan om te delen:

- contracten;
- schemas;
- API types;
- minimale generated clients zonder domeinbeslissingen.

Niet toegestaan om te delen:

- catalogus write-logica;
- paden-evaluatie als interne helper buiten Paths Service;
- algoritme-scorelogica als interne helper buiten Algorithm Service;
- runtime materialisatie buiten Runtime Service.
- cue orchestration buiten Show Control Service.
- promptbouw/parser-logica buiten Script Agent Service.
- backup/restore-logica buiten de Dropbox mirror tool.

## Start Run Snapshot

Voor start run mogen catalogus, paden en algorithm-config bewerkt worden.

Bij start run:

1. Runtime Service vraagt Catalog Service om een catalogus snapshot.
2. Runtime Service vraagt Paths Service om een paths snapshot.
3. Runtime Service vraagt Algorithm Service om de actieve algorithm-config.
4. Runtime Service bewaart deze drie snapshots in zijn eigen database.
5. De run gebruikt vanaf dat moment alleen deze bevroren data.

Cataloguswijzigingen en padenwijzigingen na start run horen bij voorbereiding voor een volgende run. De editor hoeft technisch niet dicht te gaan tijdens testen; de actieve run negeert die live edits gewoon omdat Runtime op de snapshot werkt.

## Prepared Next

Prepared next ontstaat in Runtime Service:

1. Runtime bepaalt runtime facts uit de eigen run state.
2. Runtime evalueert path available en path locked op basis van het bevroren paths snapshot.
3. Runtime past harde volgorderegels toe.
4. Runtime leest de situation score feed van Algorithm Service.
5. Runtime kiest preparedNext.
6. Runtime materialiseert naar resolvedPreparedNext.
7. Runtime publiceert resolvedPreparedNext naar consumers.

Algorithm Service mag nooit een path locked situatie speelbaar maken.

Random personage- en omgevingskeuzes horen bij Runtime Service, omdat ze onderdeel zijn van de concrete uitvoering.

## Live Consumers

Teleprompter, TouchDesigner, API Playground, Universe, publiek en dashboard lezen de live werkelijkheid uit Runtime Service, Script Agent Service of Show Control Service, afhankelijk van hun rol.

Ze lezen niet rechtstreeks uit Catalog Service om te bepalen wat nu speelt. Catalogus blijft brondata; Runtime is de waarheid van de actieve run.

Voor systemen die technische acties uitvoeren geldt: Runtime publiceert welke situatie actief of voorbereid is. Show Control maakt daar cues van, stuurt die naar targets en bewaakt de ack/status.

Voor TouchDesigner betekent dit: Show Control stuurt commands voor fases, camera's, environment/assets, audio, webstages, captions en status. TouchDesigner leest de `.jpg`, `.mp3` en `.mp4` bestanden zelf direct uit de gedeelde mediamap op basis van stabiele IDs/file refs.

Voor AI-script, tekstparser, teleprompter en live captions betekent dit: Script Agent leest Runtime-output en schrijft eigen tekst/caption-state. Show Control mag Script Agent cueen voor prepare/go, maar neemt geen promptbouw of tekstparser-logica over.

## Basisregels

- Catalogus is bevroren vanaf start run.
- Paden zijn bevroren vanaf start run.
- Runtime werkt tijdens de run alleen op snapshots.
- Algorithm publiceert scores en schrijft geen live state.
- Runtime kiest, materialiseert en schrijft live state.
- Show Control voert cues uit, bewaakt target-status en schrijft geen Runtime state.
- Audience verzamelt publiekssignalen en kiest geen volgorde.
- Script Agent bouwt en verwerkt tekst, maar kiest geen situatie.
- Dropbox mirror maakt backups/restores via contracten en is geen bron van live waarheid.
- Dashboard toont en stuurt, maar is geen eigenaar van domeinlogica.
- Services delen contracten, geen interne functies.
