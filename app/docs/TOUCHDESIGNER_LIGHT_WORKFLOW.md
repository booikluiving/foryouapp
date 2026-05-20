# TouchDesigner Light workflow

Deze README is het startpunt voor nieuwe sessies rond TouchDesigner Light, de For You showserver, preview, teleprompters, captions, camera's en omgevingen.

Belangrijkste afspraak:

```text
Lees eerst deze lokale repo/documentatie.
Werk daarna voor TouchDesigner en show-hardware altijd op de Mac Studio zelf.
Mirror of kopieer geen complete Mac Studio-mappen naar deze MacBook.
```

## Machines

### Lokale MacBook / Codex workspace

Gebruik deze plek eerst om context te lezen:

```text
/Users/booikluiving/Library/CloudStorage/SynologyDrive-home/For You/App
```

Deze lokale workspace is geschikt voor:

- documentatie lezen en bijwerken;
- For You webapp-code analyseren;
- plannen maken;
- prompts voor vervolgsessies bewaren;
- lokale codewijzigingen in de app-repo, als daar expliciet om gevraagd is.

Gebruik deze lokale workspace niet voor:

- TouchDesigner showfiles draaien;
- Dropbox-showmappen spiegelen;
- hardware, camera's of DeckLink-output testen;
- complete Mac Studio-mappen kopiëren.

### Mac Studio

De Mac Studio is de show-machine. Daar staan en draaien:

- TouchDesigner;
- Blackmagic/DeckLink hardware;
- camera inputs;
- teleprompter outputs;
- main/stage output;
- Companion/Stream Deck;
- de live For You showserver.

Benaderen via Tailscale/SSH:

```bash
ssh foryou-studio
```

Als de SSH-alias ontbreekt, zoek eerst de bestaande Tailscale/SSH-configuratie uit. Ga niet raden door mappen lokaal te spiegelen.

Bekende showserver-URL's op de Mac Studio:

```text
http://127.0.0.1:3310
http://127.0.0.1:3310/admin
http://100.98.7.121:3310/admin
```

`100.98.7.121` is de verwachte Tailscale-route. Controleer hem opnieuw als verbinding faalt.

## Belangrijke paden op de Mac Studio

For You app op de Mac Studio:

```text
/Users/for_you/ForYou/main/app
```

Current TouchDesigner showfiles:

```text
/Users/for_you/Library/CloudStorage/Dropbox/Current Touch Designer Version
```

Let op: in oudere scripts/docs komen varianten voor met andere hoofdletters of zonder spatie tussen `Touch` en `Designer`. Gebruik bij twijfel een zoekcommando op de Mac Studio in plaats van een map lokaal na te maken.

Veilig zoekcommando:

```bash
ssh foryou-studio "find '/Users/for_you/Library/CloudStorage/Dropbox' -maxdepth 2 -type d -iname 'Current Touch*Designer*Version' -print"
```

Relevante current files die eerder zijn gevonden:

```text
API AI systeem- week 3 v1.toe
API AI systeem- week 3 v1.9.toe
For You V15 - week 3 (2023TD) v3.toe
For You V15 - week 3 (2023TD) v3.37.toe
For You V15 - week 3 (2023TD) v3.33 OSC3 green off.toe
```

Eerder geverifieerd op 2026-05-19:

```text
API v1.toe == API v1.9.toe
For You v3.toe == For You v3.37.toe
```

Controleer dit opnieuw als je op een later moment verder werkt.

TD-light/POC-map op de Mac Studio:

```text
/Users/for_you/Library/CloudStorage/Dropbox/For You/Voorstelling/show/td-light
```

Waarschuwing: maak geen tweede `td-light`, `show`, `Voorstelling` of Dropbox-mirror aan op de MacBook. Werk op de Mac Studio in de bestaande Dropbox-structuur.

## Bestaande docs om eerst te lezen

Lees lokaal in deze repo:

```text
app/MAC_STUDIO_SETUP.md
app/docs/stream-deck/README.md
app/docs/stream-deck/open-current-touchdesigner.sh
app/README.md
```

Gebruik daarna SSH naar de Mac Studio voor live checks.

## Veilige basischecks

Status showserver:

```bash
ssh foryou-studio "cd /Users/for_you/ForYou/main/app && ./scripts/mac-studio-status.command"
```

TouchDesigner status/selectie via Stream Deck helper:

```bash
ssh foryou-studio "/Users/for_you/ForYou/main/app/docs/stream-deck/open-current-touchdesigner.sh status"
ssh foryou-studio "/Users/for_you/ForYou/main/app/docs/stream-deck/open-current-touchdesigner.sh selected"
```

Als het script op de Mac Studio op een andere plek staat, zoek eerst:

```bash
ssh foryou-studio "find /Users/for_you/ForYou -name open-current-touchdesigner.sh -print"
```

## TouchDesigner analyse

Voor analyse van `.toe` files:

- werk op de Mac Studio;
- kopieer alleen de specifieke `.toe` naar een tijdelijke analysemapping;
- expand met `toeexpand`;
- vergelijk `.toe.dir` mappen;
- wijzig het origineel niet.

Aanbevolen tijdelijke map:

```text
/tmp/td_current_research_YYYYMMDD
```

Voorbeeld:

```bash
ssh foryou-studio "mkdir -p /tmp/td_current_research_20260520"
```

Gebruik `toeexpand` op de Mac Studio:

```bash
ssh foryou-studio "'/Applications/TouchDesigner.app/Contents/MacOS/toeexpand' --help"
```

Nooit doen zonder expliciete opdracht:

- originele `.toe` bestanden overschrijven;
- live TouchDesigner project muteren;
- Dropbox-mappen vanaf Mac Studio naar MacBook mirroren;
- `rsync` of `scp -r` gebruiken op de showmappen;
- cleanup of delete-acties uitvoeren in Dropbox;
- hardware outputs activeren in een testbestand zonder duidelijke testafspraak.

## Ontwerpafspraak

De gewenste systeemgrens:

```text
For You webapp = brain, state, operatorlogica, teleprompter/captions, preview UI
TouchDesigner = video-engine, camera/keying, DeckLink outputs, compositing, local media/audio playback
```

TouchDesigner Light moet dus niet opnieuw een alles-in-een-AI/text/OSC-spaghetti worden. Het moet een schone showlaag boven bewezen hardwareblokken worden.

## Huidige kennis uit onderzoek

Huidige For You TD-route:

```text
/ForU/cam_bg_mix
```

Bestaande fases/switches in het huidige bestand:

```text
buttonRadio2.Value0 = 0 -> INLOOP/out1
buttonRadio2.Value0 = 1 -> Waitscreens/null11
buttonRadio2.Value0 = 2 -> camera/main composition
```

Bestaande camera-switch:

```text
/ForU/cam_bg_mix/switch1
buttonRadio.Value0 = 0/1/2
```

Bestaande Stream Deck camera-mappings:

```text
OSC25 -> camera 1
OSC26 -> camera 2
OSC27 -> camera 3
```

Bestaande fase-mappings:

```text
OSC2 -> fase 0 / inloop
OSC3 -> fase 1 / wait/operator-achtig
OSC6 -> fase 2 / cams
```

Belangrijke outputstructuur:

```text
DeckLink out1 -> Teleprompt 1, 1920x1080p25
DeckLink out2 -> Teleprompt 2, 1920x1080p25
DeckLink out3 -> Teleprompt 3, 1920x1080p25
DeckLink out4 -> main/stage, 3840x2160p60
```

Belangrijke web renders in huidig TD:

```text
/universe/stage
/stage/session-qr
/stage/wifi-qr
/stage
/api-playground/stage
```

Teleprompter nieuw gewenst:

```text
/teleprompter-parser/stage
```

Captions gewenst:

```text
zelfde cue-state als teleprompter, aparte transparent caption stage
```

Omgeving/muziek:

```text
/ForU/AI/Background
/ForU/AI/Sound
/ForU/AI/null2
```

De bestaande media-assets en basename-conventie zijn waardevol. De oude API/Dropbox `CURRENT_ENVIRONMENT` route is legacy en liever niet de nieuwe bron van waarheid.

## Gefaseerde aanpak

### Huidige Mac Studio status - 2026-05-20

De Mac Studio repo staat op `main` met de live showserver op poort `3310`.

Bewezen gezond in deze sessie:

```text
GET /health
GET /admin/td-preview
GET /admin/td-preview/state
GET /teleprompter-parser/stage
GET /teleprompter-parser/live-captions
GET /api/teleprompter-parser/current
```

Let op bij faseplanning: Fase 2 is de web-previewlaag, maar de huidige code
bevat ook al teleprompter/caption-routes uit Fase 3. In Dropbox staat bovendien
al een TD-light POC-map met een `/ShowLight/preview_bus` in de geëxpande
`.toe.dir`. Behandel de komende stap daarom als contract- en betrouwbaarheidswerk
tussen webapp en TD-light previewbus, niet als een volledig lege Fase 2.

### Fase 1: inventarisatie current workflow

Doel: niets wijzigen, alleen bewijzen hoe het huidige TD-bestand werkt.

Startprompt:

```text
Onderzoek het huidige TouchDesigner-systeem voor For You. Implementeer niets.

Werk op de Mac Studio zelf via SSH/Tailscale. Lees wel eerst deze lokale README en bestaande docs.
Mirror of kopieer geen complete Mac Studio- of Dropbox-mappen naar de MacBook.

Focus op:
- current TouchDesigner files in Dropbox / Current Touch Designer Version
- fases/inloop/operator/cams of vergelijkbare showstates
- camera inputs en keying
- DeckLink outputs
- teleprompters
- web render TOPs
- Stream Deck / OSC mappings
- achtergrond/omgeving/muziek
- captions/tekst/teleprompter routing

Maak een compact rapport:
1. welke onderdelen bestaan al
2. welke nodes/routes relevant zijn
3. wat veilig overgenomen kan worden
4. wat legacy/risicovol lijkt
5. welke aannames nog getest moeten worden

Niet wijzigen. Alleen lezen/analyseren.
```

Verificatie:

```text
Rapport bevat echte node-paden, outputnamen, bestandsnamen en commando-output.
Geen bronbestanden gewijzigd.
Geen Mac Studio-mappen gemirrord.
```

### Fase 2: preview webapp alleen

Doel: zichtbaarheid bouwen zonder TD-hardware nodig te hebben.

Startprompt:

```text
Bouw alleen de web previewlaag in de For You app.

Maak /admin/td-preview met:
- tab Web Stages
- tab Hardware Stages
- iframes/previews voor bestaande webstages
- placeholder/simulated hardware frames
- state endpoint voor preview status

Raak TouchDesigner niet aan.
Gebruik een andere lokale poort als 3010/3310 bezet is.
Verifieer in browser dat de pagina werkt en dat simulated frames/stale states zichtbaar zijn.
Eindig met URLs, gewijzigde files en testresultaat.
```

### Fase 3: teleprompter + captions webstate

Doel: een enkele cue-state voor teleprompter en captions.

Startprompt:

```text
Werk alleen aan de teleprompter/caption webstate.

Gebruik deze routes als basis:
- GET /teleprompter-parser
- GET /teleprompter-parser/stage
- GET /api/teleprompter-parser/current
- POST /admin/teleprompter-parser/parse

Voeg alleen toe wat nodig is om captions uit dezelfde cue-state te laten komen als de teleprompter.
Maak geen TouchDesigner-aanpassingen.

Verifieer:
- parserpagina werkt
- stage toont huidige cue
- captions-view toont dezelfde cue/state
- API current geeft consistente read-only state
```

### Fase 4: TD-light kopie maken

Doel: veilige kopie van het bewezen TD-bestand, nog geen grote verbouwing.

Startprompt:

```text
Maak een veilige TD-light proof-of-concept vanuit de huidige v3.37 TouchDesigner file.

Werk op de Mac Studio zelf.
Wijzig het originele bestand niet.
Maak geen lokale MacBook-mirror van Dropbox.

Maak een kopie in:
/Users/for_you/Library/CloudStorage/Dropbox/For You/Voorstelling/show/td-light

Zet hardware outputs waar nodig veilig/inactive tenzij expliciet getest moet worden.
Documenteer exact welke verschillen er zijn tussen origineel en kopie.

Nog geen nieuwe showlogica bouwen.
Eindig met diff/vergelijking en conclusie of de kopie veilig is.
```

### Fase 5: preview bus vanuit TD

