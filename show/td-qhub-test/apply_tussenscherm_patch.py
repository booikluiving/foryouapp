"""For_You tussenscherm: Loading toont /audience/stage/tussen (titel, script, tellingen, reacties) met de emoji erover.

Draaien in de Textport van TouchDesigner, nadat apply_live_reacties_patch.py al gedraaid is:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_tussenscherm_patch.py').read())

Mag vaker draaien. over_chat en live_captions_fit blijven staan maar gaan niet meer naar Loading.
"""
# Loading: audience_tussen_web -> audience_tussen_fit -> over_loading_emoji (input 1) -> Loading
p = op('/project1')
log = []

def maak(naam, bron, x, y):
    o = p.op(naam)
    if o is None:
        o = p.copy(p.op(bron), name=naam)
        log.append('nieuw ' + naam)
    else:
        log.append('bestaat ' + naam)
    o.nodeX, o.nodeY = x, y
    return o

lfit = p.op('live_captions_fit')
ol = p.op('over_loading_emoji')
loading = p.op('Loading')
assert all([lfit, ol, loading, p.op('live_captions_web2')]), 'eerst apply_live_reacties_patch.py draaien'

tw = maak('audience_tussen_web', 'live_captions_web2', lfit.nodeX - 500, lfit.nodeY - 900)
tw.par.url = 'http://127.0.0.1:3026/audience/stage/tussen'
tf = maak('audience_tussen_fit', 'live_captions_fit', lfit.nodeX - 250, lfit.nodeY - 900)
tf.inputConnectors[0].connect(tw)
ol.inputConnectors[1].connect(tf)
loading.inputConnectors[0].connect(ol)

print('For_You tussenscherm:', ', '.join(log))
print('over_loading_emoji in:', [i.name for i in ol.inputs], '| Loading in:', [i.name for i in loading.inputs])
