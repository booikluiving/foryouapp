# For_You: bovenaanzicht van de ring in de stemcirkel van het hoofdscherm.
#
# De pagina van het hoofdscherm (stage-tussen.html) maakt tijdens het stemmen, zodra de klok staat,
# een rond gat in de cirkel (alleen in TouchDesigner, html.een). Dit script legt daaronder het beeld
# van de NDI-camera boven de ring (PTVL-ZCAM), uitgesneden op de ring, rond gemaskeerd en in zwart-wit.
# Het getal en de cirkellijn van de pagina blijven erboven. Tijdens de scène (fase 2) staat de laag uit,
# omdat de pagina dan doorzichtig is; na de scène komt de laag pas terug als het vel van de pagina weer dicht is.
# Na de klok, in Up next, toont de pagina het bovenaanzicht op een tweede plek (uDoel2) tot alle spelers ready
# zijn. De laag kijkt in de pagina (tweede ingang) op welke van de twee plekken het gat open is en tekent
# de ring daar; de plekken mogen elkaar dus overlappen.
#
# Keten: fy_boven_ndi (NDI In) → fy_boven_cirkel (GLSL, 1080×1920) → fy_boven_onder = over(fy_boven_cirkel, bord_keuze)
#        → hoofd_een (tweede ingang, was bord_keuze).
# Bijstellen: op fy_boven_cirkel, uCentrum (midden van de ring in het camerabeeld, pixels van linksboven),
# uStraal (straal van de ring, x en y apart: de lens rekt iets uit), uDoel (midden en straal op de pagina),
# uDoel2 (plek in Up next: dezelfde getallen als --upboven-x/-y/-r in stage-tussen.html, straal + 2).
# Terugdraaien: zet BOVENCIRKEL_TERUG = True en voer opnieuw uit.

BOVENCIRKEL_TERUG = globals().get('BOVENCIRKEL_TERUG', False)
NDI_NAAM = 'PTVL-ZCAM (Chan1, 192.168.1.199)'

ouder = op('/project1')
hoofd = ouder.op('hoofd_een')
bord = ouder.op('bord_keuze')

PIXEL = '''// For_You: bovenaanzicht van de ring, rond gemaskeerd op de plek van de stemcirkel (apply_bovencirkel_patch.py).
uniform vec2 uCentrum;   // midden van de ring in het camerabeeld (pixels, van linksboven)
uniform vec2 uStraal;    // straal van de ring in het camerabeeld (pixels, x en y)
uniform vec3 uDoel;      // midden (x, y van linksboven) en straal op de pagina van 1080x1920
uniform vec3 uDoel2;     // tweede plek op de pagina (Up next)
uniform float uZicht;    // 0 tijdens de scène
out vec4 fragColor;
// Hoe open is het gat van de pagina op deze plek: gemeten op acht punten die niet in de andere plek liggen.
float open(vec3 doel, vec3 ander) {
    float o = 0.0;
    for (int i = 0; i < 8; i++) {
        float h = 6.2831853 * (float(i) + 0.5) / 8.0;
        vec2 pt = doel.xy + 0.8 * doel.z * vec2(cos(h), sin(h));
        if (distance(pt, ander.xy) < ander.z) continue;
        o = max(o, 1.0 - texture(sTD2DInputs[1], vec2(pt.x / 1080.0, 1.0 - pt.y / 1920.0)).a);
    }
    return o;
}
void main() {
    vec2 pagina = vec2(vUV.s * 1080.0, (1.0 - vUV.t) * 1920.0);
    vec2 p = (pagina - uDoel.xy) / uDoel.z;          // -1..1 binnen de cirkel
    vec2 p2 = (pagina - uDoel2.xy) / max(uDoel2.z, 1.0);
    if (min(length(p), length(p2)) > 1.0) { fragColor = vec4(0.0); return; }
    if (open(uDoel2, uDoel) > open(uDoel, uDoel2) + 0.02) p = p2;
    float d = length(p);
    float a = (1.0 - smoothstep(0.985, 1.0, d)) * uZicht;
    vec2 res = uTD2DInfos[0].res.zw;
    vec2 bron = uCentrum + p * uStraal;
    vec2 uv = clamp(vec2(bron.x / res.x, 1.0 - bron.y / res.y), vec2(0.0), vec2(1.0));
    vec4 c = texture(sTD2DInputs[0], uv);
    float grijs = dot(c.rgb, vec3(0.299, 0.587, 0.114));   // zwart-wit
    fragColor = TDOutputSwizzle(vec4(vec3(grijs) * a, a));
}
'''


