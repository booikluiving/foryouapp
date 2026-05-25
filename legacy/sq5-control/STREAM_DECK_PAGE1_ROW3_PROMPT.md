# Prompt: SQ5 Mute-Knoppen In Companion

Configureer Bitfocus Companion voor de For You SQ5 bridge.

Context:

- Bridge base URL: `http://127.0.0.1:3105`
- Gebruik HTTP-actions, geen OSC.
- De bridge moet draaien met snelle Stream Deck mute-polling, bij voorkeur: `SQ5_STREAMDECK_POLL_MS=500`.
- Companion moet `GET /api/streamdeck/state` elke `250ms` tot `500ms` pollen voor feedback.
- In de JSON-status betekent `true` gemute en `false` niet gemute.
- De knoppen moeten dynamisch zijn: als mute op de SQ-5, de SQ5 webpagina, TouchDesigner of een andere controller verandert, moet Companion de button-status zo snel mogelijk updaten.

Taak:

Verplaats eerst eventuele bestaande OSC-knoppen die nu op pagina 1, rij 3, knoppen 4 tot en met 8 staan naar de eerste vrije posities op pagina 2. Behoud daarbij hun bestaande labels, acties en feedback-instellingen.

Maak daarna op pagina 1, rij 3, knoppen 4 tot en met 8:

```text
Knop 4: Brent Mic mute/unmute toggle
Knop 5: Megan Mic mute/unmute toggle
Knop 6: Booi Mic mute/unmute toggle
Knop 7: All Mics mute/unmute toggle voor Brent + Megan + Booi
Knop 8: Main Mute mute/unmute toggle voor Main LR
```

Acties:

```text
Knop 4 press: POST http://127.0.0.1:3105/api/streamdeck/brent/toggle
Knop 5 press: POST http://127.0.0.1:3105/api/streamdeck/megan/toggle
Knop 6 press: POST http://127.0.0.1:3105/api/streamdeck/booi/toggle
Knop 7 press: POST http://127.0.0.1:3105/api/streamdeck/allmics/toggle
Knop 8 press: POST http://127.0.0.1:3105/api/streamdeck/main/toggle
```

Feedbackvelden uit `GET /api/streamdeck/state`:

```text
Knop 4 gebruikt JSON-veld: brent
Knop 5 gebruikt JSON-veld: megan
Knop 6 gebruikt JSON-veld: booi
Knop 7 gebruikt JSON-velden: allMics en allMicsMixed
Knop 8 gebruikt JSON-veld: main
```

Labels:

```text
Knop 4: BRENT MIC
Knop 5: MEGAN MIC
Knop 6: BOOI MIC
Knop 7: ALL MICS
Knop 8: MAIN MUTE
```

Feedback styling:

```text
Als het mute-veld true is:
  tekst: MUTED
  achtergrond: rood
  tekstkleur: wit

Als het mute-veld false is:
  tekst: ON
  achtergrond: donkergroen of donkergrijs
  tekstkleur: wit

Alleen voor knop 7:
  als allMicsMixed true is:
    tekst: MIXED
    achtergrond: amber/oranje
    tekstkleur: zwart
```

Verificatie:

1. Druk elke knop een keer in en controleer of de mute-status op de SQ-5 verandert.
2. Verander mute daarna vanaf de SQ-5 of de SQ5 webpagina.
3. Controleer dat Companion de button-feedback binnen ongeveer 0.5 seconde tot maximaal 1 seconde update.
4. Voor knop 7: mute maar een van Brent/Megan/Booi en controleer dat de knop `MIXED` toont.
