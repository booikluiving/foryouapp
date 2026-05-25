# Catalogus Als Bronmodel

De catalogus is de bronbibliotheek van de voorstelling.

Voor nu heeft de catalogus vier hoofdonderdelen:

- performers;
- personages;
- omgevingen;
- situaties.

Labels horen bij situaties: een situatie krijgt een of meer cataloguslabels via een labelselectie.

Paden zijn voorbereidende regels naast de catalogus. Ze horen inhoudelijk bij de voorbereiding van de voorstelling, maar krijgen een eigen service en eigen opslag zodat catalogusdata en padregels niet door elkaar schrijven.

## Eerste Architectuurbesluit

De catalogus is de bron. Runtime gebruikt bij start run een bevroren catalogus snapshot. Algorithm gebruikt die snapshot alleen om scores te berekenen; Runtime kiest en materialiseert.

De richting wordt:

```text
catalogus snapshot + paden snapshot + algorithm-config -> runtime -> integraties
```

## Performer Slots

Een performer is in dit model een vaste performerslot.

Er zijn drie slots:

| Slot | Camera | Acteur |
| --- | --- | --- |
| Performer slot 1 | Camera 1 | optioneel, configuratie |
| Performer slot 2 | Camera 2 | optioneel, configuratie |
| Performer slot 3 | Camera 3 | optioneel, configuratie |

Het slotnummer is leidend. De acteurnaam is vooral eigen referentie en kan als configuratie aangepast worden.

Een performerslot heeft:

- een slotnummer;
- een vaste fysieke plek;
- een vaste camera;
- optioneel een acteurnaam;
- een koppeling met de personages die op dat slot gespeeld mogen worden.

## Personages

Een personage heeft:

- een naam;
- een omschrijving;
- een lijst performerslots die dit personage mogen spelen.

Een personage is speelbaar door een of meerdere performerslots.

Voorbeelden:

```text
Personage A -> slot 1
Personage B -> slot 1 en slot 3
Personage C -> slot 2
```

De relatie tussen performerslots en personages is dus many-to-many.

## Omgevingen

Omgevingen zijn de speelwerelden, locaties of contexten waarin materiaal kan plaatsvinden.

Een omgeving heeft:

- een naam;
- een omschrijving;
- assets.

Omgevingsassets zijn:

- achtergrond, bijvoorbeeld `.jpg` of `.mp4`;
- audio / soundscape, bijvoorbeeld `.mp3`;
- fx, bijvoorbeeld `.mp4`, `.jpg` of andere TD-bruikbare media.

Assets horen inhoudelijk bij de catalogus, maar de catalogus hoeft de mediabestanden zelf niet door Runtime heen te sturen.

De catalogus beheert vooral asset metadata:

- asset type;
- environment-koppeling;
- stabiel id of naam;
- relatief of absoluut bestandspad;
- optionele notes of tags.

De daadwerkelijke mediabestanden staan in een gedeelde map die TouchDesigner direct kan lezen.

## Situaties

Een situatie is een speelbare compositie.

Een situatie heeft:

- een titel;
- een omschrijving;
- een omgeving;
- 1 tot 3 personages;
- labels.

Een situatie moet speelbaar zijn door de beschikbare performerslots. Dat betekent dat de gekozen personages verdeeld moeten kunnen worden over unieke performerslots.

Niet toegestaan:

```text
Personage A -> alleen slot 1
Personage B -> alleen slot 1
```

Wel toegestaan:

```text
Personage A -> alleen slot 1
Personage B -> slot 1 of slot 2
```

Labels beschrijven inhoudelijke eigenschappen van een situatie. Scores horen hier niet bij: score en volgorde worden pas berekend door het algoritme op basis van runtime, publieksreacties en instellingen.

## Padenregelsysteem

Een pad is een netwerk van voorwaarden op situaties.

De paden-editor bewerkt de regels. Die regels verwijzen naar situaties uit de catalogus, maar kopieren de situatie-inhoud niet tijdens voorbereiding.

Paths Service berekent voor Runtime welke situaties vrijgegeven, locked of blocked zijn. Dat gebeurt op basis van de bevroren paden snapshot, gespeelde situaties, voorgangers, splits, merges, zijtakken, funnels en kruisende paden.