def weg(naam):
    o = ouder.op(naam)
    if o is not None:
        o.destroy()


if BOVENCIRKEL_TERUG:
    hoofd.inputConnectors[1].connect(bord)
    for n in ('fy_boven_onder', 'fy_boven_cirkel', 'fy_boven_cirkel_pixel', 'fy_boven_ndi', 'fy_boven_zicht', 'fy_boven_fase'):
        weg(n)
    print('bovencirkel teruggedraaid: hoofd_een <- bord_keuze')
else:
    ndi = ouder.op('fy_boven_ndi') or ouder.create(ndiinTOP, 'fy_boven_ndi')
    ndi.par.name = NDI_NAAM
    ndi.par.hwdecode = True
    ndi.par.extraips = '192.168.1.199'
    ndi.nodeX, ndi.nodeY = bord.nodeX - 400, bord.nodeY - 300

    dat = ouder.op('fy_boven_cirkel_pixel') or ouder.create(textDAT, 'fy_boven_cirkel_pixel')
    dat.text = PIXEL
    dat.nodeX, dat.nodeY = ndi.nodeX, ndi.nodeY - 150

    gl = ouder.op('fy_boven_cirkel') or ouder.create(glslTOP, 'fy_boven_cirkel')
    gl.inputConnectors[0].connect(ndi)
    gl.inputConnectors[1].connect(ouder.op('audience_tussen_web'))
    gl.par.pixeldat = dat
    gl.par.outputresolution = 'custom'
    gl.par.resolutionw, gl.par.resolutionh = 1080, 1920
    gl.par.vec0name = 'uCentrum'
    gl.par.vec0valuex, gl.par.vec0valuey = 941, 555
    gl.par.vec1name = 'uStraal'
    gl.par.vec1valuex, gl.par.vec1valuey = 575, 548
    gl.par.vec2name = 'uDoel'
    gl.par.vec2valuex, gl.par.vec2valuey, gl.par.vec2valuez = 540, 590, 228
    gl.par.vec3name = 'uZicht'
    gl.par.vec4name = 'uDoel2'
    gl.par.vec4valuex, gl.par.vec4valuey, gl.par.vec4valuez = 540, 790, 273
    # Zicht: 0 tijdens de scène. Na de scène blijft de laag nog 0,8 s uit (het vel van de pagina schuift dan
    # nog terug) en vloeit daarna in 0,2 s in; bij het begin van de scène meteen weg.
    fase = ouder.op('fy_boven_fase') or ouder.create(constantCHOP, 'fy_boven_fase')
    fase.par.name0 = 'buiten_scene'
    fase.par.value0.expr = "0 if int(round(op('/project1/phase_value')['phase'])) == 2 else 1"
    fase.nodeX, fase.nodeY = ndi.nodeX, ndi.nodeY - 300
    zicht = ouder.op('fy_boven_zicht') or ouder.create(lagCHOP, 'fy_boven_zicht')
    zicht.inputConnectors[0].connect(fase)
    zicht.par.lag1, zicht.par.lag2 = 0, 0
    zicht.par.clamp = True
    zicht.par.slope1, zicht.par.slope2 = 1, 1000
    zicht.nodeX, zicht.nodeY = fase.nodeX + 200, fase.nodeY
    gl.par.vec3valuex.expr = "min(1, max(0, (op('/project1/fy_boven_zicht')[0] - 0.8) * 5))"
    gl.nodeX, gl.nodeY = ndi.nodeX + 200, ndi.nodeY

    ov = ouder.op('fy_boven_onder') or ouder.create(overTOP, 'fy_boven_onder')
    ov.inputConnectors[0].connect(gl)
    ov.inputConnectors[1].connect(bord)
    ov.nodeX, ov.nodeY = gl.nodeX + 200, gl.nodeY

    hoofd.inputConnectors[1].connect(ov)
    print('bovencirkel aan:', ndi.par.name.eval(), ndi.width, ndi.height, '| fouten:', gl.errors(), '| hoofd_een <-', [i.path for i in hoofd.inputs], ov.width, ov.height)
