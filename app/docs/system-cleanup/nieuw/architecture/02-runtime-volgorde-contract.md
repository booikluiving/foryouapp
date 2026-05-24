# Runtime En Volgorde Contract v0

Dit contract beschrijft vooral het verschil tussen Catalog Service, Paths Service, Algorithm Service, Runtime Service en Show Control Service. Audience en Script Agent bestaan ernaast als eigen modules, maar zijn niet eigenaar van de volgorde. De Dropbox mirror is alleen backup-tool.

Het doel is dat een situatie niet door meerdere systemen tegelijk "gekozen", "vrijgegeven" of "vastgezet" kan worden zonder duidelijke eigenaar. In het doelsysteem draaien deze onderdelen los van elkaar, met eigen Express-routes en eigen databases.

## Kernbegrippen

| Begrip | Betekenis |
| --- | --- |
| showRun | De volledige speelreeks vanaf reset/start tot einde. |
| showRunId | Oplopende id voor een showRun, zodat oude logs niet door de nieuwe run heen lopen. |
| showRunSnapshot | Bevroren kopie van catalogus, paden en algorithm-config op het moment van start run. |
| situatieRun | Een specifieke uitvoering van een situatie binnen een showRun. |
| catalogusPool | Alle actieve, speelbare situaties uit de catalogus. |
| pathAvailablePool | Situaties die door het padenregelsysteem vrijgegeven zijn en nog niet gespeeld zijn. |
| pathLockedPool | Situaties die door het padenregelsysteem nog niet vrijgegeven zijn. |
| eligiblePool | Situaties die pathAvailable zijn en door de harde volgorderegels heen komen. |
| scoreList | De actuele scorelijst van Algorithm Service. Dit is input voor Runtime, geen gekozen volgorde. |
| runtimeCandidates | De door Runtime gesorteerde kandidaten binnen eligiblePool, op basis van scores en runtime-regels. |
| preparedNext | Exact een gekozen volgende situatie. Deze staat vast als keuze. |
| resolvedPreparedNext | preparedNext nadat random personages, random omgeving en performer-slotverdeling concreet zijn gemaakt. Deze staat vast als uitvoer. |
| activeSituation | De situatie die nu speelt. |
| playedSituations | Situaties die succesvol gestopt zijn binnen de huidige showRun. |
| situationSignals | Publieksdata en andere live signalen die tijdens een situationRun worden verzameld. Runtime is eigenaar van de koppeling aan de actieve situationRun. |

## Eigenaarschap

| Laag | Is eigenaar van | Mag niet doen |
| --- | --- | --- |
| Catalog Service | Situaties, personages, performers, omgevingen, assets, labels | Runtime-status opslaan als brondata. |
| Paths Service | Vrijgave: pathAvailable of pathLocked | Scoren of zelf de beste situatie kiezen. |
| Runtime volgorderegels | Harde en zachte eligibility-regels op de concrete reeks | Dramaturgische paden vervangen. |
| Algorithm Service | Situation scores en scoreconfig | State opslaan, ranking kiezen, preparedNext kiezen of pathLocked situaties speelbaar maken. |
| Runtime materialisatie | Materialisatie van preparedNext naar resolvedPreparedNext | pathLocked situaties speelbaar maken of harde volgorderegels negeren. |
| Runtime Service | showRunSnapshot, activeSituation, preparedNext, resolvedPreparedNext, playedSituations, situatieRuns, logs | Catalogusdata overschrijven. |
| Show Control Service | Cue-uitvoering, target status, ack tracking, warnings en retries | Situaties kiezen of runtime history herschrijven. |
| Audience Service | Publieksapp, chat, hearts, bored en signalen | Situaties kiezen of scorelogica bezitten. |
| Script Agent Service | Promptbouw, scripttekst, parser-output, teleprompter en captions | preparedNext kiezen of runtime history herschrijven. |
| Backup mirror tool | Dropbox backup en restore-bestanden | Live waarheid zijn of moduledata direct overschrijven. |
| Operator | Handmatige keuze uit eligible situaties | pathLocked situaties forceren. |

## Basisflow

```text
showRunSnapshot + runtime facts -> Paths Service/evaluator -> available pool
available pool + runtime facts -> Runtime volgorderegels -> eligible pool
eligible pool + Algorithm score feed -> Runtime candidates
Runtime candidates -> Runtime kiest preparedNext
preparedNext + showRunSnapshot + runtime facts -> Runtime materialisatie -> resolvedPreparedNext
resolvedPreparedNext -> start situatie -> activeSituation
activeSituation -> stop situatie -> playedSituations
```

