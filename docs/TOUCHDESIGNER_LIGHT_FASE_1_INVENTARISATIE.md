# TouchDesigner Light - Fase 1 inventarisatie

Datum: 2026-05-20  
Scope: current TouchDesigner workflow inventariseren als basis voor TouchDesigner Light.

## Werkafspraken

Deze inventarisatie is read-only uitgevoerd.

- Lokaal is alleen documentatie gelezen in deze repo.
- TouchDesigner-, hardware-, Dropbox-showfile- en live checks zijn via `ssh foryou-studio` op de Mac Studio uitgevoerd.
- Er zijn geen TouchDesigner-bronbestanden gewijzigd.
- Er zijn geen complete Mac Studio- of Dropbox-mappen naar de MacBook gekopieerd.
- Er is geen `rsync` of `scp -r` gebruikt op showmappen.
- Voor `.toe` analyse zijn alleen specifieke tijdelijke kopieën op de Mac Studio gemaakt onder `/tmp/td_current_research_20260520`.

## Lokaal gelezen context

```text
app/docs/TOUCHDESIGNER_LIGHT_WORKFLOW.md
app/MAC_STUDIO_SETUP.md
app/docs/stream-deck/README.md
app/docs/stream-deck/open-current-touchdesigner.sh
app/README.md
```

## Current files

De current TouchDesigner-map werd gevonden als:

```text
/Users/for_you/Library/CloudStorage/Dropbox/Current Touch Designer version
```

`find`/`stat` output voor current `.toe` files:

```text
/Users/for_you/Library/CloudStorage/Dropbox/Current Touch Designer Version/For You V15 - week 3 (2023TD) v3.33 OSC3 green off.toe|5220212|2026-05-19 18:34:44
/Users/for_you/Library/CloudStorage/Dropbox/Current Touch Designer Version/For You V15 - week 3 (2023TD) v3.37.toe|5165250|2026-05-19 18:43:37
/Users/for_you/Library/CloudStorage/Dropbox/Current Touch Designer Version/For You V15 - week 3 (2023TD) v3.toe|5165250|2026-05-19 18:43:37
/Users/for_you/Library/CloudStorage/Dropbox/Current Touch Designer Version/API AI systeem- week 3 v1.toe|32218|2026-05-19 16:53:23
/Users/for_you/Library/CloudStorage/Dropbox/Current Touch Designer Version/API AI systeem- week 3 v1.9.toe|32218|2026-05-19 16:53:23
```

Hashes:

```text
d1d541053551fc8bf15d1aea5c9cf42f437f6272b762dca4bdec71a402fd0019  For You V15 - week 3 (2023TD) v3.33 OSC3 green off.toe
50cbc75476bf08fb47b9d7530f0057459e1d90c886921ee7e613bcacd4ee95a3  For You V15 - week 3 (2023TD) v3.37.toe
50cbc75476bf08fb47b9d7530f0057459e1d90c886921ee7e613bcacd4ee95a3  For You V15 - week 3 (2023TD) v3.toe
c4b51225c1475c03fe54679466b9b480cd25d382a546a0f05f0134582529fe9c  API AI systeem- week 3 v1.toe
c4b51225c1475c03fe54679466b9b480cd25d382a546a0f05f0134582529fe9c  API AI systeem- week 3 v1.9.toe
```

De bestaande Stream Deck helper selecteert:

```text
api|/Users/for_you/Library/CloudStorage/Dropbox/Current Touch Designer Version/API AI systeem- week 3 v1.toe
foryou|/Users/for_you/Library/CloudStorage/Dropbox/Current Touch Designer Version/For You V15 - week 3 (2023TD) v3.toe
```

TouchDesigner status via helper:

```text
uit
```

Conclusie:

- Relevante For You-bron: `For You V15 - week 3 (2023TD) v3.toe`.
- `v3.37.toe` is byte-identiek aan `v3.toe`.
- `v3.33 OSC3 green off.toe` is afwijkend en wordt niet door de helper geselecteerd.
- Relevante API-bron, als die nog nodig blijkt: `API AI systeem- week 3 v1.toe`.
- `API AI systeem- week 3 v1.9.toe` is byte-identiek aan `v1.toe`.

