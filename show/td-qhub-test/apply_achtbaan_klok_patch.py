"""
For_You: beeld en geluid van de Achtbaan (environment:33) op één klok.

De achtergrond, het gezamenlijke shot, de beeldvullende shots (POV, van afstand) en het
sfeergeluid van de Achtbaan zijn elk één rit van 32,5 seconden. Standaard speelt elk bestand
in TouchDesigner vanaf het moment van laden (sequential), dus ze lopen niet gelijk.

Deze patch laat vier operators op de gedeelde klok lopen zodra hun bestand uit
environment_33 komt; voor elke andere omgeving blijft het afspelen zoals het was:

- prepared_background, samen_achtergrond, omvallen_bestand (Movie File In TOP)
- prepared_soundscape (Audio File In CHOP)

Gebruik: zet dit bestand in ~/ForYou/td-opdrachten/in/ of draai het in de Textport.
Terugdraaien: zet TERUG = True (of draai `terug()` in de Textport).
Bewaart het project niet.
"""

OMGEVING = "environment_33"
DUUR = 32.5
TERUG = False

OPS = {
    # naam: (index-uitdrukking voor alle andere omgevingen, eenheid van voor de patch)
    "prepared_background": ("me.time.frame", "frames"),
    "samen_achtergrond": ("me.time.frame", "frames"),
    "omvallen_bestand": ("me.time.frame", "frames"),
    "prepared_soundscape": ("me.time.frame / root.time.rate", "seconds"),
}

HIER = "('%s' in me.par.file.eval())" % OMGEVING


def toepassen():
    for naam, (oud_index, _oude_eenheid) in OPS.items():
        o = op("/project1/" + naam)
        if o is None:
            print(naam, "niet gevonden, overgeslagen")
            continue
        if not o.fetch("achtbaan_klok_voor", None):
            o.store("achtbaan_klok_voor", {
                "playmode": o.par.playmode.eval(),
                "indexunit": o.par.indexunit.eval(),
                "index_mode": str(o.par.index.mode),
                "index_expr": o.par.index.expr,
                "index_val": o.par.index.val,
            })
        o.par.indexunit = "seconds"
        o.par.index.expr = "(absTime.seconds %% %s) if %s else (%s)" % (DUUR, HIER, oud_index)
        o.par.index.mode = ParMode.EXPRESSION
        o.par.playmode.expr = "'specify' if %s else 'sequential'" % HIER
        o.par.playmode.mode = ParMode.EXPRESSION
        print(naam, "playmode nu:", o.par.playmode.eval(), "| index:", round(o.par.index.eval(), 2))
    print("achtbaan-klok toegepast (niet bewaard)")


def terug():
    for naam in OPS:
        o = op("/project1/" + naam)
        if o is None:
            continue
        voor = o.fetch("achtbaan_klok_voor", None)
        if not voor:
            print(naam, "geen oude stand bewaard, overgeslagen")
            continue
        o.par.playmode.mode = ParMode.CONSTANT
        o.par.playmode = voor["playmode"]
        o.par.indexunit = voor["indexunit"]
        if "EXPRESSION" in voor["index_mode"]:
            o.par.index.expr = voor["index_expr"]
            o.par.index.mode = ParMode.EXPRESSION
        else:
            o.par.index.mode = ParMode.CONSTANT
            o.par.index.expr = voor["index_expr"] or ""
            o.par.index.val = voor["index_val"]
        o.unstore("achtbaan_klok_voor")
        print(naam, "terug naar", o.par.playmode.eval())
    print("achtbaan-klok teruggedraaid (niet bewaard)")


if TERUG:
    terug()
else:
    toepassen()
