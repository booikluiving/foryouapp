"""Maakt het lege labbestand greenscreen-lab.toe met alleen een bootstrap.

De bootstrap voert td/build_lab.py uit bij het openen en opnieuw zodra dat bestand verandert.
Zo staat het hele netwerk als leesbare Python in git en hoeft niemand het .toe met de hand te bouwen.

python3 make_lab_toe.py   (gebruikt toecollapse uit TouchDesigner.app)
"""
import shutil
import struct
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
NAME = "greenscreen-lab"
TOE = HERE / f"{NAME}.toe"
DIR = HERE / f"{NAME}.toe.dir"
TOC = HERE / f"{NAME}.toe.toc"
TOECOLLAPSE = "/Applications/TouchDesigner.app/Contents/MacOS/toecollapse"

BOOTSTRAP = f'''
import os
BUILD = {str(HERE / "build_lab.py")!r}

def _build():
    try:
        code = open(BUILD).read()
        exec(compile(code, BUILD, "exec"), globals())
        me.store("build_mtime", os.path.getmtime(BUILD))
    except Exception as e:
        import traceback
        open(os.path.join(os.path.dirname(BUILD), "..", "out", "td_build.log"), "w").write(traceback.format_exc())

def onStart():
    _build()

def onCreate():
    _build()

def onFrameStart(frame):
    if frame % 60 == 0:
        try:
            if os.path.getmtime(BUILD) != me.fetch("build_mtime", 0):
                _build()
        except Exception:
            pass
'''


def dat_text(s: str) -> bytes:
    data = s.encode("utf-8")
    return b"2\n*" + struct.pack(">iiiii", 1, 1, 1, 1, 2) + struct.pack(">i", len(data)) + data


def main():
    if DIR.exists():
        shutil.rmtree(DIR)
    (DIR / "project1").mkdir(parents=True)
    files = {
        ".build": "version 099\nbuild 2023.12230\nosname macOS\n",
        ".start": "cookrate 60\nclock -f 1 -s 1 -o 0 -w 0\nrealtime on\nviewers on\nresetaudioondevicechange off\n",
        ".grps": "-2\n0\n",
        ".root": "v 0 0 1\nend\n",
        ".parm": "?\n?\n",
        "project1.n": "COMP:container\nv 0 0 1\ntile 200 100 400 244\nflags =  viewer 1 parlanguage 0\ncolor 0.56 0.56 0.56 \nend\n",
        "project1.parm": "?\nw 67108864 1920\nh 67108864 1080\nresizecomp 201326609 \"\" me\nrepocomp 201326609 \"\" me\n?\n",
        "project1/bootstrap.n": "DAT:execute\ntile -400 400 130 90\nflags =  parlanguage 0\ncolor 0.55 0.55 0.55 \nend\n",
        "project1/bootstrap.parm": "?\nstart 67108864 on\ncreate 67108864 on\nframestart 67108864 on\nlanguage 67108864 python\n?\n",
    }
    for name, content in files.items():
        (DIR / name).write_text(content)
    (DIR / "project1" / "bootstrap.text").write_bytes(dat_text(BOOTSTRAP))
    order = [".build", ".start", ".grps", ".root", ".parm", "project1.n", "project1.parm",
             "project1/bootstrap.n", "project1/bootstrap.parm", "project1/bootstrap.text"]
    TOC.write_text("\n".join(order) + "\n")
    if TOE.exists():
        TOE.unlink()
    subprocess.run([TOECOLLAPSE, str(TOE)], check=True, cwd=HERE)
    print("gemaakt:", TOE)


if __name__ == "__main__":
    main()