## Volgorderegels

Volgorderegels zijn de laag tussen paden en algoritme.

Paths Service bepaalt of een situatie dramaturgisch vrijgegeven is. Runtime volgorderegels bepalen of een vrijgegeven situatie nu in de concrete reeks mag komen.

### Harde Volgorderegels

Deze regels filteren pathAvailablePool naar eligiblePool:

- als `startSituatiesEerst` aan staat: zolang er ongespeelde startsituaties in pathAvailablePool zitten, komen alleen die startsituaties in eligiblePool;
- geen situatie met overlap in personages direct na elkaar;
- geen situatie met dezelfde omgeving direct na elkaar;
- played situaties komen niet opnieuw in eligiblePool.

Als harde volgorderegels alles zouden blokkeren, mogen ze breken zodat de show niet onnodig stopt. pathLocked mag nog steeds nooit breken.

Deze regels gelden ook voor materialisatie. Een random personage of random omgeving mag niet alsnog een harde volgorderegel breken.

### Zachte Volgorderegels

Deze regels zijn penalties of voorkeuren:

- liever meer spreiding tussen terugkerende personages;
- liever meer spreiding tussen terugkerende omgevingen;
- liever variatie in toon, labels en energie.

De operator mag zachte regels overrulen. Harde regels alleen als ze anders alle eligible situaties blokkeren.

## Lifecycle

### 1. Reset

Reset zet de actieve showRun terug naar beginstand.

Reset maakt een nieuwe showRunId en wist voor de actieve run:

- activeSituation;
- preparedNext;
- resolvedPreparedNext;
- playedSituations;
- runtime-scores;
- pad-unlocks.

Historische logs blijven bewaard om later terug te kunnen kijken.

### 2. Start Run

Bij start run is er nog geen activeSituation.

Het systeem:

1. haalt catalogus snapshot op bij Catalog Service;
2. haalt paden snapshot op bij Paths Service;
3. haalt algorithm-config snapshot op bij Algorithm Service;
4. bewaart deze als showRunSnapshot in Runtime Service;
5. berekent de pathAvailablePool;
6. past harde volgorderegels toe;
7. maakt de eligiblePool;
8. leest de laatste scoreList van Algorithm Service;
9. sorteert eligiblePool zelf op scores en runtime-regels;
10. randomizet als meerdere situaties gelijk scoren;
11. kiest een preparedNext;
12. materialiseert preparedNext naar resolvedPreparedNext;
13. zet resolvedPreparedNext vast;
14. publiceert resolvedPreparedNext naar Runtime consumers en Show Control.
15. Show Control vuurt prepare-cues af naar systemen die de volgende situatie moeten voorbereiden.

Als er geen speelbare situatie is, stopt de flow hard. Er wordt dan geen preparedNext of resolvedPreparedNext gemaakt.

### 3. Start Situatie

Bij start situatie wordt resolvedPreparedNext actief.

Het systeem:

1. maakt een situatieRun aan;
2. zet resolvedPreparedNext om naar activeSituation;
3. maakt preparedNext en resolvedPreparedNext leeg;
4. kiest direct een nieuwe preparedNext uit de dan beschikbare situaties;
5. materialiseert die naar een nieuwe resolvedPreparedNext;
6. publiceert activeSituation en de nieuwe resolvedPreparedNext;
7. Show Control vuurt go-cues en nieuwe prepare-cues af naar de relevante technische systemen.

De actieve situatie telt op dit moment nog niet als played.

### 4. Tijdens Active

Tijdens activeSituation worden situationSignals verzameld.

Voorbeelden:

- likes;
- dislikes of bored;
- chatreacties;
- publieksgeluid;
- cameradata;
- andere sensordata.

Deze data hoort bij de situationRun, niet bij de catalogussituatie zelf.

Algorithm Service mag continu scores opnieuw berekenen op basis van deze data. Daardoor kan de scoreList veranderen.

preparedNext en resolvedPreparedNext veranderen hierdoor niet. Die blijven vast totdat de operator ze handmatig vervangt door een andere eligible situatie, of totdat resolvedPreparedNext gestart wordt.

### 5. Stop Situatie

Bij stop situatie wordt de actieve situatieRun afgerond.

Het systeem:

1. schrijft eindtijd en verzamelde scoredata weg;
2. markeert de situatie als played;
3. sluit de situatieRun;
4. publiceert een `situationObserved` event voor Algorithm Service;
5. laat Runtime met het bevroren padenmodel opnieuw berekenen wat nu vrijgegeven is.

Een situatie telt pas als played na succesvolle stop.

resolvedPreparedNext blijft klaarstaan. Nieuwe pad-unlocks door de zojuist gestopte situatie hebben dus invloed op latere keuzes, niet op de resolvedPreparedNext die al klaarstond.

### 6. Cancel / Failed

Als een actieve situatie technisch of inhoudelijk wordt afgebroken, telt die niet als played.

De situatieRun krijgt dan een status zoals cancelled of failed. De situatie komt terug in de pool, tenzij de operator of een latere regel hem expliciet uitsluit.

## Harde Regels

- pathLocked situaties mogen nooit gestart worden.
- pathLocked situaties mogen niet door de operator of Algorithm Service geforceerd worden.
- preparedNext mag alleen uit eligiblePool komen, behalve als harde volgorderegels anders alles zouden blokkeren.
- preparedNext is frozen zodra hij gezet is.
- resolvedPreparedNext wordt gemaakt zodra preparedNext wordt vastgezet.
- resolvedPreparedNext bevriest concrete personages, performer-slots, omgeving, seed en promptbasis.
- Live publieksdata mag preparedNext niet automatisch vervangen.
- Alleen de operator mag preparedNext vervangen, en alleen door een andere eligible situatie.
- Als preparedNext handmatig verandert, moet resolvedPreparedNext opnieuw gematerialiseerd worden.
- Played situaties worden uitgesloten uit pathAvailablePool.
- Score mag voor pathLocked situaties berekend worden, maar selectie mag alleen uit pathAvailablePool.
- Catalogus en paden zijn vanaf start run bevroren in showRunSnapshot.
- Runtime leest tijdens een actieve run niet uit live editor-data om active/prepared state te bepalen.
- Editors mogen tijdens testen open blijven; wijzigingen gelden pas voor een volgende run of een nieuwe snapshot.
- Algorithm Service schrijft geen preparedNext, activeSituation of playedSituations.
- Als `startSituatiesEerst` aan staat, moeten alle beschikbare startsituaties eerst gespeeld zijn voordat andere beschikbare situaties gekozen mogen worden.
- Als meerdere situaties gelijk scoren, kiest Runtime random tussen die gelijke kandidaten.
- Random personages en random omgevingen worden dynamisch gekozen bij materialisatie van preparedNext, niet vooraf voor de hele showRun.
- Als er geen speelbare situatie is, is dat een harde stop.

## Later Pas Uitwerken

Operator-keuzes, meerdere suggesties of vooruitblik zijn niet nodig voor de kernarchitectuur. Als ze later terugkomen, moeten ze uit eligiblePool komen en mogen ze nooit pathLocked zijn. Voor nu bestaat er precies een preparedNext dat door Runtime wordt gekozen.

## Belangrijke Consequentie

Omdat een situatie pas played wordt bij stop situatie, worden paden pas op dat moment echt verder vrijgegeven.

Als bij start situatie meteen een nieuwe preparedNext wordt gekozen en gematerialiseerd, dan is die keuze gebaseerd op de situatie van dat moment. Nieuwe unlocks door de actieve situatie komen pas beschikbaar voor de keuzes daarna.

Dat is bewust: resolvedPreparedNext moet vroeg genoeg vaststaan zodat teleprompter, show control, TouchDesigner en andere systemen kunnen voorbereiden.

Als preparedNext handmatig wordt gewijzigd door de operator, moet resolvedPreparedNext opnieuw worden opgebouwd en moeten alle systemen die resolvedPreparedNext gebruiken dezelfde update krijgen.

Show Control is daarbij de uitvoeringslaag: Runtime blijft de bron voor active/prepared state, Show Control bewaakt of TD, audio, licht, camera's en bediening hun cues ontvangen en uitvoeren.

## Nog Niet Vastgelegd

Deze punten blijven bewust later:

- welke situationSignals precies worden gemeten;
- hoe situationSignals naar scores worden vertaald;
- welke systemen exact activeSituation, resolvedPreparedNext of beide krijgen;
- hoe lang historische logs bewaard blijven;
- hoe een volledige herstart na alle gespeelde situaties werkt.
