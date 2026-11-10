"""Zet de FY Greenscreen-component in een show-bestand, per camera.

python3 patch_show.py "<show>.toe" "<nieuw>.toe"

Per Camera1..3:
- nieuwe COMP 'greenscreen' (laadt show/greenscreen/fy_greenscreen.tox), ingang = switch2 (het rechtop gezette camerabeeld)
- nieuwe TOP 'key_transform' met dezelfde verschuiving/schaal als 'transform'
- null1 (→ key → cam1 → comp1) krijgt key_transform i.p.v. de oude chromaKey; de oude chromaKey blijft staan (terugzetten = null1 terugwijzen)
Het invoerbestand wordt niet aangeraakt.
"""
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

TD = "/Applications/TouchDesigner.app/Contents/MacOS"

# De component komt uit een .tox die pas na het verbinden geladen wordt; TD laat de verbinding dan vallen.
# Dit Execute DAT verbindt switch2 → greenscreen bij start en controleert het daarna elke seconde.
AANSLUITEN = """
def _verbind():
    g = op('greenscreen')
    s = op('switch2')
    if g is not None and s is not None and g.inputConnectors and not g.inputs:
        g.inputConnectors[0].connect(s)

def onStart():
    _verbind()

def onCreate():
    _verbind()

def _status():
    import json, os, time
    g = op('greenscreen')
    if g is None:
        return
    now = time.time()
    v = op('/project1/video1')
    last = me.fetch('last', None)
    me.store('last', (now, v.totalCooks if v else 0, g.op('samenvoegen').totalCooks if g.op('samenvoegen') else 0))
    def ch(o, n):
        try:
            return round(float(o[n].eval()), 1)
        except Exception:
            return None
    st = {
        "tijd": time.strftime("%H:%M:%S"),
        "camera": parent().name,
        "verbonden": bool(g.inputs),
        "in1": [g.op('in1').width, g.op('in1').height] if g.op('in1') else None,
        "modus": g.par.Modus.eval() if hasattr(g.par, 'Modus') else None,
        "rvm_ms": ch(g.op('info_rvm'), 'infer_ms') if g.op('info_rvm') else None,
        "fouten": {o.name: o.errors() for o in g.children if o.errors()},
    }
    if last:
        dt = now - last[0]
        st["video1_kooks_per_s"] = round(((v.totalCooks if v else 0) - last[1]) / dt, 1)
        st["key_kooks_per_s"] = round(((g.op('samenvoegen').totalCooks if g.op('samenvoegen') else 0) - last[2]) / dt, 1)
    d = os.path.join(project.folder, 'greenscreen', 'status')
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, parent().name + '.json'), 'w') as f:
        f.write(json.dumps(st))

def onFrameStart(frame):
    if frame % 50 == 0:
        _verbind()
    if frame % 250 == 0:
        _status()
"""

UI_PARS = "Modus Keyvast Herkalibreer Actief Keyonder Keyboven Tint Despill Aifill Dichten Randlinks Randrechts Randboven Randonder"


def dat_text(s):
    data = s.encode("utf-8")
    return b"2\n*" + struct.pack(">iiiii", 1, 1, 1, 1, 2) + struct.pack(">i", len(data)) + data