## Expand en diff bewijs

Tijdelijke analysemapping op de Mac Studio:

```text
/tmp/td_current_research_20260520
```

`toeexpand` is gebruikt op specifieke tijdelijke kopieën. `toeexpand` gaf exit code `1`, maar meldde per file dat het bestand was geëxpand naar `.toe.dir` en `.toe.toc`.

Diff-bewijs:

```text
diff -qr For You V15 - week 3 (2023TD) v3.toe.dir For You V15 - week 3 (2023TD) v3.37.toe.dir
# geen output, exit 0

diff -qr API AI systeem- week 3 v1.toe.dir API AI systeem- week 3 v1.9.toe.dir
# geen output, exit 0

diff -q For You V15 - week 3 (2023TD) v3.toe For You V15 - week 3 (2023TD) v3.33 OSC3 green off.toe
Files ... differ
```

Belangrijke verschillen tussen `v3` en `v3.33 OSC3 green off`:

```text
ForU/Text/comment_osc3_green_off.*
ForU/Text/green_osc3_force_off.*
ForU/Text/green_osc5_toggle.*
ForU/Text/green_screen_count.*
ForU/Text/green_state_out.*
ForU/AI/*/oscin*
ForU/Light/dmxout1.ts
ForU/cam_bg_mix/INLOOP/audiofilein2.ts
ForU/cam_bg_mix/midi_input/oscin1.ts
ForU/cam_bg_mix/local/set_variables.table
```

## Bestaande fases / showstates

Hoofdroute:

```text
/ForU/cam_bg_mix/switch3.n
TOP:switch
inputs
{
0  INLOOP/out1
1  null11
2  null8
}

/ForU/cam_bg_mix/switch3.parm
index ... op('buttonRadio2').par.Value0
```

Extra routingbewijs:

```text
/ForU/cam_bg_mix/null11.n -> input Waitscreens/out2
/ForU/cam_bg_mix/null8.n  -> input over3
/ForU/cam_bg_mix/out1.n   -> input fit2
```

Mapping:

```text
buttonRadio2.Value0 = 0 -> /ForU/cam_bg_mix/INLOOP/out1
buttonRadio2.Value0 = 1 -> /ForU/cam_bg_mix/Waitscreens/out2
buttonRadio2.Value0 = 2 -> /ForU/cam_bg_mix/null8 -> camera/main composite
```

## Camera inputs, raw/keying en camera switch

DeckLink camera inputs:

```text
/ForU/Input/Camera1/videodevin1.parm
driver blackmagic
device "V1|||3299243008|||0|||0|||DeckLink 8K Pro (1) - 1"
inputpixelformat fixed10
cgamma 0.8

/ForU/Input/Camera2/videodevin1.parm
driver blackmagic
device "V1|||3299243010|||2|||0|||DeckLink 8K Pro (3) - 1"
inputpixelformat fixed10
cgamma 0.8

/ForU/Input/Camera3/videodevin1.parm
driver blackmagic
device "V1|||3299243009|||1|||0|||DeckLink 8K Pro (2) - 1"
inputpixelformat fixed10
cgamma 0.8
```

Per camera:

```text
videodevin1 -> mirror1 -> fit2
switch2 inputs: 0 text1, 1 fit2
switch2.parm: index ... op('videodevin1').par.active

null -> raw
chromaKey1/out1 -> null1 -> key
switch1 inputs: 0 raw, 1 key
switch1.parm: index ... op('null2')['select']
```

Camera switch in `/ForU/cam_bg_mix`:

```text
/ForU/cam_bg_mix/switch1.n
TOP:switch
inputs
{
0  Overlays/out1
1  Overlays/out2
2  Overlays/out3
}

/ForU/cam_bg_mix/switch1.parm
index ... op('null1')['Value']
```

Camera key sources:

```text
/ForU/cam_bg_mix/select1.parm -> ../Input/Camera1/key
/ForU/cam_bg_mix/select5.parm -> ../Input/Camera2/key
/ForU/cam_bg_mix/select6.parm -> ../Input/Camera3/key
```

