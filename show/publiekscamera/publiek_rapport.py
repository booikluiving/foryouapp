#!/opt/homebrew/bin/python3
"""Rapport uit de secondes van publiek_sensor.py: totaal, per scène en per minuut.

Gebruik: publiek_rapport.py log.jsonl [--json] [--per-minuut]
"""
from __future__ import annotations

import argparse
import json
from collections import OrderedDict

LACH_DEEL = 0.3     # lachmoment: minstens dit deel van de gezichten lacht
SAAI_DEEL = 0.5     # saai moment: minstens dit deel van de gezichten kijkt weg/omlaag/ogen dicht
SAAI_MIN_S = 5      # ... en dat minstens zo veel seconden achter elkaar
PAUZE_S = 3         # momenten met minder dan dit ertussen tellen als één


def momenten(rij: list[bool], min_s: int = 1, pauze_s: int = PAUZE_S) -> int:
    """Aantal aaneengesloten stukken waar rij waar is (korte gaten tellen mee, te korte stukken niet)."""
    n, lengte, gat, bezig = 0, 0, 0, False
    for v in rij + [False] * (pauze_s + 1):
        if v:
            lengte += 1; gat = 0; bezig = True
        elif bezig:
            gat += 1
            if gat > pauze_s:
                n += lengte >= min_s
                lengte, gat, bezig = 0, 0, False
    return n


def deel(teller: float, noemer: float) -> float | None:
    return round(100 * teller / noemer) if noemer else None


def samenvatting(rs: list[dict]) -> dict:
    if not rs:
        return {}
    gez = sum(r["gezichten"] for r in rs)
    zelf = lambda k: sum(r[k] for r in rs)
    lach_rij = [r["gezichten"] >= 1 and r["lachen"] / r["gezichten"] >= LACH_DEEL for r in rs]
    saai_rij = [r["gezichten"] >= 1 and r["saai"] / r["gezichten"] >= SAAI_DEEL for r in rs]
    return {
        "seconden": len(rs),
        "personen_gem": round(sum(r["personen"] for r in rs) / len(rs), 1),
        "personen_max": max(r["personen"] for r in rs),
        "lachen_pct": deel(zelf("lachen"), gez),
        "aandacht_pct": deel(zelf("aandacht"), gez),
        "saai_pct": deel(zelf("saai"), gez),
        "weg_pct": deel(zelf("weg"), gez),
        "omlaag_pct": deel(zelf("omlaag"), gez),
        "ogen_dicht_pct": deel(zelf("ogen_dicht"), gez),
        "lachmomenten": momenten(lach_rij),
        "saaie_momenten": momenten(saai_rij, min_s=SAAI_MIN_S),
        "handen_momenten": momenten([r["handen"] > 0 for r in rs]),
        "klapmomenten": momenten([r["klappen"] > 0 for r in rs]),
        "beweging_gem": round(sum(r["beweging"] for r in rs) / len(rs), 2),
    }


def rapport(rs: list[dict]) -> dict:
    per_scene: "OrderedDict[str, list]" = OrderedDict()
    per_minuut: "OrderedDict[str, list]" = OrderedDict()
    for r in rs:
        if r.get("fase"):
            naam = (r.get("titel") or "scène") if r["fase"] == "scene" else "tussen"
            sleutel = f"{naam}|{r.get('situationRunId') or ''}"
            per_scene.setdefault(sleutel, []).append(r)
        per_minuut.setdefault(r["t"][:5], []).append(r)
    return {
        "van": rs[0]["t"], "tot": rs[-1]["t"],
        "totaal": samenvatting(rs),
        "per_scene": [{"naam": k.split("|")[0], "van": v[0]["t"], **samenvatting(v)} for k, v in per_scene.items()],
        "per_minuut": [{"minuut": k, **samenvatting(v)} for k, v in per_minuut.items()],
    }


KOLOMMEN = [("personen_gem", "pers"), ("personen_max", "max"), ("lachen_pct", "lacht%"), ("aandacht_pct", "aandacht%"),
            ("saai_pct", "saai%"), ("weg_pct", "weg%"), ("omlaag_pct", "omlaag%"), ("ogen_dicht_pct", "ogen%"),
            ("lachmomenten", "lach#"), ("saaie_momenten", "saai#"), ("handen_momenten", "hand#"),
            ("klapmomenten", "klap#"), ("beweging_gem", "bew%")]


def regel(label: str, s: dict, breed: int) -> str:
    cel = lambda v: "-" if v is None else str(v)
    return f"{label[:breed]:<{breed}} " + " ".join(f"{cel(s.get(k)):>{max(5, len(t))}}" for k, t in KOLOMMEN)


def tekst(r: dict, per_minuut: bool = False) -> str:
    breed = 28
    kop = f"{'':<{breed}} " + " ".join(f"{t:>{max(5, len(t))}}" for _, t in KOLOMMEN)
    uit = [f"Publiek {r['van']}–{r['tot']} ({r['totaal']['seconden']} s)", kop, regel("totaal", r["totaal"], breed)]
    if r["per_scene"]:
        uit += ["", "per scène"] + [regel(f"{s['van'][:5]} {s['naam']}", s, breed) for s in r["per_scene"]]
    if per_minuut:
        uit += ["", "per minuut"] + [regel(m["minuut"], m, breed) for m in r["per_minuut"]]
    uit += ["", "%: deel van de gezichten (gemiddeld). #: aantal momenten. saai = kijkt weg, hoofd omlaag of ogen dicht."]
    return "\n".join(uit)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("log")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--per-minuut", action="store_true")
    a = ap.parse_args()
    rs = [json.loads(l) for l in open(a.log) if l.strip()]
    r = rapport(rs)
    print(json.dumps(r, ensure_ascii=False, indent=1) if a.json else tekst(r, a.per_minuut))


if __name__ == "__main__":
    main()
