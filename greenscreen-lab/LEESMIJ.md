# greenscreen-lab

Proefopstelling voor AI-mattes in TouchDesigner, los van het show-TD.

| Route | Wat | Waar |
|---|---|---|
| 1 | Apple Vision persoonssegmentatie als C++ TOP | `plugins/src/VisionEngine.mm` |
| 2 | Robust Video Matting (CoreML) als los Python-programma, via Syphon | `sidecar/rvm_syphon.py` |
| 3 | Robust Video Matting (CoreML) als C++ TOP | `plugins/src/RvmEngine.mm` |

## Starten en stoppen

```
./start-lab.command   # sidecar + tweede TouchDesigner met td/greenscreen-lab.toe
./stop-lab.command    # stopt alleen die twee (op pid, met controle)
```

In het lab-TD: `/project1/lab`, pagina **Lab**: Bron, Vision-kwaliteit, Uitvoer.
Pagina **GPU-key**: **Key vastzetten** (aan = kalibratie bevroren) en **Herkalibreer** (meet één keer opnieuw, ook als hij vast staat; daarna blijft hij vast). Status linksboven in beeld: KEY VAST / KEY VOLGT LICHT.
Op afstand: `out/lab_control.json`, bijv. `{"pars": {"Weergave": "combi", "Keyvast": true}, "pulse": ["Herkalibreer"]}`.
Voor de show (nog niet gebouwd): twee cues via show-control/OSC, bijv. `td.key.lock` (aan/uit) en `td.key.recalibrate`.

Het netwerk wordt gebouwd door `td/build_lab.py`; wijzigingen in dat bestand worden binnen een seconde opnieuw ingeladen.
Status: `out/td_stats.json`, `out/td_raster.jpg`, `out/sidecar_stats.json`.

## Opnieuw opbouwen

```
~/.venvs/greenscreen/bin/python -I rvm/export_coreml.py --rvm-src <RobustVideoMatting> --weights rvm_mobilenetv3.pth --width 1920 --height 1080 --out models/rvm_1920x1080.mlpackage
~/.venvs/greenscreen/bin/python -I rvm/export_coreml.py ... --width 1080 --height 1920 --out models/rvm_1080x1920.mlpackage
plugins/build.sh
python3 td/make_lab_toe.py
```

Python-omgeving: `~/.venvs/greenscreen` (torch, coremltools, syphon-python).
RVM: github.com/PeterL1n/RobustVideoMatting, GPL-3.0.
