# Paden-systeem

Dit document is de werkafspraak voor het padensysteem in de For You app.

## Begrippen

- Een node is een speelbare situatie binnen een show-run. In de code is dit vooral een `algorithm_scenes` record.
- Een pad is een verbonden reeks nodes die samen een verhaallijn vormen.
- Een show-run speelt telkens maximaal een situatie tegelijk.
- Node-statussen zijn run-scoped: reset je de run, dan wordt de padvoortgang opnieuw afgeleid uit de scene-runs van die run.

## Node-statussen

| Status | Betekenis |
|---|---|
| `Locked` | Nog niet speelbaar binnen de huidige run |
| `Available` | Vrijgegeven en startbaar binnen de huidige run |
| `Played` | Al afgerond binnen de huidige run |
| `Blocked` | Binnen de huidige run permanent onspeelbaar door een padregel |

`wordt gespeeld` is een aparte runtime-state voor de ene actieve `algorithm_scene_runs` rij zonder `ended_at`. Een actieve node is niet opnieuw startbaar en wordt pas `Played` wanneer de run wordt afgerond.

## Vrijgeven en voortgang

Wanneer een node binnen de huidige run gespeeld is:

- worden uitgaande verbindingen van paden die deze node bereikt hebben geevalueerd;
- kunnen verbonden nodes `Available` worden;
- wordt een al gespeelde node automatisch overgeslagen zodra een pad hem bereikt, waarna zijn uitgaande verbindingen alsnog worden geevalueerd.

Een gedeelde node opent een ander pad dus pas wanneer dat andere pad de gedeelde node daadwerkelijk bereikt heeft.

## Kruisingen en funnels

Een node kan in meerdere paden zitten. Dat is een kruising.

Wanneer een kruising-node in een pad bereikt wordt en al `Played` is, telt hij als gespeeld voor dat pad en kan dat pad doorlopen.

Een kruising met inkomende verbindingen uit meerdere paden telt als een globale funnel. De inkomende routes uit alle actieve paden tellen mee voor de drempel.

Een node is alleen een startnode wanneer hij in geen enkel actief pad een inkomende verplichte route heeft. Begint een pad op een kruising waar een ander pad naartoe leidt, dan is die node dus geen echte startnode maar een vervolg vanaf de kruising.

Een funnel ontstaat wanneer meerdere inkomende verbindingen naar een node gaan. Funnels kunnen een minimum aantal gespeelde inkomende routes vereisen voordat de target-node `Available` wordt. Zonder ingestelde drempel zijn alle inkomende routes verplicht.

## Eenmalig spelen

Een node kan binnen een run maar een keer gestart/gespeeld worden.

- Heeft een node een actieve scene-run, dan is hij `wordt gespeeld`.
- Heeft een node een afgeronde scene-run, dan is hij `Played`.
- In beide gevallen mag hij niet opnieuw gestart worden binnen dezelfde run.

## Blokkerende nodes

Een pad kan een node markeren als blokkade-node. Zodra die node binnen de huidige run gespeeld is, blokkeert hij de nodes die in dat pad voor hem liggen.

De geblokkeerde nodes worden afgeleid uit de inkomende graph-routes naar de blokkade-node. Nodes die na de blokkade-node komen, worden niet door deze regel geblokkeerd.

Blokkades werken via kruisingen door wanneer dezelfde voorgaande node-id ook in andere paden voorkomt. Een kruising kan per actief pad blokkades uit andere paden negeren, zodat die padcontext speelbaar blijft.

`Blocked` wint binnen de effectieve padcontext van `Available`. Als een node in een ander pad nog geldig beschikbaar is en de blokkade niet via kruisingen doorwerkt, mag die andere padcontext beschikbaar blijven.

## Eindnodes

Een eindnode is expliciet ingesteld per pad.

Wanneer een eindnode binnen een pad gespeeld wordt, sluit dat pad voor de rest van de huidige run. Andere nodes binnen dat pad kunnen dan niet meer gespeeld worden via dat pad.

Een node zonder uitgaande verbindingen is niet automatisch een eindnode. De default is altijd: geen eindnode, tenzij de node expliciet zo is aangevinkt.
