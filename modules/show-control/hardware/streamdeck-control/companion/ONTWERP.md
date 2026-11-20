# Stream Deck: ontwerpsysteem

Elke knop op het deck volgt dit systeem. Kleuren, soorten en standen staan alleen in `deck.json` → `ontwerp`. `deck.sh check` weigert wat er niet aan voldoet.

Voorbeeld met alle standen: https://claude.ai/artifact/2tM5isg6p9Wy4GpxxY2MFM

## Een knop

- **Strook bovenaan = soort.** Altijd dezelfde kleur en hetzelfde woord.
- **Vlak = stand.** Voor elke soort dezelfde kleur.
- **Tekst:** regel 1 is het ding, regel 2 de stand nu (AAN · ON · MUTED · MIX · LOOPT · DOWN · OK · ?).

## Soorten

| soort | strook | wat |
|---|---|---|
| run | RUN, paars | verloop van de show en de teleprompter |
| cam | CAM, cyaan | camera's, autocam, focus, opname |
| geluid | GELUID, roze | microfoons en muziek op de SQ-5 |
| scene | SCENE, geel | knoppen van de omgeving of het personage in deze scène |
| publiek | PUBLIEK, zand | stemmen, QR, bots |
| web | WEB, lichtblauw, ↗ | opent een pagina in de browser |
| sys | SYSTEEM, grijs | diensten, TouchDesigner, herstarten |
| nav | zwart met wit kader | naar een andere pagina |

## Standen

| stand | vlak | betekent |
|---|---|---|
| leeg | zwart, geen strook | geen knop op deze plek |
| uit | zwart, strook vaag | mag nu niet |
| kan | grijs | kan ingedrukt worden (ook: mic open, dienst OK) |
| volgende | groen | de knop die je nu moet drukken, hooguit één per pagina |
| aan | wit | staat aan |
| loopt | amber met wit kader | is bezig: scène, opname, geluid |
| muted | rood | kanaal dicht |
| half | half rood | MIX, deels down |
| fout | rood, knippert | kapot of niet bereikbaar |
| onbekend | grijs, strook vaag, ? | geen terugmelding |

Groen, rood en amber zijn standen, nooit een soortkleur.

## Een nieuwe knop

1. Kies een soort uit de lijst. Past hij nergens: niet bouwen, Booi vragen. Een nieuwe soort alleen op ja van Booi.
2. Geef de knop geen kleur, rol of pictogram: alleen `soort`.
3. Gebruik alleen de standen van die soort (`ontwerp.soorten.<soort>.standen`). De scripts zetten een staat (`klaar`, `mute`, `actief` ...); `lib.js` → `STAAT_NAAR_STAND` vertaalt die naar de stand.
4. Label in hoofdletters, hooguit twee regels van acht tekens. Uitzondering op ja van Booi: de zaalknoppen hebben een emoji als label, `saai` 😴 (links) en `lach` 😂 (rechts) (20 nov 2026). Alleen oudere emoji: Companion tekent nieuwe (zoals 🥱) niet.
5. Plek: `ontwerp.rijen` zegt per pagina en rij welke soorten er mogen. Navigatie alleen in de onderste rij.
6. Knoppen van een scène (omgeving, extra's, personage) staan in `scene` zonder plek; deck-status zet wat er is van links aangeschoven op `sc1`..`sc6`.
7. `deck.sh check`, dan `deck.sh test start`. Op het echte deck alleen met `deck.sh toepassen --ja` na een ja van Booi.

## Afgedwongen

- `deck.sh check`, `deck.sh test start` en `deck.sh toepassen` stoppen als de controle of `test/ontwerp-test.js` faalt.
- Een commit die iets in deze map wijzigt, wordt geweigerd als de controle faalt (git-hook pre-commit op de show-Mac).
- Bouw geen knoppen meer in de oude werkmap `streamdeck-revamp-08b4c1`: daar geldt dit systeem niet, en een toepassen vanuit die map zet het oude deck terug.
