# Tabs op de publiekstelefoon

De telefoon (`public/index.html`) heeft onderaan de tabs **Chat · for_youniverse · Personages**.
De inhoud van een tab staat hier als één bestand: `universum.js` en `personages.js`.
Raak voor een tab `index.html` niet aan.

## Aan en uit

Admin → Telefoon: elke tab apart. Uit = de telefoons tonen alleen de chat, meteen, zonder herladen.
Standaard uit. Staat maar één tab aan (de chat), dan is er geen tabbalk.

## Hoe een tab zich meldt

```js
ForYouTabs.registreer("universum", {
  berichten: ["universum"],     // soorten socketberichten die deze tab wil
  start(vlak, api) {},          // één keer, bij de eerste tik op de tab; vlak = <section> om in te tekenen
  bericht(msg) {},              // elk bericht van die soorten, plus hello, chat_reset, session_reset, session_closed
  toon() {},                    // tab is zichtbaar (ook: stemlaag dicht, telefoon weer aan)
  verberg() {},                 // tab niet zichtbaar: stop tekenen en animaties
});
```

`api.zichtbaar()` · `api.laatste(type)` (laatste bericht van een soort, ook van vóór het laden) · `api.naarTab("chat")`.

- Het bestand laadt pas bij de eerste tik, met `?v=<serverversie>` (mag 5 min bewaard worden).
- Na `start` krijgt de tab meteen het laatste `hello` en het laatste bericht van elke gevraagde soort.
- Een fout in `start`, of drie fouten in de andere functies: de tab toont "Even niet beschikbaar". Chat en stemmen draaien door.
- Stemronde en content warning liggen als laag over de tab; de tab blijft eronder staan en krijgt `verberg`/`toon`.
- Geen eigen verbinding, geen `setInterval` die blijft lopen als de tab verborgen is, geen WebGL.
- Foto's via een adres met `?v=`, klein, `loading="lazy"`; nooit als data-URL in een socketbericht.

## Testen

`npm run audience:tabs-test`. Met een andere map: `AUDIENCE_TABS_DIR=/pad/naar/map`.
