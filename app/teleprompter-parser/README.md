# Tekstparser + Teleprompt Stage

Los prototype naast de bestaande For You app.

De Operator/API-output blijft de scene-inhoud genereren. Deze module ontvangt alleen afgeronde tekst, zet die rule-based om naar teleprompter-regels en toont die op een aparte stage-pagina.

## Routes

```txt
GET  /teleprompter-parser
GET  /teleprompter-parser/stage
GET  /teleprompter-parser/live-captions
GET  /api/teleprompter-parser/health
GET  /api/teleprompter-parser/current
GET  /api/teleprompter-parser/events
POST /api/teleprompter-parser/cue
POST /admin/teleprompter-parser/caption-style
POST /admin/teleprompter-parser/parse
```

## Contract

Input:

```json
{
  "title": "optionele titel",
  "rawText": "ruwe gegenereerde scene-tekst",
  "source": "operator_chat | manual"
}
```

Output:

```json
{
  "version": 1,
  "title": "Scene titel",
  "characters": [
    { "id": "character_1", "label": "PERSONAGE 1", "color": "#4cc9f0" }
  ],
  "lines": [
    {
      "id": "line_1",
      "type": "dialogue",
      "speakerId": "character_1",
      "speakerLabel": "PERSONAGE 1",
      "text": "Eerste zin."
    },
    {
      "id": "line_2",
      "type": "stage_direction",
      "text": "Regieaanwijzing."
    }
  ],
  "source": {
    "kind": "operator_chat",
    "parser": "rule-based-v1",
    "generatedAt": "2026-05-20T08:00:00.000Z"
  }
}
```

## Parserregels v1

- Geen AI. De parser is rule-based.
- Titel komt uit het expliciete `title` veld, anders uit de eerste markdown heading, anders `Teleprompt`.
- Dialoog wordt herkend als `Naam: tekst`.
- Dialoog wordt per zin gesplitst naar losse kaarten.
- `Regie:`, `Actie:`, `Stage:`, bracketed regels en regels zonder spreker worden regieaanwijzingen.
- Personages krijgen kleuren in volgorde van verschijnen.
- De parser mag trimmen, splitsen en labelen. Hij mag geen nieuwe scene-inhoud maken.

## Stage

`/teleprompter-parser/stage` gebruikt een vaste interne stage van `1312 x 1080` CSS-pixels en schaalt als geheel omlaag als het browservenster kleiner is.

De titelkaart toont alleen de titel. De eindkaart toont alleen `Einde`.

De Teleprompt Stage is de cue-master. Bij navigatie post hij de actieve kaart-index naar `/api/teleprompter-parser/cue`; nieuwe parses resetten die index naar de titelkaart.

## Live captions

`/teleprompter-parser/live-captions` gebruikt een transparante verticale overlay van `1080 x 1920` CSS-pixels. De overlay volgt dezelfde cue-index via SSE met polling fallback. Titel en personagenamen worden niet getoond; dialoog, regieaanwijzingen en `Einde` verschijnen als witte captions met zwarte rand.

Gebruik `/teleprompter-parser/live-captions?preview=1` voor een browser-preview met checkerboardachtergrond. Gebruik `/teleprompter-parser/live-captions?debug=1` om de bron te controleren met cue-status.

De parserpagina bevat live-caption styling voor tekstgrootte, verticale positie, breedte en zwarte rand. Die instellingen worden in-memory gedeeld via `/api/teleprompter-parser/current` en direct toegepast op de overlay.
