# For You

For You is het digitale regie- en publiekssysteem voor een interactieve livevoorstelling. Het verbindt de telefoon van het publiek met de inhoudelijke regie, AI-ondersteuning en de technische systemen op het podium.

Het publiek neemt via een QR-code deel aan de voorstelling en kan live chatten, reageren en stemmen. Die input wordt tijdens de show verwerkt naast vooraf gemaakte personages, omgevingen, situaties en dramaturgische paden. De regisseur houdt de controle over wat er daadwerkelijk wordt gespeeld. For You ondersteunt vervolgens de tekstproductie en stuurt technische cues naar onder andere TouchDesigner, audio, licht en camera's.

## Hoe een voorstelling werkt

1. **Voorbereiden** - De redactie vult de catalogus met performers, personages, omgevingen en speelbare situaties.
2. **Verhaallijnen maken** - In de padeneditor wordt vastgelegd welke situaties bij elkaar passen, welke richtingen mogelijk zijn en welke overgangen geblokkeerd moeten worden.
3. **Een show starten** - Bij de start maakt Runtime een vaste momentopname van de catalogus, paden en algoritme-instellingen. Daardoor blijft een lopende voorstelling stabiel, ook als bronmateriaal later wordt aangepast.
4. **Het publiek laten deelnemen** - Bezoekers scannen een QR-code en sturen berichten, reacties en stemmen via hun telefoon. Moderatie en simulatie kunnen vanuit de publieksbediening worden aangestuurd.
5. **De volgende situatie voorbereiden** - Het algoritme geeft mogelijke situaties een score op basis van de actuele show en publieksinput. Runtime combineert die scores met de dramaturgische regels en bereidt de volgende mogelijkheid voor.
6. **Spelen en bijsturen** - De regisseur ziet de actuele status, kan keuzes controleren en start of stopt situaties vanuit de bediening.
7. **Tekst en techniek uitvoeren** - Script Agent maakt of verwerkt speeltekst, telepromptertekst en captions. Show Control verstuurt de bijbehorende cues naar de technische systemen van de voorstelling.

Het algoritme bepaalt dus niet zelfstandig de voorstelling. Het waardeert mogelijkheden; Runtime bewaakt de volgorde en de regisseur houdt de uiteindelijke controle.

## Onderdelen

| Onderdeel | Verantwoordelijkheid |
| --- | --- |
| **Catalog** | Bron voor performers, personages, omgevingen, situaties, labels en media. |
| **Paths** | Dramaturgische paden, overgangsregels en de visuele verhaallijn. |
| **Algorithm** | Berekent en publiceert scores voor mogelijke situaties. |
| **Runtime** | Beheert de actieve voorstelling, volgorde, actuele situatie en voorbereide volgende stap. |
| **Audience** | Publieksapp, QR-toegang, chat, reacties, polls, moderatie en simulatie. |
| **Script Agent** | AI-ondersteunde tekstproductie, promptopbouw, parser, teleprompter en captions. |
| **Show Control** | Bereidt technische cues voor en voert ze uit richting beeld, audio, licht, camera's en bediening. |
| **Gateway / Dashboard** | Centrale status- en bedieningslaag voor de losse onderdelen. |

## Systeemflow

```text
Catalogus + paden + instellingen
              |
              v
           Runtime <----- Algorithm <----- Publieksinput
              |
              +----------> Script Agent ----> Tekst / teleprompter / captions
              |
              +----------> Show Control ----> TouchDesigner / audio / licht / camera
```

## Belangrijkste schermen

Wanneer alle onderdelen lokaal op hun standaardpoorten draaien:

| Scherm | Adres |
| --- | --- |
| Centraal dashboard | `http://127.0.0.1:3020/` |
| Catalogus | `http://127.0.0.1:3021/catalog/` |
| Media | `http://127.0.0.1:3021/catalog/media-assets/` |
| Padeneditor | `http://127.0.0.1:3022/editor/` |
| Verhaaluniversum | `http://127.0.0.1:3022/universe/` |
| Algoritmebediening | `http://127.0.0.1:3023/algorithm/` |
| Runtimebediening | `http://127.0.0.1:3024/runtime/` |
| Show Control | `http://127.0.0.1:3025/show-control/` |
| Publieksapp | `http://127.0.0.1:3026/` |
| Publieksbeheer | `http://127.0.0.1:3026/admin` |
| AI- en tekstbediening | `http://127.0.0.1:3027/script-agent/operator` |

## Installeren

Vereist: Node.js `23.10.0` of nieuwer.

```bash
git clone https://github.com/booikluiving/foryouapp.git
cd foryouapp
npm install
```

## Lokaal starten

De onderdelen draaien als losse services. Start ieder commando in een eigen terminal en start het dashboard als laatste:

```bash
npm run catalog:start
npm run paths:start
npm run algorithm:start
npm run runtime:start
npm run audience:start
npm run script-agent:start
npm run show-control:start
npm run gateway:start
```

De standaardpoorten lopen van `3020` voor de Gateway tot en met `3027` voor Script Agent. Ze zijn per service aanpasbaar met de bijbehorende omgevingsvariabele, bijvoorbeeld `GATEWAY_PORT`, `CATALOG_PORT` of `RUNTIME_PORT`.

## Testen

Iedere service heeft een eigen smoke-test:

```bash
npm run catalog:smoke
npm run paths:smoke
npm run algorithm:smoke
npm run runtime:smoke
npm run audience:smoke
npm run script-agent:smoke
npm run show-control:smoke
npm run gateway:smoke
```

Voor gerichte tests zijn daarnaast per module `:test`-commando's beschikbaar in [`package.json`](package.json).

## Repositorystructuur

```text
.
|-- gateway/        # Centraal dashboard en routering
|-- modules/        # Catalog, Paths, Algorithm, Runtime, Audience, Script Agent en Show Control
|-- shared/         # Gedeelde contracten, schemas en minimale UI-basis
|-- show/           # TouchDesigner-showbestanden, demo's en technische showassets
|-- docs/           # Architectuur, protocollen en projectdocumentatie
`-- package.json    # Start- en testcommando's voor alle services
```

De services hebben ieder een eigen verantwoordelijkheid en opslag. Ze delen alleen expliciete contracten en minimale clients. Hierdoor kunnen publieksinteractie, inhoudelijke logica, AI-tekst en technische showuitvoering afzonderlijk worden ontwikkeld en getest, terwijl ze tijdens een voorstelling als een geheel samenwerken.
