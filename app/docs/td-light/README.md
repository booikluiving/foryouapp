# TouchDesigner Light POC

Deze map is de veilige startplek voor de nieuwe TD-light laag. Het bestaande
TouchDesigner showbestand blijft ongemoeid; de POC werkt vanuit een kopie van
`For You V15 - week 3 (2023TD) v3.37.toe`.

## Doel

- Webapp blijft de brain.
- TouchDesigner blijft de video-engine.
- Een nieuwe `/ShowLight` laag kan later in de POC-kopie worden gebouwd met:
  - `cameras`
  - `web_sources`
  - `mixer`
  - `outputs`
  - `preview_bus`
  - `diagnostics`
- De canonieke teleprompter-stage is `/teleprompter-parser/stage`.
- De preview dashboard URL op de Mac Studio is:
  `http://100.98.7.121:3310/admin/td-preview`

## Preview protocol

TouchDesigner post lage-FPS JPEGs naar:

```text
POST http://127.0.0.1:3310/admin/td-preview/frame
```

Ondersteunde `sourceId`s:

```text
cam1_raw
cam1_key
cam2_raw
cam2_key
cam3_raw
cam3_key
main_out
tp1_out
tp2_out
tp3_out
```

Voor JSON/base64:

```json
{
  "sourceId": "cam1_raw",
  "width": 640,
  "height": 360,
  "sequence": 1,
  "imageBase64": "data:image/jpeg;base64,..."
}
```

Voor raw JPEG kan TD ook direct bytes posten met query metadata:

```text
POST /admin/td-preview/frame?sourceId=cam1_raw&width=640&height=360&sequence=1
Content-Type: image/jpeg
```

Als admin-auth later aan gaat, zet `TD_PREVIEW_SECRET` in de webapp en stuur
dezelfde waarde mee als header `x-td-preview-secret`.

## Bestanden

- `For You TD Light POC from v3.37.toe`: veilige kopie van de bewezen hardware-bron.
- `td_preview_sender.py`: TouchDesigner Python helper om TOPs als JPEG preview te posten.

## Volgende TD-stap

Open alleen de POC-kopie, maak daarin `/ShowLight`, en map de bestaande bewezen
hardware TOPs/outs naar de namen uit `td_preview_sender.py`. Daarna kan de
preview bus direct zichtbaar worden in `/admin/td-preview`.
