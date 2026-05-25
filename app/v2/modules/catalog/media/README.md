# V2 Catalog media

Deze map is bewust een lokale mediafolder.

De V2 Catalog bewaart media-metadata, stable IDs en relative paths in de catalog store. De echte bestanden, zoals jpg, png, mp3, m4a en mp4, worden lokaal of via een externe sync-bron gevuld. Ze worden niet meer in Git beheerd, zodat uploads/imports geen zware commits veroorzaken.

Verwachte runtime-structuur:

```text
media/
  environments/
    <environment-id>/
      background/
      soundscape/
      fx/
```

De map kan opnieuw gevuld worden via de V2 Media Asset Manager, een import-tool of een lokale media-sync vanaf de Mac Studio/Dropbox/NAS.
