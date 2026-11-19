"""
For_You: registratie van een run (beeld van het hoofdscherm + geluid van de spelers en de show).

Draaien met het showbestand open, via de opdrachtenmap (kopie in ~/ForYou/td-opdrachten/in/) of
in de Textport:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_registratie_patch.py').read())

Wat het doet: maakt /project1/fy_registratie (Base COMP), los van de keten naar het zaalscherm:
- beeld (Select TOP): het hoofdscherm vóór het kantelen naar het zaalscherm (staand, 1080x1920).
- sq (Audio Device In CHOP): de USB-kanalen van de SQ-5. Kanaal 1 is de groep Mics (alle spelers,
  alleen te horen als hun kanaal op de tafel open staat). Staat alleen aan tijdens een opname.
- muziek (Select CHOP): wat TouchDesigner zelf naar de tafel stuurt (inloop, loading, sfeer).
- links / rechts / geluid: spelers in het midden, muziek links en rechts.
  Het geluid dat de Mac buiten TouchDesigner om afspeelt (extra geluiden, stappen, geluidjes van
  het zaalscherm) komt op 17 nov niet terug over USB en zit er zo dus niet in. Zet op de tafel de
  mix van de zaal (Main LR) op twee USB-uitgangen en vul die nummers in bij REGISTRATIE_TAFELMIX:
  dan wordt precies opgenomen wat de zaal hoort, en vervalt de losse optelling.
- opname (Movie File Out TOP): één .mov met beeld en geluid.
- meting (Perform CHOP): fps en tijd per frame, voor stand().
- stuur (Text DAT): start(pad), stop(), stand(). Show control roept die aan via de opdrachtenmap.

Er wordt niets omgelegd en niets bewaard. Zonder opname kost het niets (alles staat stil).
Terugdraaien: zet REGISTRATIE_TERUG = True en draai opnieuw.
"""

REGISTRATIE_TERUG = False

_REG_BEELD = 'extra_shot_switch'   # ingang van fit2, die het beeld naar Main_TV kantelt
REGISTRATIE_KWALITEIT = 0.8       # 0-1; hoger = groter bestand
REGISTRATIE_TAFELMIX = None       # bijvoorbeeld (31, 32) als Main LR op USB 31/32 staat
# USB 1 = de groep Mics van de tafel (alle spelers, na fader en mute; gepatcht 18 nov op de tafel:
# I/O > Outputs > USB, bron Mix Out). De losse spelerskanalen kwamen niet alle drie over USB.
_REG_SPELERS = 'chan1'
# De groep komt zacht binnen (pieken rond -35 dB bij gewoon praten, gemeten 18 nov) en is zonder
# versterking naast de muziek niet te horen.
REGISTRATIE_SPELERS_DB = 36
_REG_MUZIEK = 'null11'             # ingang van audiodevout2
# Vaste samplerate van de opname. De muziek volgt de rate van het sfeergeluid (27 soundscapes zijn
# 48 kHz); met Sample Rate Match 'max' werd de hele mix dan 48 kHz terwijl het bestand 44,1 kHz is,
# en liep het geluid in die scènes 8,8 % trager dan het beeld (gemeten 19 nov). Daarom: de SQ op
# deze rate en elke optelling met Sample Rate Match 'first' (de spelers), muziek wordt omgerekend.
REGISTRATIE_RATE = 44100

_REG_STUUR = '''
import os, json, time

def _o():
    return parent().op('opname')

def start(pad):
    o = _o()
    if o.par.record.eval():
        return stand()
    os.makedirs(os.path.dirname(pad), exist_ok=True)
    parent().op('sq').par.active = True
    o.par.file = pad
    o.par.record = True
    return stand()

def stop():
    o = _o()
    o.par.record = False
    parent().op('sq').par.active = False
    return stand()

def stand():
    o = _o()
    m = parent().op('meting')
    pad = o.par.file.eval()
    grootte = os.path.getsize(pad) if os.path.exists(pad) else 0
    uit = {
        'opname': bool(o.par.record.eval()),
        'pad': pad,
        'bytes': grootte,
        'fps': round(m['fps'].eval(), 1) if m is not None and m.chan('fps') is not None else None,
        'frameMs': round(m['msec'].eval(), 2) if m is not None and m.chan('msec') is not None else None,
        'cookMs': round(o.cookTime, 3),
        'waarschuwing': (o.warnings() or '') + (o.errors() or '') + (parent().op('sq').errors() or ''),
    }
    print('REGISTRATIE ' + json.dumps(uit))
    return uit
'''

