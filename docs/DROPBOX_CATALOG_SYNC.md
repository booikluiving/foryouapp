# Dropbox catalog sync

De levende catalogus-sync maakt van `Dropbox/For You/Database/` een gedeelde bestandsrepresentatie van de lokale SQLite-catalogus.

## Structuur

```text
Dropbox/
  For You/
    Database/
      00 Index voor GPT/
      01 Research/
      02 Personages/
      03 Omgevingen/
      04 Situaties/
      06 Stijlregels/
      07 Grappige voorbeeldscènes/
      08 Runs & Scores/
      09 Chatlogs/
      10 Techniek & Sync/
```

`data/live.sqlite` wordt niet via Dropbox gesynct. De app blijft SQLite gebruiken voor de live show; Dropbox bevat kleine canonieke `.foryou.md` bestanden, indexen, chatlogs en run/scores.

## Gedrag

- `02 Personages`, `03 Omgevingen`, `04 Situaties` en `06 Stijlregels` zijn bidirectioneel.
- App-wijzigingen worden naar Dropbox geëxporteerd.
- Dropbox-wijzigingen worden door een watcher en periodieke reconcile terug naar SQLite geïmporteerd.
- Bestandsnamen beginnen met de naam en bevatten daarna type plus vast ID, bijvoorbeeld `peter-character-0002.foryou.md`; het ID blijft de sleutel, de naam is er voor vindbaarheid.
- `04 Situaties` beheert de premise/titel van bestaande scènes.
- Speelbare scène-compositie blijft in SQLite; die wordt niet als GPT-facing Dropbox-map geëxporteerd.
- `08 Runs & Scores` en `09 Chatlogs` zijn exportlagen voor analyse en GPT-context.
- `09 Chatlogs/transcripts` bevat leesbare Markdown-transcripts; `09 Chatlogs/raw` bewaart JSONL voor machinegebruik.
- Conflicten worden nooit stil overschreven; rapporten komen in `10 Techniek & Sync/conflicts/`.

## Configuratie

- `FORYOU_DROPBOX_CATALOG_DIR`: rootmap, standaard `~/Dropbox/For You/Database` met automatische detectie van macOS `~/Library/CloudStorage/Dropbox...`.
- `FORYOU_DROPBOX_CATALOG_ENABLED=0`: zet de sync uit.
- `FORYOU_DROPBOX_CATALOG_INTERVAL_MS`: periodieke reconcile, standaard `2000`.
- `FORYOU_DROPBOX_CATALOG_DEBOUNCE_MS`: debounce voor file watcher, standaard `700`.

Als `FORYOU_DROPBOX_CATALOG_DIR` niet gezet is en er geen Dropbox-map wordt gevonden, blijft de sync uit.

## Admin diagnose

- `GET /admin/dropbox-catalog/status`
- `POST /admin/dropbox-catalog/sync-now`

De sync loopt automatisch; `sync-now` is alleen voor diagnose of herstel.
