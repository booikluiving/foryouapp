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
import subprocess
import sys
import tempfile
from pathlib import Path

TD = "/Applications/TouchDesigner.app/Contents/MacOS"


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
            anchor = f"project1/Camera{n}/null1.n"
            i = toc.index(anchor)
            toc[i + 1:i + 1] = [f"project1/Camera{n}/greenscreen.n", f"project1/Camera{n}/greenscreen.parm",
                                f"project1/Camera{n}/key_transform.n", f"project1/Camera{n}/key_transform.parm"]
            print(f"Camera{n}: greenscreen + key_transform toegevoegd, null1 omgezet")
        toc_path.write_text("\n".join(toc) + "\n")
        work.unlink()
        subprocess.run([f"{TD}/toecollapse", work.name], capture_output=True, cwd=tmp)
        if not work.exists() or work.stat().st_size < 100000:
            sys.exit("toecollapse mislukt")
        shutil.copy(work, dst)
    print("geschreven:", dst)


if __name__ == "__main__":
    main()
