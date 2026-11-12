"""
For_You: knop SHOW MUZIEK op de Stream Deck.

Zet alleen de muziek van de show uit (inloop, loading en sfeergeluid: wat TouchDesigner via
audiodevout2 naar de SQ-5 stuurt). Ander geluid van de Mac blijft klinken en de SQ-5 blijft
ongemoeid.

Draaien in de Textport van TouchDesigner, met het showbestand open:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_show_muziek_patch.py').read())

Wat het doet, in /project1:
- show_muziek_aan (Constant CHOP, kanaal aan): 1, of 0 zolang de Stream Deck op UDP 8008
  /osc/showmuziek_uit 1 heeft gestuurd. Zonder bericht (na een herstart van TD) is het 1.
- show_muziek_lag (Lag CHOP, 0,3 s): geen tik bij het schakelen.
- show_muziek_vol (Null CHOP)
- audiodevout2: volume volgt show_muziek_vol.
- Bewaart NIET vanzelf.

Terugdraaien: zet SHOW_MUZIEK_TERUG = True en draai opnieuw (volume weer vast op 1).
"""

SHOW_MUZIEK_TERUG = False

_p = op('/project1')
_uit = _p.op('audiodevout2')
# absTime.frame * 0: elke frame opnieuw kijken. Het kanaal bestaat pas na de eerste druk op de
# knop; zonder dit ziet TouchDesigner nooit dat het erbij is gekomen.
_EXPR_AAN = ("absTime.frame * 0 + (0 if (lambda c: c is not None and c.eval() >= 0.5)"
             "(op('/project1/OSC_knoppen_streamdeck/oscin1').chan('osc/showmuziek_uit')) else 1)")

if _uit is None:
    print('For_You show-muziek: audiodevout2 ontbreekt, niets gedaan')
elif SHOW_MUZIEK_TERUG:
    _uit.par.volume.expr = ''
    _uit.par.volume.mode = ParMode.CONSTANT
    _uit.par.volume = 1
    for _n in ('show_muziek_vol', 'show_muziek_lag', 'show_muziek_aan'):
        _o = _p.op(_n)
        if _o is not None:
            _o.destroy()
    print('For_You show-muziek: teruggedraaid, volume vast op 1')
else:
    print('For_You show-muziek: volume stond op', _uit.par.volume.eval(),
          '(expr: %s)' % _uit.par.volume.expr if _uit.par.volume.mode == ParMode.EXPRESSION else '')
    _aan = _p.op('show_muziek_aan') or _p.create(constantCHOP, 'show_muziek_aan')
    _aan.par.const0name = 'aan'
    _aan.par.const0value.expr = _EXPR_AAN
    _aan.par.const0value.mode = ParMode.EXPRESSION
    _lag = _p.op('show_muziek_lag') or _p.create(lagCHOP, 'show_muziek_lag')
    _lag.par.lag1 = 0.3
    _lag.par.lag2 = 0.3
    _lag.inputConnectors[0].connect(_aan)
    _vol = _p.op('show_muziek_vol') or _p.create(nullCHOP, 'show_muziek_vol')
    _vol.inputConnectors[0].connect(_lag)
    _x, _y = _uit.nodeX, _uit.nodeY - 150
    for _i, _o in enumerate((_aan, _lag, _vol)):
        _o.nodeX, _o.nodeY = _x + _i * 150, _y
    _uit.par.volume.expr = "op('show_muziek_vol')['aan']"
    _uit.par.volume.mode = ParMode.EXPRESSION
    print('For_You show-muziek: klaar, NIET bewaard. Stand nu: aan =', _vol['aan'].eval())