_p = op('/project1')
_oud = _p.op('fy_registratie')

if REGISTRATIE_TERUG:
    if _oud is not None:
        if _oud.op('opname') is not None:
            _oud.op('opname').par.record = False
        _oud.destroy()
    print('For_You registratie: weggehaald')
elif _p.op(_REG_BEELD) is None:
    print('For_You registratie: %s ontbreekt, niets gedaan' % _REG_BEELD)
elif _oud is not None and _oud.op('opname') is not None and _oud.op('opname').par.record.eval():
    print('For_You registratie: er loopt een opname, niets gedaan')
else:
    if _oud is not None:
        _oud.destroy()
    _b = _p.create(baseCOMP, 'fy_registratie')
    _b.nodeX, _b.nodeY = _p.op('Main_TV').nodeX, _p.op('Main_TV').nodeY - 300

    _beeld = _b.create(selectTOP, 'beeld')
    _beeld.par.top = '../' + _REG_BEELD

    _sq = _b.create(audiodeviceinCHOP, 'sq')
    _sq.par.active = False
    _sq_naam = [n for n in _sq.par.device.menuNames if 'Allen&Heath' in n]
    if _sq_naam:
        _sq.par.device = _sq_naam[0]
    _sq.par.format = 'multichannel'
    _sq.par.rate = REGISTRATIE_RATE

    def _kies(naam, kanaal, bron=None):
        _s = _b.create(selectCHOP, naam)
        _s.par.channames = kanaal
        if bron is None:
            _s.inputConnectors[0].connect(_sq)
        else:
            _s.par.chops = bron
        return _s

    def _naam(bron, naam, uit):
        _n = _b.create(renameCHOP, naam)
        _n.par.renamefrom = '*'
        _n.par.renameto = uit
        _n.inputConnectors[0].connect(bron)
        return _n

    if REGISTRATIE_TAFELMIX:
        _l = _naam(_kies('kies_links', 'chan%d' % REGISTRATIE_TAFELMIX[0]), 'links', 'chan1')
        _r = _naam(_kies('kies_rechts', 'chan%d' % REGISTRATIE_TAFELMIX[1]), 'rechts', 'chan2')
    else:
        _sp = _b.create(mathCHOP, 'spelers')
        _sp.par.chanop = 'add'
        _sp.par.gain = 10 ** (REGISTRATIE_SPELERS_DB / 20.0)
        _sp.inputConnectors[0].connect(_kies('kies_spelers', _REG_SPELERS))
        _zij = []
        for _zijde, _kanaal, _uit in (('links', 'chan1', 'chan1'), ('rechts', 'chan2', 'chan2')):
            _m = _b.create(mathCHOP, _zijde + '_som')
            _m.par.chopop = 'add'
            _m.par.srselect = 'first'
            _m.inputConnectors[0].connect(_sp)
            if _p.op(_REG_MUZIEK) is not None:
                _m.inputConnectors[1].connect(_kies('muziek_' + _zijde, _kanaal, '../' + _REG_MUZIEK))
            _zij.append(_naam(_m, _zijde, _uit))
        _l, _r = _zij
    _g = _b.create(mergeCHOP, 'geluid')
    _g.par.srselect = 'first'
    _g.inputConnectors[0].connect(_l)
    _g.inputConnectors[1].connect(_r)

    _o = _b.create(moviefileoutTOP, 'opname')
    _o.inputConnectors[0].connect(_beeld)
    _o.par.type = 'movie'
    # H.264 en H.265 in TouchDesigner werken alleen op NVIDIA; op de Mac is MPEG-4 de lichte keuze.
    _o.par.videocodec = 'mpeg4'
    _o.par.quality = REGISTRATIE_KWALITEIT
    _o.par.audiochop = 'geluid'
    _o.par.audiocodec = 'mp3'
    _o.par.audiobitrate = 'b192'
    _o.par.fps = project.cookRate
    _o.par.stallforopen = False
    _o.par.record = False

    _b.create(performCHOP, 'meting')

    _t = _b.create(textDAT, 'stuur')
    _t.text = _REG_STUUR

    for _i, _n in enumerate(_b.children):
        _n.nodeX, _n.nodeY = (_i % 5) * 200, -(_i // 5) * 150

    print('For_You registratie: klaar, NIET bewaard. Geluid uit:', _sq.par.device.eval(),
          '| codec:', _o.par.videocodec.eval())
