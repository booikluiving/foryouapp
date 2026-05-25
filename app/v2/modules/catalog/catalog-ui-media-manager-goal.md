# Catalog UI + Media Asset Manager Goal

Dit document beschrijft de volgende V2-stap voor de Catalog module: een echte Catalog editor UI en een losse Media Asset Manager UI.

Het doel is om de oude catalogus- en asset-workflows terug te krijgen op de V2 Catalog Service.

Belangrijk: de oude werkende UI/UX is niet zomaar inspiratie, maar de functionele referentie. If it ain't broken, don't fix it. De onderliggende structuur, data-eigenaarschap, routes en tests moeten naar V2, maar zichtbare workflows blijven zo veel mogelijk gelijk aan V1.

De opdracht is dus niet: ontwerp een nieuwe catalogus of assetmanager. De opdracht is: behoud de bewezen V1-bediening en laat die via de losse V2 Catalog Service werken.

Als de huidige V2 UI al te ver afwijkt van V1 en daardoor moeilijk te herstellen is, behandel die dan als wegwerpbare eerste poging. Probeer die niet cosmetisch op te lappen. Maak liever een schone V1-parity port binnen V2: dezelfde workflow en herkenbare layout, maar met V2 routes, V2 stores en V2 tests.

## Context

Catalog Service V0 bestaat al onder `app/v2/modules/catalog/`.

Tot nu toe leest Catalog V0 legacy data read-only uit V1 en normaliseert die naar een V2 read model. Voor een editor is een extra stap nodig: V2 moet een eigen schrijfbare catalog store hebben. De UI mag nooit terugschrijven naar V1.

## Harde Regels

- Werk alleen onder `app/v2/`.
- Raak V1 app-code, V1 catalogusbestanden en `app/data/live.sqlite*` niet aan.
- Gebruik `app/public/algoritme.html` en de oude serverroutes alleen read-only als referentie.
- Kopieer geen oude monolithische serverstructuur.
- Behoud V1 UI/UX-patronen waar ze goed werken: layout, compacte lijsten, edit-flow, upload-flow en feedback.
- Gebruik de gedeelde V2 stylesheet `app/v2/shared/ui/foryou-v2.css` als visuele basis.
- Elke zichtbare UI-afwijking van V1 moet nodig zijn voor de V2 servicegrens of expliciet gemotiveerd worden.
- Geen placeholder-UI en geen versimpelde herbouw als V1 al een goede workflow had.
- Eerst V1-pariteit bewijzen, daarna pas verbeteren.
- Catalog UI mag geen Runtime, Paths, Algorithm, Show Control, Audience of Script Agent logica bevatten.
- Catalog UI praat alleen met Catalog Service.
- Media Asset Manager hoort bij Catalog Service.
- V1 blijft oracle/importbron; V2 wordt eigenaar van nieuwe catalog edits.

## Oude Referentie

Lees voor gedrag en visuele richting:

- `app/public/algoritme.html`
- de oude catalogussecties voor performers, personages, omgevingen en situaties;
- de oude Media Manager sectie voor drag-and-drop, previews en audio preview;
- relevante oude routes in `app/server.js`, alleen om workflow en velden te begrijpen.

Gebruik dit als harde referentie voor knoppen, edit-flow, visuele compactheid en workflow. Bouw alleen de onderliggende koppeling, routes en opslag opnieuw waar dat nodig is voor V2.

## Gewenste UI Structuur

### Catalog Editor

Een eigen Catalog editor pagina, bijvoorbeeld binnen Catalog Service:

```text
/catalog/
```

De pagina heeft duidelijke secties/tabs:

- Personages;
- Omgevingen;
- Situaties;
- Validatie;
- Snapshots;
- link naar Media Asset Manager.

De UI moet editor-achtig zijn: rustig, compact, scanbaar, geen marketingpagina.

### Media Asset Manager

Een losse Media Asset Manager pagina, bijvoorbeeld:

```text
/catalog/media-assets/
```

De Catalog editor bevat een duidelijke hyperlink naar deze pagina.

## Functionele Eisen: Personages

De Personages sectie moet minimaal kunnen:

- personages tonen;
- personage aanmaken;
- personage aanpassen;
- naam aanpassen;
- omschrijving aanpassen;
- performer(s) toewijzen die dit personage mogen spelen;
- duidelijk tonen welke performer slots beschikbaar zijn;
- opslaan via V2 Catalog Service;
- validation feedback tonen.

Performer-toewijzing moet passen bij het bestaande model: sommige personages kunnen door een performer gespeeld worden, andere door meerdere performers.