Dit is een harde poort: Algorithm Service geeft scores over situaties, maar maakt geen situatie speelbaar. Runtime gebruikt pathAvailable, harde volgorderegels en scores om zelf te kiezen.

Als een situatie in meerdere paden zit, kan een vrij pad de situatie beschikbaar maken. Een kruisende funnelregel kan die beschikbaarheid nog blokkeren zolang de vereiste routes niet voldaan zijn.

For_universe en de padenvisualisatie lezen Runtime-output en voorbereidende snapshots. Ze tonen de huidige netwerktoestand, maar bepalen niet zelf welke situatie gekozen wordt.

## Invoerkanalen

| Kanaal | Schrijft nu naar | Opmerking |
| --- | --- | --- |
| Catalogus-editor | performers, personages, omgevingen, situaties, situatielabels | Hoofdplek voor redactie in Catalog Service. |
| Media Asset Manager | omgeving-asset metadata + mediapaden | Aparte beheerplek, inhoudelijk gekoppeld aan omgevingen. |
| Catalogusbestanden | performers, personages, omgevingen, situaties, labels | Import/export of gedeelde redactie. |
| Paden-editor | padenregels | Bewerkt harde vrijgaveregels in Paths Service. |

## Uitgaande Modellen

De catalogus levert geen losse directe lijntjes naar elk scherm. Services gebruiken afgeleide modellen via expliciete API-contracten:

| Model | Gebruikt door | Inhoud |
| --- | --- | --- |
| Catalogus read model | Paths Service, Runtime Service, Dashboard | Leesbare catalogus met relaties en validatie. |
| Padenstatus / vrijgave | Runtime Service | Per situatie available, locked of blocked op basis van paden en runtime facts. |
| Runtime / order state | Dashboard, Script Agent, Show Control, integraties | Huidige run, played, active, preparedNext en resolvedPreparedNext. |
| Situation score feed | Runtime Service | Scores per situatie uit Algorithm. Runtime gebruikt die scores, maar Algorithm kiest geen volgorde. |
| resolvedPreparedNext | Teleprompter, TouchDesigner, publiek, operator | Concrete volgende situatie met gekozen personages, performer-slotverdeling en omgeving. |
| Prompt model | Script Agent / API Playground / Operator AI | Tekstuele prompt die uit resolvedPreparedNext en runtime-context is opgebouwd. |
| Integratiepayloads | TouchDesigner, teleprompter, exports | Doelgerichte payload per systeem op basis van Runtime-output, inclusief environment id/name en asset references. |

## Materialisatie

Een situatie kan random of flexibele onderdelen bevatten, zoals een random personage of random omgeving. Die worden niet voor de hele run vooraf opgelost.

Materialisatie gebeurt telkens wanneer een nieuwe preparedNext wordt vastgezet.

Runtime Service materialiseert met:

- de bevroren catalogus snapshot;
- performer-slot regels uit die snapshot;
- preparedNext uit eligiblePool;
- pathLocked als harde grens;
- harde volgorderegels;
- actuele runtime/order state;
- populaire personages, labels en publieksdata.

De uitkomst is resolvedPreparedNext. Vanaf dat moment zijn de gekozen personages, performer-slots, omgeving, seed en promptbasis frozen voor die komende speelbeurt.

Random-resolutie mag geen harde volgorderegel breken. Een random personage of random omgeving mag dus niet alsnog iets kiezen dat door de volgorderegels uitgesloten had moeten worden.

Teleprompter moet runtimebewust zijn. Het script blijft tekst, maar de teleprompter gebruikt resolvedPreparedNext om rolverdeling en performer-slots te verifieren.

TouchDesigner krijgt de omgeving als id of naam plus asset references als dat nodig is. TouchDesigner leest de daadwerkelijke `.jpg`, `.mp3` en `.mp4` bestanden direct uit de gedeelde mediamap.

De dataflow is dus:

```text
Catalog Service -> asset metadata + file paths
Runtime Service -> gekozen omgeving + frozen asset references
TouchDesigner -> leest mediafiles direct uit gedeelde map
```

Runtime streamt de media niet. Runtime bevriest alleen welke omgeving en welke asset references bij de komende of actieve situatie horen.

## Naast De Catalogus Voor Nu

- padenregels;
- prompt- en scoreconfig;
- runtime-runs;
- publieksfeedback;
- integraties.
