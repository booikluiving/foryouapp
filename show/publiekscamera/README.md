# Publiekscamera: proef

Proef op de UniFi G6 180 (Protect, RTSPS). Draait los van de show. Neemt niets op.

Telt per beeld: gezichten, glimlach, personen, handen omhoog, klappen (houding + beweging bij de polsen), beweging in %.
Detectie met Apple Vision (ingebouwd in macOS, geen modellen downloaden).

## Starten

```bash
cd show/publiekscamera
swiftc -O publiek_vision.swift -o publiek_vision
# streamadres uit Protect → camera → Share Livestream → Secure RTSPS Output
umask 077; echo 'rtsps://192.168.1.1:7441/<token>?enableSrtp' > .rtsp_hoog
/opt/homebrew/bin/python3 publiek_proef.py --tiles 3 --width 3840 --hw
```

Live beeld met overlay: http://127.0.0.1:3322/ — getallen: `/stats`, per seconde ook in `per_seconde.jsonl`.

`--tiles 3` analyseert de 7680×2160 op volle resolutie in 3 tegels; nodig voor gezichten op afstand.

## Belasting (gemeten 12 nov, M4 Max, TouchDesigner open)

| instelling | CPU | geheugen | gezichten |
|---|---|---|---|
| `--hw`, 3 tegels, 5/s | ± 0,7 kern | ± 1,4 GB | allemaal |
| `--hw`, 3 tegels, `--fps 2` | ± 0,3 kern | ± 1,3 GB | allemaal |
| zonder `--hw` (software), 3 tegels, 5/s | ± 1,0 kern | ± 1,6 GB | allemaal |
| medium-stream 2560×720 | ± 0,2 kern | ± 0,3 GB | mist ze |

GPU blijft ± 0 %: Apple Vision draait op de Neural Engine.
