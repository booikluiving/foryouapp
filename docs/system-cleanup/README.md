# For You Systeemopschoning

Dit dossier heeft twee kanten:

- [oud/architecture](oud/architecture): de huidige architectuur als referentie.
- [nieuw/architecture](nieuw/architecture): een directe kopie waarmee we samen de nieuwe versie gaan ontwerpen.

De browser-preview heeft daarom ook precies twee tabs:

```text
Oud
Nieuw
```

Op dit moment zijn `oud` en `nieuw` inhoudelijk hetzelfde. Dat is bewust. We beginnen met een volledige mirror, zodat er geen context verdwijnt. Vanaf hier passen we alleen de `nieuw`-kant aan.

Open:

[preview.html](preview.html)

## Werkregel

`oud` blijft de referentie. `nieuw` is de werkplaats.

Als we iets in `nieuw` verwijderen, versimpelen of hertekenen, moeten we kunnen aanwijzen welk onderdeel uit `oud` daardoor:

- blijft bestaan;
- een andere eigenaar krijgt;
- read-only wordt;
- een command input wordt;
- een side effect adapter wordt;
- bewust verdwijnt.