Compositing:

```text
/ForU/cam_bg_mix/comp1.n -> inputs select1, null4
/ForU/cam_bg_mix/comp2.n -> inputs select5, null4
/ForU/cam_bg_mix/comp3.n -> inputs select6, null4
/ForU/cam_bg_mix/video1.n -> input comp1
/ForU/cam_bg_mix/video2.n -> input comp2
/ForU/cam_bg_mix/video3.n -> input comp3
/ForU/cam_bg_mix/over3.n  -> inputs select7, switch1
```

## DeckLink outputs

Teleprompter 1:

```text
/ForU/videodevout1.n -> input opview1
/ForU/opview1.parm -> opviewer Teleprompt_1, outputresolution custom, 1280x720
/ForU/videodevout1.parm
device "V1|||3767264291|||7|||0|||DeckLink 8K Pro (4) - 2"
signalformat f1920x1080p-25.00hz
bufferlength 0
```

Teleprompter 2:

```text
/ForU/videodevout2.n -> input opview2
/ForU/opview2.parm -> opviewer Teleprompt_2, outputresolution custom, 1280x720
/ForU/videodevout2.parm
device "V1|||3767264289|||5|||0|||DeckLink 8K Pro (2) - 2"
signalformat f1920x1080p-25.00hz
bufferlength 0
```

Teleprompter 3:

```text
/ForU/videodevout3.n -> input opview3
/ForU/opview3.parm -> opviewer Teleprompt_3, outputresolution custom, 1280x720
/ForU/videodevout3.parm
device "V1|||3767264290|||6|||0|||DeckLink 8K Pro (3) - 2"
signalformat f1920x1080p-25.00hz
bufferlength 0
```

Main/stage:

```text
/ForU/videodevout4.n -> input null1
/ForU/null1.n -> input cam_bg_mix/out1
/ForU/videodevout4.parm
device "V1|||3299243011|||3|||0|||DeckLink 8K Pro (4) - 1"
signalformat f3840x2160p-60.00hz
```

Let op: teleprompter `opview1/2/3` staan op `1280x720`, terwijl de DeckLink outputs `1920x1080p25` uitsturen. Dat moet fysiek worden bekeken.

## Web Render TOPs

```text
/ForU/webrender1.parm
url file:///Users/for_you/Library/CloudStorage/Dropbox/BM-Camera-Control-WebUI-main/index.html#
resolutionw 1920
resolutionh 1080

/ForU/cam_bg_mix/webrender1.parm
url http://192.168.1.49:3310/stage
transparent on
resolutionw 1080
resolutionh 1920

/ForU/cam_bg_mix/Waitscreens/webrender1.parm
url http://192.168.1.49:3310/api-playground/stage
transparent on
outputresolution custom
resolutionw 2160
resolutionh 3840

/ForU/cam_bg_mix/INLOOP/webrender1.parm
url http://127.0.0.1:3310/universe/stage
outputresolution custom
resolutionw 2160
resolutionh 3840

/ForU/cam_bg_mix/INLOOP/webrender_wifi.parm
url http://192.168.1.49:3310/stage/wifi-qr
transparent on
resolutionw 1280
resolutionh 720

/ForU/cam_bg_mix/INLOOP/webrender_sessie.parm
url http://192.168.1.49:3310/stage/session-qr
transparent on
resolutionw 1280
resolutionh 720
```

Live showserver health checks vanaf de Mac Studio:

```text
127.0.0.1:3310/health 200 0.002124
100.98.7.121:3310/health 200 0.002875
192.168.1.49:3310/health 200 0.004813
```

Conclusie: de showserver reageert op localhost, Tailscale en het hardcoded LAN-IP dat in de huidige TD-file staat.

## Stream Deck / OSC routing

TouchDesigner luistert op OSC poort `8008`:

```text
/ForU/midi_input/oscin1.parm
port 8008
timeslice on
```

Companion database:

```text
module generic-osc
host 127.0.0.1
targetPort 8008
protocol udp
enabled true
```

Companion button mapping uit `controls`:

