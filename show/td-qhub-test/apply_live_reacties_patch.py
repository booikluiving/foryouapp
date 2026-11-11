"""For_You live reacties: podiumlagen emoji en chat in /project1 plaatsen.

Draaien in de Textport van TouchDesigner, met "Najaar 2026 v1.15" (of hoger) open:

    exec(open('/Users/for_you/ForYou/main/show/td-qhub-test/apply_live_reacties_patch.py').read())

Mag vaker draaien: bestaande nodes worden alleen opnieuw verbonden.
"""
# Scene:   audience_emoji_web -> audience_emoji_fit -> over_emoji (over switch10) -> over3 input 1
# Loading: audience_chat_web -> audience_chat_fit -> over_chat (over live_captions_fit)
#          audience_emoji_fit_loading -> over_loading_emoji (over over_chat) -> Loading
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

web = p.op('live_captions_web2')
fit2 = p.op('live_captions_fit2')
over3 = p.op('over3')
cam = p.op('switch10')
lfit = p.op('live_captions_fit')
loading = p.op('Loading')
assert all([web, fit2, over3, cam, lfit, loading]), 'node ontbreekt'

# Scene
ew = maak('audience_emoji_web', 'live_captions_web2', web.nodeX, web.nodeY - 400)
ew.par.url = 'http://127.0.0.1:3026/audience/stage/emoji'
ef = maak('audience_emoji_fit', 'live_captions_fit2', fit2.nodeX, fit2.nodeY - 400)
ef.inputConnectors[0].connect(ew)
oe = maak('over_emoji', 'over3', over3.nodeX - 0, over3.nodeY - 250)
oe.inputConnectors[0].connect(ef)
oe.inputConnectors[1].connect(cam)
over3.inputConnectors[1].connect(oe)

# Loading
cw = maak('audience_chat_web', 'live_captions_web2', lfit.nodeX - 500, lfit.nodeY - 400)
cw.par.url = 'http://127.0.0.1:3026/audience/stage/chat'
cf = maak('audience_chat_fit', 'live_captions_fit', lfit.nodeX - 250, lfit.nodeY - 400)
cf.inputConnectors[0].connect(cw)
oc = maak('over_chat', 'over3', lfit.nodeX + 200, lfit.nodeY - 200)
oc.inputConnectors[0].connect(cf)
oc.inputConnectors[1].connect(lfit)
el = maak('audience_emoji_fit_loading', 'live_captions_fit', lfit.nodeX - 250, lfit.nodeY - 650)
el.inputConnectors[0].connect(ew)
ol = maak('over_loading_emoji', 'over3', lfit.nodeX + 400, lfit.nodeY - 350)
ol.inputConnectors[0].connect(el)
ol.inputConnectors[1].connect(oc)
loading.inputConnectors[0].connect(ol)

print('For_You reacties:', ', '.join(log))
print('over3 in:', [i.name for i in over3.inputs], '| Loading in:', [i.name for i in loading.inputs])
