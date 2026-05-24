# Startprompt voor Codex op de Mac Studio

Je werkt op de Mac Studio aan het For You / TouchDesigner Light traject.

## Belangrijkste context

De gebruiker werkt tegelijk door aan delen van de app. Werk dus voorzichtig:

- Revert niets wat je niet zelf hebt gemaakt.
- Begin altijd met `git status -sb`.
- Als er onbekende uncommitted wijzigingen staan: stop en rapporteer eerst.
- Je mag op `main` werken als dat expliciet handig is.
- Raak TouchDesigner-bestanden niet aan zonder expliciete toestemming.
- Mirror of kopieer geen Dropbox-showmappen naar een andere machine.

De juiste Mac Studio workspace is:

```text
/Users/for_you/ForYou/main/app
```

Live showserver:

```text
http://127.0.0.1:3310
http://100.98.7.121:3310
```

Current TouchDesigner showfiles staan op de Mac Studio in:

```text
/Users/for_you/Library/CloudStorage/Dropbox/Current Touch Designer Version
```

TD-light/POC-map:

```text
/Users/for_you/Library/CloudStorage/Dropbox/For You/Voorstelling/show/td-light
```

## Eerst lezen

Lees in de repo:

```text
docs/TOUCHDESIGNER_LIGHT_WORKFLOW.md
docs/TOUCHDESIGNER_LIGHT_FASE_1_INVENTARISATIE.md
MAC_STUDIO_SETUP.md
README.md
```

Deze docs bevatten:

- de werkwijze;
- wat al onderzocht is;
- de relevante TD-paden;
- de hardware-routing;
- de fasering;
- de waarschuwingen rond Dropbox/TouchDesigner.

## Waar we nu aan werken

We bouwen richting **TouchDesigner Light**:

```text
For You webapp = brain / state / operatorlaag / teleprompter / captions / preview
TouchDesigner = video-engine / camera's / keying / DeckLink outputs / compositing / audio-video playback
```

Het doel is niet om alles opnieuw in TouchDesigner te bouwen. TouchDesigner moet juist simpeler worden: bewezen hardwareblokken behouden, oude AI/text/OSC-spaghetti uitfaseren, en de veranderlijke logica naar de webapp brengen.

## Wat al bekend is uit Fase 1

Fase 1 inventarisatie is gedaan.

Belangrijkste conclusies:

- Relevante For You TD-bron: `For You V15 - week 3 (2023TD) v3.toe`.
- `v3.toe` en `v3.37.toe` zijn byte-identiek.
- API `v1.toe` en `v1.9.toe` zijn byte-identiek en waarschijnlijk legacy.
- Bestaande fases in TD:
  - `buttonRadio2.Value0 = 0` -> `INLOOP/out1`
  - `buttonRadio2.Value0 = 1` -> `Waitscreens/out2`
  - `buttonRadio2.Value0 = 2` -> camera/main composite
- Camera switch:
  - `buttonRadio.Value0 = 0/1/2`
  - camera routes via `/ForU/cam_bg_mix/switch1`
- Stream Deck / Companion:
  - OSC naar `127.0.0.1:8008`
  - TD luistert via `/ForU/midi_input/oscin1`
  - faseknoppen: OSC2, OSC3, OSC6
  - cameraknoppen: OSC25, OSC26, OSC27
- Outputs:
  - DeckLink out1-3 zijn teleprompters
  - DeckLink out4 is main/stage
- Environment/muziek bestaat in `/ForU/AI`, maar gebruikt legacy Dropbox/CSV state.
- Captions lopen via `/ForU/Text/Caption -> /ForU/cam_bg_mix/select7 -> /ForU/cam_bg_mix/over3`.
- Teleprompters lopen via `/ForU/Text/Teleprompt -> /ForU/Teleprompt_*/select1`.

## Fase 2 status

Er is gewerkt aan:

- teleprompter parser;
- live captions;
- `/admin/td-preview`;
- hardware preview API.

De relevante routes zijn:

```text
GET  /teleprompter-parser
GET  /teleprompter-parser/stage
GET  /teleprompter-parser/live-captions
GET  /api/teleprompter-parser/current
POST /admin/teleprompter-parser/parse
GET  /admin/td-preview
GET  /admin/td-preview/state
GET  /admin/td-preview/frame/:sourceId.jpg
POST /admin/td-preview/frame
```

`booi-dev` en `main` zijn gepusht naar commit:

```text
3edf6dd Add live captions style controls
```

Op de Mac Studio is `main` gepulld en de server is herstart. De oude `booi-dev` previewserver is gestopt.

Laatste bekende status:

- Mac Studio repo stond schoon op `main`.
- `health` op `3310` was OK.
- `/teleprompter-parser/live-captions` gaf 200 OK na herstart.
- `/teleprompter-parser/stage` gaf 200 OK.
- `/admin/td-preview` gaf 200 OK.
- Er waren oude logregels over `computeAudienceLabelProfile is not defined`, maar de huidige code importeert die functie. Behandel dit als iets om te monitoren, niet meteen als bewezen actieve fout.

Let op: lokaal op de MacBook was nog een extra niet-gepushte CSS-wijziging gezien in:

```text
app/teleprompter-parser/public/styles.css
```

Die wijziging is niet naar main/Mac Studio gepusht. Als je op de Mac Studio werkt, beschouw `main` als de bron van waarheid.

## Jouw doel nu

Doel van deze Mac Studio-sessie:

1. Oriënteer je in de echte Mac Studio workspace.
2. Controleer rustig of `main` schoon is en de server draait.
3. Verifieer de Fase 2-routes vanaf de Mac Studio zelf.
4. Maak geen TouchDesigner-wijzigingen.
5. Als iets stuk is, diagnoseer klein en gericht.
6. Als je code wijzigt, doe dat op een begrijpelijke manier en rapporteer exact wat is aangepast.

Begin met:

```bash
cd /Users/for_you/ForYou/main/app
git status -sb
git log -1 --oneline
./scripts/mac-studio-status.command
```

Daarna test je minimaal:

```bash
curl -sS http://127.0.0.1:3310/health
curl -I http://127.0.0.1:3310/admin/td-preview
curl -I http://127.0.0.1:3310/teleprompter-parser/stage
curl -I http://127.0.0.1:3310/teleprompter-parser/live-captions
curl -sS http://127.0.0.1:3310/api/teleprompter-parser/current
```

## Acceptatie voor nu

Je bent klaar als je kunt rapporteren:

- huidige branch en commit;
- of de Mac Studio server gezond is;
- of de previewroute werkt;
- of live captions werkt;
- of parser stage/current API werkt;
- welke files je wel/niet hebt gewijzigd;
- wat de volgende veilige stap is.

Kort gezegd: help de gebruiker verder met zichtbaarheid en betrouwbaarheid, zonder TouchDesigner of Dropbox-showfiles ongevraagd aan te raken.