Doel: TD stuurt lage-FPS previews naar de webapp.

Huidige stand: de webapp heeft `/admin/td-preview` en
`/admin/td-preview/frame`; de TD-light POC bevat al een `/ShowLight/preview_bus`
met bronselects voor `cam*_raw`, `cam*_key`, `main_out` en `tp*_out`.
De preview-state kan nog steeds `hasFrame:false` tonen zolang TouchDesigner niet
draait of de sender-loop geen frames post.

Startprompt:

```text
Werk alleen in de TD-light kopie op de Mac Studio.

Voeg een preview_bus toe die JPEG previews kan leveren/posten voor:
- cam1_raw
- cam1_key
- cam2_raw
- cam2_key
- cam3_raw
- cam3_key
- main_out
- tp1_out
- tp2_out
- tp3_out

Gebruik lage FPS. Geen broadcastkwaliteit.
Laat bestaande camera/output-routing intact.
Verifieer dat de webapp previewframes ontvangt of dat simulated/testframes correct door de TD-route gaan.
```

### Fase 6: ShowLight fases

Doel: de drie fases in TD-light schoon maken.

Startprompt:

```text
Werk alleen in de TD-light kopie op de Mac Studio.

Onderzoek eerst de bestaande fase/switch-logica in het bronbestand.
Maak daarna een schone /ShowLight laag met drie fases:
- inloop
- operator
- cams

Binnen cams moet geschakeld kunnen worden tussen camera1, camera2 en camera3.

Belangrijk:
- neem bewezen bestaande routes over waar mogelijk
- breek Stream Deck/OSC niet onnodig
- geen oude AI/PROMPT_UI/textformatter als bedienlaag gebruiken
- documenteer welke oude nodes nog gebruikt worden

Verifieer met duidelijke TD-state of preview output dat elke fase zichtbaar schakelt.
```

### Fase 7: omgeving + muziek

Doel: bestaande environment/media-logica behouden, maar schoon aansturen.

Startprompt:

```text
Werk alleen in de TD-light kopie op de Mac Studio.

Onderzoek het bestaande achtergrond/omgeving/muziek systeem.
Maak of ontwerp een schone environment_media module die op basis van environmentName kiest:
- background image/video
- music file
- optional FX overlay

Behoud bestaande media-assets en naamconventies.
Gebruik de oude API/Dropbox CURRENT_ENVIRONMENT route niet als primaire bron van waarheid, tenzij tijdelijk als fallback.
Maak zichtbaar in preview welke environment, background en music actief zijn.

Verifieer met minimaal twee omgevingen.
```

### Fase 8: Stream Deck normaliseren

Doel: Stream Deck niet meer als losse directe TD-spaghetti.

Startprompt:

```text
Onderzoek de huidige Stream Deck / OSC mappings.
Implementeer alleen een minimale genormaliseerde route als dat veilig kan:

Stream Deck -> webapp -> TD-light OSC

Commands:
- /tdlight/phase inloop|operator|cams
- /tdlight/main/source camera1|camera2|camera3|stage
- /tdlight/environment/set <name>
- /tdlight/diagnostics/show 0|1

Breek bestaande mappings niet zonder bewijs.
Verifieer met testcommands en laat zien welke oude routes nog actief zijn.
```

### Fase 9: opschonen pas na acceptatie

Doel: pas snoeien als het nieuwe systeem werkt.

Startprompt:

```text
Doe geen nieuwe features.

Vergelijk het werkende TD-light systeem met het oude bestand.
Maak een lijst van:
- nodes/modules die nog actief nodig zijn
- legacy modules die veilig genegeerd kunnen worden
- modules die pas later verwijderd mogen worden
- risico's bij verwijderen

Implementeer geen cleanup tenzij expliciet gevraagd.
```

## Verificatieregel per sessie

Elke sessie eindigt met:

```text
Wat is aangepast?
Wat is bewezen werkend?
Wat is niet getest?
Welke files zijn geraakt?
Wat is de volgende veilige stap?
```

Voor TouchDesigner altijd minimaal een van deze bewijzen:

- echte node-paden;
- `.toe.dir` diff;
- screenshot;
- previewpagina;
- test-OSC;
- frame/timestamp updates;
- expliciete command-output.