```text
Inloop      /osc/osc2   1
Next        /osc/osc3   1
Start Scene /osc/osc6   1
cam1        /osc/osc25  1
cam2        /osc/osc26  1
cam3        /osc/osc27  1
QR          /osc/osc10  1
Ready?      /osc/osc5   1
```

TD select nodes:

```text
/ForU/midi_input/select2.parm  -> oscin1, osc/osc2
/ForU/midi_input/select3.parm  -> oscin1, osc/osc3
/ForU/midi_input/select6.parm  -> oscin1, osc/osc6
/ForU/midi_input/select25.parm -> oscin1, osc/osc25
/ForU/midi_input/select26.parm -> oscin1, osc/osc26
/ForU/midi_input/select27.parm -> oscin1, osc/osc27
```

Camera buttons:

```text
/ForU/cam_bg_mix/chopexeck4.parm -> chop null25, channel osc/osc25
script: op('buttonRadio').par.Value0 = 0

/ForU/cam_bg_mix/chopexeck5.parm -> chop null25, channel osc/osc26
script: op('buttonRadio').par.Value0 = 1

/ForU/cam_bg_mix/chopexeck6.parm -> chop null25, channel osc/osc27
script: op('buttonRadio').par.Value0 = 2
```

Phase buttons:

```text
/ForU/cam_bg_mix/chopexeck7.parm -> chop null32, channel osc/osc2
script: op('buttonRadio2').par.Value0 = 0

/ForU/cam_bg_mix/chopexeck8.parm -> chop null32, channel osc/osc3
script: op('buttonRadio2').par.Value0 = 1

/ForU/cam_bg_mix/chopexeck9.parm -> chop null32, channel osc/osc6
script: op('buttonRadio2').par.Value0 = 2
```

Conclusie:

```text
Companion / Stream Deck -> UDP OSC 127.0.0.1:8008 -> /ForU/midi_input/oscin1 -> streamdeckN -> /ForU/cam_bg_mix CHOP Execute
```

## Environment / achtergrond / muziek

Environment/media selectie zit hoofdzakelijk in `/ForU/AI`:

```text
/ForU/AI/oscin1.parm
port 8004
timeslice on

/ForU/AI/container1/filein5.parm
file /Users/for_you/Library/CloudStorage/Dropbox/CURRENT_ENVIRONMENT/CURRENT_ENVIRONMENT:datout.0.dat.csv
refreshpulse op('oscin1')['v1']

/ForU/AI/selected_song.parm  -> dat container1/null6
/ForU/AI/selected_image.parm -> dat container1/null2
/ForU/AI/selected_fx.parm    -> dat container1/null14

/ForU/AI/moviefilein1.parm -> file op('selected_image')[1,'path']
/ForU/AI/moviefilein2.parm -> file op('selected_fx')[1,'path']
/ForU/AI/audiofilein1.parm -> file op('selected_song')[1,'path']

/ForU/AI/Background.n -> input moviefilein1
/ForU/AI/Sound.n      -> input audiofilein1
```

Mediafolders in `/ForU/AI/container1` gebruiken onder andere:

```text
For You/Voorstelling/Media/Personages
For You/Voorstelling/Media/Achtergrondjes
```

Audio output:

```text
/ForU/cam_bg_mix/switch4.n
CHOP:switch
inputs
{
0  INLOOP/out2
1  select4
}

/ForU/cam_bg_mix/switch4.parm
index ... op('null10')['chan1']

/ForU/cam_bg_mix/select4.parm
chops ../AI/Sound

/ForU/cam_bg_mix/merge1.n
inputs
{
0 select2
1 select9
}

/ForU/cam_bg_mix/audiodyna1.n
inputs
{
0 merge1
}

/ForU/cam_bg_mix/audiodyna1.parm
inputgain ... op('null13')['chan1']

/ForU/cam_bg_mix/audiodevout1.n
inputs
{
0 audiodyna1
}

/ForU/cam_bg_mix/audiodevout1.parm
active ... op('null18')['v1'].eval()
device Yamaha_Steinberg_USB_ASIO||2
bufferlength 0.15
volume ... op('null6')['v1']
timeslice on
```

Waitscreens/INLOOP audio:

```text
/ForU/cam_bg_mix/Waitscreens/audiofilein1.parm
file "Media/Wachtschermen/Content for Touch/Minecraft.mp4"
timeslice on

/ForU/cam_bg_mix/Waitscreens/audiofilein2.parm
file "Media/Wachtschermen/Generating content 2.mp4"
volume 0.494
timeslice on

/ForU/cam_bg_mix/INLOOP/audiofilein2.parm
file ""
timeslice on
```

Legacy/risico in AI omgeving:

```text
/ForU/AI/text1.parm
C:/Users/the Beam Beast/Fborath Dropbox/Finn Borath/For You - april/Voorstelling/Media/Systemprompts/GPT System Prompt.txt
```

## Captions / tekst / teleprompter routing

Captions:

```text
/ForU/Text/oscin1.parm
port 8004
timeslice on

/ForU/Text/Caption.n
TOP:null
input over1

/ForU/cam_bg_mix/select7.parm
top ../Text/Caption

/ForU/cam_bg_mix/over3.n
inputs
{
0 select7
1 switch1
}
```

Tekstinhoud:

```text
/ForU/Text/title.parm
text str(op('null13')[0,0]).split('*')[2]

/ForU/Text/dialoog.parm
dat null12
rowindex op('null2')[0]
text op('null9')

/ForU/Text/preview_naam.parm
rowindex op('null2')[0]+1

/ForU/Text/preview_text.parm
rowindex op('null2')[0]+1
```

Teleprompters:

```text
/ForU/Teleprompt_1.parm
clone Teleprompt_1
Video cam_bg_mix/video1

/ForU/Teleprompt_2.parm
clone Teleprompt_1
Video "'cam_bg_mix/video' + str(me.digits)"

/ForU/Teleprompt_3.parm
clone Teleprompt_1
Video "'cam_bg_mix/video' + str(me.digits)"
```

Per teleprompter:

```text
/ForU/Teleprompt_*/select1.parm
top parent(2).op('Text/Teleprompt')

/ForU/Teleprompt_*/switch2.n
inputs
{
0 text1
1 over1
2 select1
}

/ForU/Teleprompt_*/switch2.parm
index op('buttonRadio2').par.Value0
```

Conclusie:

- Main caption overlay loopt via `/ForU/Text/Caption -> /ForU/cam_bg_mix/select7 -> /ForU/cam_bg_mix/over3`.
- Telepromptertekst loopt via `/ForU/Text/Teleprompt -> /ForU/Teleprompt_*/select1`.
- Teleprompter video volgt `cam_bg_mix/video1`, `video2`, `video3`.

## API-file relevantie / legacy

`API AI systeem- week 3 v1.toe` en `v1.9.toe` zijn identiek. De helper kiest `v1`.

Belangrijke nodes:

```text
/project1/oscin1.parm
port 8003
addscope /foryou/script/line
typetag on
splitbundle on
maxlines 100

/project1/oscin3.parm
port 8003
addscope /foryou/script/clear

/project1/oscin4.parm
port 8003
addscope /foryou/script/end

/project1/oscin2.parm
port 8050
timeslice on

/project1/oscout1.parm
port 8004
sendrate off
timeslice on
```

Ollama/AI generatie in TD:

```text
/project1/textDAT1.text
url "http://localhost:11434/api/generate"
model "deepseek-v4-flash:cloud"
stream False
```

File outputs:

```text
/project1/text6.parm
file /Users/for_you/ForYou/main/app/data/script-output/current-scene.txt
syncfile on

/project1/fileout1.parm
file /Users/for_you/Library/CloudStorage/Dropbox/SCENARIO/SCENARIO.0.txt

/project1/fileout3.parm
TELEPROMPT_PRESCENE/performer1/datout.0.dat.csv

/project1/fileout4.parm
TELEPROMPT_PRESCENE/performer2/datout.0.dat.csv

/project1/fileout5.parm
TELEPROMPT_PRESCENE/performer3/datout.0.dat.csv
```

Interne comment:

```text
OLLAMA SYSTEEM = OSC VOLGENDE SCENE
VIBECODE SYSTEEM = OSC HUIDIGE SCENE
```

