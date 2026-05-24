# Algorithm Service Contract v0

Dit document beschrijft het gewenste contract voor het opgeschoonde algoritme. Het is ontwerpdocumentatie, geen implementatie.

## Hoofdbesluit

Algorithm Service is een scoremachine.

Het algoritme bepaalt niet wat speelbaar is, niet wat path locked is, niet wat preparedNext wordt en niet wat de volgorde is. Het berekent alleen scores voor situaties op basis van cataloguscontext en publieksdata.

```text
publieksdata + cataloguscontext
-> Algorithm Service
-> score per situatie
-> Runtime gebruikt scores binnen eigen volgorderegels
```

## Wat Algorithm Wel Doet

Algorithm Service:

- leest alle situaties uit de catalogus of run snapshot;
- leest labels en personages als scorecontext;
- ontvangt publieksdata over gespeelde situaties;
- berekent na elke gestopte situatie een observed score voor die gespeelde situatie;
- werkt daarna predicted scores voor alle situaties bij;
- publiceert een actuele scorelijst voor Runtime;
- logt intern genoeg om later te kunnen debuggen.

De score is open en relatief. Hij hoeft dus geen vaste `0-100` score te zijn. Belangrijker is dat scores vergelijkbaar blijven tussen kleine en grote publieken en tussen korte en lange situaties.

## Wat Algorithm Niet Doet

Algorithm Service mag geen eigenaar zijn van:

- paden;
- path locked;
- available pool;
- start-situaties;
- preparedNext;
- activeSituation;
- played uitsluiten;
- volgorde maken;
- materialisatie van random personages of omgevingen;
- showRun state.

Als Runtime een situatie niet mag spelen, is dat een Runtime/Paths-besluit. Algorithm mag daar geen uitzondering op maken.

## Scoremoment

Tijdens een actieve situatie worden signalen verzameld.

Voorbeelden:

- hearts;
- bored/dislikes;
- ruwe chatberichten;
- duur van de situatie;
- publieksgrootte of actieve client count;
- later eventueel sensorinput.

Na het stoppen van die situatie stuurt Runtime een `situationObserved` event naar Algorithm. Runtime is daarmee de eigenaar van de koppeling tussen publieksinput en de actieve situationRun.

Algorithm berekent dan:

1. observed score voor de net gespeelde situatie;
2. update van het publieksprofiel;
3. predicted scores voor alle situaties.

Dit gebeurt niet pas aan het einde van de hele run. Tijdens de run blijft het scoremodel dus dynamisch meebewegen na elke gespeelde situatie.

## Publieke Chat/App

De publieke telefoon-app is de bron voor:

- `heart`;
- `bored`;
- ruwe chattekst.

`heart` en `bored` tellen alleen tijdens een actieve situatie.

Ruwe chattekst mag in v0 naar Algorithm. De eerste versie hoeft daar nog geen perfecte semantische analyse op te doen. Het contract moet vooral mogelijk maken dat Algorithm later kan leren:

- wat het publiek van deze situatie vond;
- of de chat duidelijk negatief was;
- welke toon of energie in de chat zat;
- welke labels of personages later belangrijk blijken.

Personagepopulariteit mag later uit signalen ontstaan, bijvoorbeeld als een personage consequent goed scoort. Omgevingen blijven in v0 buiten de inhoudelijke score.

## Optionele Sensorinput

De camera/reaction-lab-achtige sensorlaag is niet de publieke chat/app en is niet nodig voor v0.

Het is alleen een optionele toekomstige input voor bijvoorbeeld:

- lachen;
- decibel/reactie;
- aandacht;
- gezichtsuitdrukking;
- beweging;
- applaus of stilte.

Algorithm hoeft in v0 nog niet te weten hoe camera's, microfoons of sensoren technisch werken.

## Inputcontract

Voorbeeld van een observed event na een gestopte situatie:

```json
{
  "type": "situationObserved",
  "showRunId": "run_42",
  "situationRunId": "srun_18",
  "situationId": "sit_18",
  "startedAt": "2026-05-24T20:00:00.000Z",
  "endedAt": "2026-05-24T20:04:30.000Z",
  "durationSeconds": 270,
  "audience": {
    "activeClients": 86
  },
  "chatAppSignals": {
    "heartCount": 34,
    "boredCount": 4,
    "rawMessages": [
      "dit is echt grappig",
      "ok dit is wel saai",
      "Penelope moet terug"
    ]
  },
  "reactionLabSignals": {
    "laughScore": null,
    "energyScore": null
  }
}
```

Algorithm mag daarnaast de volledige cataloguscontext zien:

```json
{
  "situations": [],
  "labels": [],
  "characters": []
}
```

## Outputcontract

Algorithm publiceert scores voor alle situaties.

```json
{
  "type": "situationScoresUpdated",
  "showRunId": "run_42",
  "updatedAfterSituationRunId": "srun_18",
  "scores": [
    {
      "situationId": "sit_18",
      "observedScore": 12.4,
      "predictedScore": 12.4,
      "confidence": 0.8
    },
    {
      "situationId": "sit_22",
      "predictedScore": 9.1,
      "confidence": 0.45
    }
  ]
}
```

`confidence` mag mee, maar Runtime hoeft daar in v0 nog niets mee te doen. Runtime mag simpelweg de score lezen en zelf kiezen binnen eigen regels.

## Relatieve Score

De score moet gecorrigeerd kunnen worden voor:

- publieksgrootte;
- situatie-duur;
- hoeveelheid beschikbare data.

Een situatie met 20 hearts bij 30 actieve kijkers is iets anders dan 20 hearts bij 200 actieve kijkers. Een korte situatie moet ook niet automatisch slechter of beter scoren dan een lange situatie.

De exacte formule is nog niet vastgelegd. Het contract zegt alleen: Algorithm publiceert een vergelijkbare score, niet alleen ruwe tellers.

## Relatie Met Runtime

Runtime leest de scorelijst.

Runtime bepaalt daarna zelf:

- welke situaties beschikbaar zijn;
- welke situaties path locked zijn;
- welke situaties al gespeeld zijn;
- welke situatie preparedNext wordt;
- wanneer een situatie actief wordt;
- welke snapshot gebruikt wordt.

Algorithm hoeft niet te weten welke situatie preparedNext is. Algorithm hoeft ook niet te weten welke situaties eligible zijn. Het scoort alles wat het kent.

## V0-Regel

Hou de eerste versie simpel:

```text
Algorithm scoort situaties.
Runtime maakt volgorde.
Paths bepaalt padvrijgave.
Chat/Public App levert hearts, bored en tekst.
Optionele sensorinput kan later extra signalen leveren.
```