def main():
    src, dst = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    if dst.exists():
        sys.exit(f"bestaat al: {dst}")
    with tempfile.TemporaryDirectory(dir=dst.parent) as tmp:
        work = Path(tmp) / "s.toe"
        shutil.copy(src, work)
        # toeexpand/toecollapse geven ook bij succes exitcode 1: controleer het resultaat zelf
        subprocess.run([f"{TD}/toeexpand", work.name], capture_output=True, cwd=tmp)
        d = Path(str(work) + ".dir")
        if not (d / "project1").is_dir():
            sys.exit("toeexpand mislukt")
        toc_path = Path(str(work) + ".toc")
        toc = toc_path.read_text().splitlines()
        for n in (1, 2, 3):
            cam = d / "project1" / f"Camera{n}"
            if (cam / "greenscreen.n").exists():
                sys.exit(f"Camera{n} heeft al een greenscreen")
            null1 = (cam / "null1.n").read_text()
            new_null1, k = re.subn(r"(\n0 \t)chromaKey\d+/out1\n", r"\1key_transform\n", null1)
            if k != 1:
                sys.exit(f"Camera{n}/null1 wijst niet naar chromaKey: niets veranderd")
            (cam / "null1.n").write_text(new_null1)
            (cam / "greenscreen.n").write_text(
                "COMP:base\ntile 500 -75 160 110\nflags =  viewer 1 parlanguage 0\ninputs\n{\n0 \tswitch2\n}\n"
                "color 0.1 0.35 0.8 \nend\n")
            (cam / "greenscreen.parm").write_text(
                '?\nexternaltox 67108864 "greenscreen/fy_greenscreen.tox"\nenableexternaltox 67108864 on\n'
                'reloadtoxonstart 67108864 on\n?\n')
            (cam / "key_transform.n").write_text(
                "TOP:transform\ntile 675 -75 130 90\nflags =  viewer 1 parlanguage 0\ninputs\n{\n0 \tgreenscreen/out1\n}\n"
                "color 0.1 0.35 0.8 \nend\n")
            shutil.copy(cam / "transform.parm", cam / "key_transform.parm")
            (cam / "greenscreen_aansluiten.n").write_text(
                "DAT:execute\ntile 500 -250 130 90\nflags =  parlanguage 0\ncolor 0.1 0.35 0.8 \nend\n")
            (cam / "greenscreen_aansluiten.parm").write_text(
                "?\nstart 67108864 on\ncreate 67108864 on\nframestart 67108864 on\nlanguage 67108864 python\n?\n")
            (cam / "greenscreen_aansluiten.text").write_bytes(dat_text(AANSLUITEN))
            # bedieningsvenster: parameters van de nieuwe greenscreen i.p.v. de oude chromaKey-interface
            (cam / "greenscreen_ui.n").write_text(
                "COMP:parameter\ntile 675 -250 130 90\nflags =  parlanguage 0\ncolor 0.1 0.35 0.8 \nend\n")
            (cam / "greenscreen_ui.parm").write_text(
                f'?\nop 67108864 greenscreen\nparscope 67108864 "{UI_PARS}"\nw 67108864 520\nh 67108864 560\n?\n')
            (cam / "keywindow.parm").write_text(
                (cam / "keywindow.parm").read_text().replace(f"winop 67108864 chromaKey{n}", "winop 67108864 greenscreen_ui"))
            kw = d / "project1" / f"keywindow{n}.parm"
            kw.write_text(kw.read_text().replace(f"/project1/Camera{n}/chromaKey{n}", f"/project1/Camera{n}/greenscreen_ui"))
            ev = cam / "eval2.parm"
            if ev.exists():
                ev.write_text(ev.read_text().replace(f"op('chromaKey{n}')", "op('greenscreen')"))
            anchor = f"project1/Camera{n}/null1.n"
            i = toc.index(anchor)
            toc[i + 1:i + 1] = [f"project1/Camera{n}/greenscreen.n", f"project1/Camera{n}/greenscreen.parm",
                                f"project1/Camera{n}/key_transform.n", f"project1/Camera{n}/key_transform.parm",
                                f"project1/Camera{n}/greenscreen_aansluiten.n", f"project1/Camera{n}/greenscreen_aansluiten.parm",
                                f"project1/Camera{n}/greenscreen_aansluiten.text",
                                f"project1/Camera{n}/greenscreen_ui.n", f"project1/Camera{n}/greenscreen_ui.parm"]
            if "--houd-oude-key" not in sys.argv:
                pref = f"project1/Camera{n}/chromaKey{n}"
                weg = [t for t in toc if t == pref + ".n" or t.startswith(pref + ".") or t.startswith(pref + "/")]
                toc = [t for t in toc if t not in set(weg)]
                shutil.rmtree(cam / f"chromaKey{n}", ignore_errors=True)
                for f in cam.glob(f"chromaKey{n}.*"):
                    f.unlink()
                print(f"Camera{n}: oude chromaKey{n} weggehaald ({len(weg)} bestanden)")
            print(f"Camera{n}: greenscreen + key_transform + aansluiten + bedieningsvenster, null1 en keywindows omgezet")
        # regiemonitor voor perform mode: Execute DAT bouwt /project1/monitor bij start (alleen als hij ontbreekt)
        p1 = d / "project1"
        (p1 / "monitor_bouwer.n").write_text(
            "DAT:execute\ntile -1200 -1400 130 90\nflags =  parlanguage 0\ncolor 0.1 0.35 0.8 \nend\n")
        (p1 / "monitor_bouwer.parm").write_text(
            "?\nstart 67108864 on\ncreate 67108864 on\nlanguage 67108864 python\n?\n")
        (p1 / "monitor_bouwer.text").write_bytes(dat_text((Path(__file__).parent / "monitor_ui.py").read_text()))
        toc.extend(["project1/monitor_bouwer.n", "project1/monitor_bouwer.parm", "project1/monitor_bouwer.text"])
        # Display-expressie van de camera's verwijst naar een niet-bestaande null2 (fout sinds v1.9): uitzetten
        for n in (1, 2, 3):
            cp = p1 / f"Camera{n}.parm"
            cp.write_text(re.sub(r'display 67108913 on "1 if op\(\'null2\'\).*"\n', "display 67108864 off\n", cp.read_text()))
        toc_path.write_text("\n".join(toc) + "\n")
        work.unlink()
        subprocess.run([f"{TD}/toecollapse", work.name], capture_output=True, cwd=tmp)
        if not work.exists() or work.stat().st_size < 100000:
            sys.exit("toecollapse mislukt")
        shutil.copy(work, dst)
    print("geschreven:", dst)


if __name__ == "__main__":
    main()