Conclusie: de API-file is waarschijnlijk legacy voor TD-light, tenzij de live flow nog afhankelijk is van `/foryou/script/*` op poort `8003` of van de Dropbox fileouts voor scenario/teleprompt-prescene.

## Veilig overnemen naar TD-light

Veilig als basis, met later fysieke verificatie:

```text
/ForU/Input/Camera1-3 DeckLink input mapping
/ForU/Input/Camera1-3 raw/key structuur
/ForU/cam_bg_mix camera switch via buttonRadio
/ForU/cam_bg_mix phase switch via buttonRadio2
/ForU/cam_bg_mix INLOOP / Waitscreens / camera-main patroon
/ForU/videodevout1-4 DeckLink output mapping
/ForU/Text/Caption -> /ForU/cam_bg_mix/select7 -> /ForU/cam_bg_mix/over3
/ForU/Teleprompt_1-3 clone/video routing
/ForU/midi_input/oscin1 op poort 8008
Companion -> UDP OSC 127.0.0.1:8008 -> TouchDesigner
```

## Tijdelijk behouden

```text
/ForU/AI environment/music selectie, zolang CURRENT_ENVIRONMENT live nog gebruikt wordt
/ForU/cam_bg_mix audio output naar Yamaha_Steinberg_USB_ASIO
API v1 alleen als bridge als /foryou/script/* of TELEPROMPT_PRESCENE fileouts nog nodig zijn
Hardcoded web render routes eerst werkend houden, daarna normaliseren
```

## Legacy / risicovol

```text
For You v3.33 OSC3 green off: afwijkende patchfile, niet geselecteerd door helper
Hardcoded 192.168.1.49 in meerdere Web Render TOPs
Hardcoded OSC localaddress 192.168.1.49 in /ForU/midi_input/oscin2
Ollama/Deepseek generatie in API TouchDesigner-file
Dropbox runtime CSV/TXT koppelingen voor SCENARIO, TELEPROMPT_PRESCENE en CURRENT_ENVIRONMENT
Windows pad in /ForU/AI/text1.parm
Teleprompter opview 1280x720 naar 1920x1080p25 DeckLink output
TouchDesigner status was uit tijdens helper-check; hardwarebeeld is dus niet live visueel gevalideerd
```

## Later fysiek / hardwarematig testen

```text
DeckLink out1/out2/out3 naar juiste teleprompters
DeckLink out4 naar main/stage output
Camera 1/2/3 fysieke inputvolgorde
Camera gamma/pixel format en keyingkwaliteit
Raw/key switch per camera
ChromaKey instellingen onder live licht
Companion + fysieke Stream Deck knoppen voor osc2/3/6/25/26/27
Audio via Yamaha_Steinberg_USB_ASIO en eventuele SQ5-keten
Web Render TOPs met localhost, Tailscale en LAN-IP in TouchDesigner zelf
Captions en teleprompter timing met echte scene/scriptdata
Nieuwe /teleprompter-parser/stage route zodra TD-light daarop aansluit
```

## Open vragen

- Is `API AI systeem- week 3 v1.toe` nog actief nodig in de liveset, of kan de webapp alle script/teleprompter-state leveren?
- Moet TD-light de oude LAN-IP routes `192.168.1.49` blijven ondersteunen, of direct naar localhost/Tailscale normaliseren?
- Zijn de teleprompter outputs bewust `opview 1280x720` naar `1080p25`, of is dat historisch gegroeid?
- Welke audio-route is leidend voor de show: alleen TD via Yamaha/Steinberg, of ook SQ5/andere mixerlogica?
- Moet `v3.33 OSC3 green off` nog als fallback bewaard blijven, of is die variant volledig legacy?

## Expliciete bevestiging

Voor deze fase zijn geen bronbestanden aangepast op de Mac Studio en geen TouchDesigner-bestanden gewijzigd. Er is niets gemirrord naar de MacBook. Alleen specifieke tijdelijke `.toe` kopieën zijn op de Mac Studio zelf onder `/tmp/td_current_research_20260520` gebruikt voor `toeexpand` en diff-analyse.
