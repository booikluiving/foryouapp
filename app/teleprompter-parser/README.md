# Tekstparser + Teleprompt Stage

Los prototype voor teleprompter-output naast de bestaande For You app.

De Operator Chat blijft de scene-inhoud genereren. Deze module ontvangt alleen afgeronde tekst, zet die deterministisch om naar teleprompter-regels en toont die op een aparte stage-pagina.

## Routes

Binnen de normale For You server:

```txt
GET  /teleprompter-parser
GET  /teleprompter-parser/stage
GET  /api/teleprompter-parser/health
GET  /api/teleprompter-parser/current
POST /admin/teleprompter-parser/parse
```

`/teleprompter-parser` en `/admin/teleprompter-parser/parse` zijn admin-only. De stage en current API zijn publiek zodat een los scherm de teleprompt kan tonen.

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
    "generatedAt": "2026-05-19T12:00:00.000Z"
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

## AI later

Een toekomstige DeepSeek-parser mag alleen achter hetzelfde contract komen. Die output moet preserve-text-validatie krijgen: alle teruggegeven dialoog- en regietekst moet uit de brontekst komen. Bij twijfel valt de module terug op `rule-based-v1`.

