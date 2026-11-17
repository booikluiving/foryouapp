#!/usr/bin/env python3
"""Spelersfoto: kiest tijdens de scène per speler het beste beeld en geeft het aan de publieksserver.

Het publiek krijgt na de scène de vraag welk personage het leukst was, met een foto van de speler uit
de scène die net gespeeld is. Dit script kijkt in een map waar tijdens de scène beelden per speler in
komen (plek1/, plek2/, plek3/, JPEG of PNG, bijvoorbeeld elke paar seconden één uit TouchDesigner):

    <map>/plek1/0001.jpg   <map>/plek2/0001.jpg   <map>/plek3/0001.jpg

Elk nieuw beeld krijgt een cijfer: staat er een gezicht in, kijkt het naar de camera, zijn de ogen open,
lacht het, is het groot genoeg. Zonder bruikbaar gezicht telt een persoon in beeld (het bovenlijf). Is het beter dan het beste tot nu toe, dan gaat een uitsnede (staand,
het gezicht bovenin, de omgeving eromheen) naar de publieksserver. Komt er een tijd geen beeld binnen,
dan begint de volgende scène weer met een schone lei.

Gebruik:  spelersfoto.py --map ~/ForYou/spelersfoto [--server http://127.0.0.1:3026] [--eenmalig]
Gezichten vinden doet publiek_vision (Apple Vision, zie show/publiekscamera); beelden lezen en snijden doet ffmpeg.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

HIER = Path(__file__).resolve().parent
# publiek_vision wordt gebouwd uit publiek_vision.swift (zie show/publiekscamera/README.md); SPELERSFOTO_VISION wijst een andere aan.
VISION = Path(os.environ.get("SPELERSFOTO_VISION") or HIER.parent / "publiekscamera" / "publiek_vision")
KIJK_BREEDTE = 960          # op deze breedte zoekt Vision naar gezichten
FOTO = (540, 720)           # de uitsnede die naar de telefoon gaat (staand, 3:4)
MAX_BYTES = 140 * 1024      # de publieksserver neemt hoogstens 150 kB aan
NIEUWE_SCENE_NA = 25.0      # zo lang geen nieuw beeld = de scène is voorbij
NIEUWE_SCENE_FRAMES = 300   # TouchDesigner bewaart alleen tijdens de scène, met het framenummer als naam: een sprong = een nieuwe scène


def maat(bestand: Path) -> tuple[int, int]:
    uit = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "json", str(bestand)], capture_output=True, text=True, timeout=10)
    stroom = json.loads(uit.stdout)["streams"][0]
    return int(stroom["width"]), int(stroom["height"])


def zoek(bestand: Path, breedte: int, hoogte: int) -> dict:
    """Wat publiek_vision in het beeld vindt: gezichten (vak 0..1, lach, ogen, hoeken) en personen (vak 0..1)."""
    kb = KIJK_BREEDTE
    kh = max(2, round(hoogte * kb / breedte / 2) * 2)
    ruw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(bestand), "-vf", f"scale={kb}:{kh}", "-pix_fmt", "gray",
                          "-f", "rawvideo", "-frames:v", "1", "-"], capture_output=True, timeout=15).stdout
    if len(ruw) != kb * kh:
        return {}
    uit = subprocess.run([str(VISION), str(kb), str(kh), "--gray"], input=ruw, capture_output=True, timeout=20).stdout
    regels = [regel for regel in uit.decode("utf-8", "replace").splitlines() if regel.startswith("{")]
    return json.loads(regels[-1]) if regels else {}


def hoofd_van_persoon(personen: list) -> dict | None:
    """Geen bruikbaar gezicht (afgewend, opzij, te donker): het hoofd van de grootste persoon in beeld,
    geschat als het bovenste stuk van zijn vak. Te kleine personen (verder weg) tellen niet."""
    vakken = [p for p in personen if len(p) == 4 and p[3] >= 0.25]
    if not vakken:
        return None
    x, y, b, h = max(vakken, key=lambda p: p[2] * p[3])
    hb = min(b * 0.55, h * 0.16)
    return {"b": [x + b / 2 - hb / 2, y + h * 0.02, hb, h * 0.14], "persoon": h}


def cijfer(gezicht: dict) -> float:
    """Hoe goed dit gezicht is als foto. Onder nul = niet bruikbaar."""
    _x, _y, b, h = gezicht["b"]
    if h < 0.08:                      # te klein in beeld
        return -1.0
    punten = float(gezicht.get("c", 0)) * 2
    punten += min(h, 0.5) * 6         # groter is beter
    punten -= abs(float(gezicht.get("yaw", 0))) / 20      # naar de camera kijken
    punten -= max(0.0, float(gezicht.get("pitch", 0))) / 20
    if gezicht.get("eyes") == "dicht":
        punten -= 3
    if gezicht.get("smile"):
        punten += 1.5
    return punten


def uitsnede(bestand: Path, breedte: int, hoogte: int, gezicht: dict) -> bytes:
    """Een staande uitsnede met het gezicht op een derde van boven en de omgeving eromheen."""
    gx, gy, gb, gh = gezicht["b"]
    verhouding = FOTO[0] / FOTO[1]
    # Het gezicht is ruim een kwart van de hoogte van de foto; nooit groter dan het beeld.
    uh = min(hoogte, max(gh * hoogte * 3.6, hoogte * 0.5))
    ub = uh * verhouding
    if ub > breedte:
        ub, uh = breedte, breedte / verhouding
    midden_x = (gx + gb / 2) * breedte
    boven_gezicht = gy * hoogte
    x = min(max(0, midden_x - ub / 2), breedte - ub)
    y = min(max(0, boven_gezicht - uh * 0.22), hoogte - uh)
    filter_ = f"crop={int(ub)}:{int(uh)}:{int(x)}:{int(y)},scale={FOTO[0]}:{FOTO[1]}"
    for kwaliteit in (4, 7, 11, 16):
        jpeg = subprocess.run(["ffmpeg", "-v", "error", "-i", str(bestand), "-vf", filter_, "-frames:v", "1",
                               "-q:v", str(kwaliteit), "-f", "mjpeg", "-"], capture_output=True, timeout=15).stdout
        if 100 < len(jpeg) <= MAX_BYTES:
            return jpeg
    return b""


def stuur(server: str, plek: int, jpeg: bytes) -> dict:
    verzoek = urllib.request.Request(f"{server}/audience/beoordeling/foto?plek={plek}", data=jpeg,
                                     headers={"content-type": "image/jpeg"}, method="POST")
    with urllib.request.urlopen(verzoek, timeout=5) as antwoord:
        return json.loads(antwoord.read().decode("utf-8"))


def bekijk(bestand: Path) -> tuple[float, bytes]:
    """Het cijfer van het beste gezicht in dit beeld en de uitsnede daarvan."""
    breedte, hoogte = maat(bestand)
    gevonden = zoek(bestand, breedte, hoogte)
    beste = max(gevonden.get("faces", []), key=cijfer, default=None)
    if beste is not None and cijfer(beste) >= 0:
        return 1.0 + cijfer(beste), uitsnede(bestand, breedte, hoogte, beste)
    # Geen bruikbaar gezicht, wel iemand in beeld: zijn bovenlijf. Telt minder dan elk gezicht (onder 1),
    # en een grotere persoon (dichterbij) telt meer.
    hoofd = hoofd_van_persoon(gevonden.get("persons", []))
    if hoofd is not None:
        return 0.2 + min(hoofd["persoon"], 1.0) * 0.6, uitsnede(bestand, breedte, hoogte, hoofd)
    # Niemand in beeld: het bovenste deel van het beeld, voor als er de hele scène niets beters komt.
    return 0.0, uitsnede(bestand, breedte, hoogte, {"b": [0.2, 0.05, 0.6, 0.28]})


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--map", required=True, help="map met plek1/, plek2/, plek3/")
    p.add_argument("--server", default="http://127.0.0.1:3026", help="adres van de publieksserver")
    p.add_argument("--eenmalig", action="store_true", help="bekijk wat er nu staat en stop")
    p.add_argument("--bewaar", default="", help="map om de gekozen foto's ook in te bewaren (om te kijken)")
    a = p.parse_args()
    basis = Path(a.map).expanduser()
    gezien: set[Path] = set()
    beste: dict[int, float] = {}
    laatst = time.time()
    vorig_frame: dict[int, int] = {}
    if not a.eenmalig:
        # Wat er al ligt hoort bij eerdere scènes.
        for plek in (1, 2, 3, 4, 5, 6):
            gezien.update((basis / f"plek{plek}").glob("*"))
    while True:
        nieuw = sorted((b for plek in (1, 2, 3, 4, 5, 6) for b in (basis / f"plek{plek}").glob("*")
                        if b.suffix.lower() in (".jpg", ".jpeg", ".png") and b not in gezien), key=lambda b: b.stat().st_mtime)
        if nieuw and not a.eenmalig and time.time() - laatst > NIEUWE_SCENE_NA:
            beste.clear()             # een nieuwe scène: opnieuw beginnen
        for bestand in nieuw:
            gezien.add(bestand)
            laatst = time.time()
            plek = int(bestand.parent.name[4:])
            # Een sprong in de framenummers (of een lager nummer na een herstart): een nieuwe scène.
            if bestand.stem.isdigit() and not a.eenmalig:
                frame = int(bestand.stem)
                if plek in vorig_frame and not 0 <= frame - vorig_frame[plek] <= NIEUWE_SCENE_FRAMES:
                    beste.pop(plek, None)
                vorig_frame[plek] = frame
            try:
                punten, jpeg = bekijk(bestand)
            except Exception as fout:  # een half geschreven of kapot beeld: overslaan
                print(f"plek {plek} {bestand.name}: overgeslagen ({fout})", flush=True)
                continue
            if not jpeg or punten <= beste.get(plek, -1.0):
                print(f"plek {plek} {bestand.name}: {punten:.1f} (blijft {beste.get(plek, -1.0):.1f})", flush=True)
                continue
            beste[plek] = punten
            if a.bewaar:
                Path(a.bewaar).expanduser().mkdir(parents=True, exist_ok=True)
                (Path(a.bewaar).expanduser() / f"plek{plek}.jpg").write_bytes(jpeg)
            try:
                antwoord = stuur(a.server, plek, jpeg)
                print(f"plek {plek} {bestand.name}: {punten:.1f} → verstuurd ({len(jpeg) // 1024} kB) {antwoord.get('error', '')}", flush=True)
            except Exception as fout:
                print(f"plek {plek} {bestand.name}: {punten:.1f}, versturen mislukt ({fout})", flush=True)
        if a.eenmalig:
            return
        time.sleep(0.5)


if __name__ == "__main__":
    main()