## Functionele Eisen: Omgevingen

De Omgevingen sectie moet minimaal kunnen:

- omgevingen tonen;
- omgeving aanmaken;
- omgeving aanpassen;
- naam aanpassen;
- omschrijving aanpassen;
- gekoppelde media assets samenvatten;
- doorklikken naar Media Asset Manager voor assetbeheer;
- validation feedback tonen.

## Functionele Eisen: Situaties

De Situaties sectie moet minimaal kunnen:

- situaties tonen;
- situatie aanmaken;
- situatie aanpassen;
- titel/naam aanpassen;
- omschrijving aanpassen;
- omgeving selecteren;
- 1 tot 3 personages selecteren;
- voorkomen of duidelijk markeren dat twee gekozen personages niet tegelijk speelbaar zijn door beschikbare performer slots;
- validation feedback tonen;
- opslaan via V2 Catalog Service.

Gebruik de bestaande systeemlogica: een situatie is de combinatie van omschrijving, omgeving en 1 tot 3 personages.

## Functionele Eisen: Media Asset Manager

De nieuwe Media Asset Manager moet qua basis lijken op de oude:

- drag-and-drop upload;
- file picker upload;
- afbeelding preview;
- audio preview/afspelen;
- video preview waar relevant;
- assets groeperen per omgeving;
- assets groeperen per type:
  - background;
  - soundscape/audio;
  - fx;
- asset metadata tonen:
  - stable asset ID;
  - environment ID;
  - type;
  - bestandsnaam;
  - pad;
  - mime/extensie;
  - size;
  - created/updated timestamps.

De implementatie moet bewijzen dat media assets in de juiste folder terechtkomen en de juiste metadata/tags krijgen.

Voorgesteld V2 media-root:

```text
app/v2/modules/catalog/media/
  environments/
    <environmentId>/
      background/
      soundscape/
      fx/
```

De media-root moet later configureerbaar blijven, zodat TouchDesigner eventueel direct uit een gedeelde media-map kan lezen.

## IDs En Metadata

Gebruik stabiele V2 IDs. Leg expliciet vast hoe IDs worden gemaakt.

Voorstel:

- `character:<id>`
- `performer:<id>`
- `environment:<id>`
- `situation:<id>`
- `media-asset:<environmentId>:<type>:<hash-or-slug>`

Media asset tags horen in V2 metadata/store, niet alleen in foldernamen.

## Data En Write Model

Als Catalog Service nog geen write-routes heeft, voeg dan V2-only write-routes toe binnen Catalog Service.

Belangrijk:

- writes gaan alleen naar V2 catalog store;
- legacy read-only adapter blijft alleen import/oracle;
- geen V1 writes;
- read model moet V2 edits teruggeven;
- snapshots moeten V2 catalog state kunnen vastleggen.

Het is acceptabel om de eerste V2 catalog store als JSON files onder `app/v2/modules/catalog/db/` te maken, als dit goed getest en uitlegbaar is. Gebruik geen verborgen complexiteit als dat nog niet nodig is.

## Niet In Scope

- Runtime UI;
- Paths editor;
- Universe;
- Algorithm score UI;
- Show Control UI;
- Audience UI;
- Script Agent UI;
- live show control.

## Tests En Bewijs

De implementatie is pas klaar als bewezen is:

- Catalog Service tests blijven groen.
- V1 protected files blijven onaangeraakt.
- UI laadt via V2 Catalog Service.
- Personage create/update werkt.
- Performer assignment bij personages werkt.
- Omgeving create/update werkt.
- Situatie create/update werkt met omgeving + 1 tot 3 personages.
- Ongeldige situatie-combinaties worden geblokkeerd of als validation issue getoond.
- Media upload komt in de juiste V2 folder.
- Media metadata bevat stable ID, environment ID en type.
- Afbeelding preview werkt.
- Audio preview werkt.
- Snapshot/read-model reflecteert edits.
- Geen directe imports uit V1 UI-code.
- Geen Runtime/Paths/Algorithm/Show Control domeinlogica in Catalog UI.

## Checkpoint Output

Stop na deze module en rapporteer:

- welke V1 workflows als referentie zijn gebruikt;
- welke V2 routes/stores zijn toegevoegd;
- hoe IDs voor catalogus en media assets werken;
- waar media files terechtkomen;
- welke tests zijn gedraaid;
- bewijs dat V1 onaangeraakt bleef;
- wat nog read-only of tijdelijk is;
- volgende aanbevolen module-stap.
