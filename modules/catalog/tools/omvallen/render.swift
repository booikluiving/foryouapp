import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Tekent de beelden van één stap van het effect "omvallen", met transparantie.
// gebruik: render <spec.json> <uitmap> <druk>
// spec: { "breedte": 2160, "hoogte": 1280, "canvasBreedte": 6480, "fps": 25,
//         "lagen": [ { "bestand", "x", "y", "breedte", "hoogte", "rotatie", "opacity",
//                      "stap": index van de valstap (0 = eerste) of -1, "links": bool } ],
//         "stappen": aantal valstappen }
// druk 0 = beginstand (1 beeld); 1 = komt los; 2..stappen+1 = een stap valt; stappen+2 = zakt weg.
// De beweging is dezelfde als in de editor (modules/catalog/ui/media-assets/app.js, EFFECT).

struct Laag: Decodable {
  let bestand: String; let x: Double; let y: Double; let breedte: Double; let hoogte: Double
  let rotatie: Double?; let opacity: Double?; let stap: Int; let links: Bool?
}
struct Spec: Decodable {
  let breedte: Int; let hoogte: Int; let canvasBreedte: Double; let fps: Double
  let lagen: [Laag]; let stappen: Int
}

let a = CommandLine.arguments
let spec = try! JSONDecoder().decode(Spec.self, from: Data(contentsOf: URL(fileURLWithPath: a[1])))
let outDir = a[2], druk = Int(a[3])!
let S = CGFloat(Double(spec.breedte) / spec.canvasBreedte)
let KLAP = 1.55, LEUN = 0.6, LOSKOM = 1.25, PLAT = 90.0, ZAK = 1.1

func load(_ p: String) -> CGImage {
  let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: p) as CFURL, nil)!
  return CGImageSourceCreateImageAtIndex(src, 0, nil)!
}
let beelden = spec.lagen.map { load($0.bestand) }

func valHoek(_ t: Double) -> Double {
  if t < LEUN { let k = t / LEUN; return 3 * k * k }
  let h = 3 * exp(log(PLAT / 3) * (t - LEUN) / (KLAP - LEUN))
  if t < KLAP && h < PLAT { return h }
  let dt = t - KLAP
  return PLAT - 2.3 * abs(sin(.pi * dt / 0.22)) * exp(-dt / 0.10)
}
func loskomHoek(_ t: Double) -> Double {
  if t < 0.8 { return 4 * sin(.pi / 2 * t / 0.8) }
  if t < LOSKOM { return 4 * cos(.pi / 2 * (t - 0.8) / 0.45) }
  return 0
}
func dreun(_ t: Double, _ op: Double) -> Double {
  let dt = t - op; if dt < 0 { return 0 }
  return 0.01 * sin(dt * 38) * exp(-dt / 0.16)
}
// stand van een laag als het effect stilstaat op positie pos: (hoek in graden, dy in delen van de hoogte)
func stand(_ l: Laag, _ pos: Int) -> (Double, Double) {
  if l.stap < 0 || pos == 0 { return (0, 0) }
  return (pos >= l.stap + 2 ? PLAT : 0, pos >= spec.stappen + 2 ? ZAK : 0)
}
func pose(_ l: Laag, _ t: Double) -> (Double, Double) {
  if druk == 0 { return (0, 0) }
  var (hoek, dy) = stand(l, druk - 1)
  if l.stap < 0 { return (0, 0) }
  if druk == 1 {
    if l.stap == 0 { hoek = loskomHoek(t) }
    dy += dreun(t, LOSKOM) * (l.stap == 0 ? 0.6 : 1)
  } else if druk <= spec.stappen + 1 {
    if l.stap == druk - 2 { hoek = valHoek(t) } else { dy += dreun(t, KLAP) }
  } else {
    let k = max(0, min(1, (t - 0.3) / 0.9))
    if hoek != 0 { dy = ZAK * k * k + dreun(t, 1.2) }
  }
  return (hoek, dy)
}

let duur = druk == 0 ? 0.0 : (druk == 1 ? 2.4 : 2.7)
let frames = max(1, Int((duur * spec.fps).rounded()) + (druk == 0 ? 0 : 1))
let cs = CGColorSpace(name: CGColorSpace.sRGB)!
for f in 0..<frames {
  let t = Double(f) / spec.fps
  let ctx = CGContext(data: nil, width: spec.breedte, height: spec.hoogte, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.interpolationQuality = .high
  ctx.translateBy(x: 0, y: CGFloat(spec.hoogte)); ctx.scaleBy(x: S, y: -S)      // canvas-eenheden, oorsprong linksboven
  for (i, l) in spec.lagen.enumerated() {
    let (hoek, dy) = pose(l, t)
    let links = l.links ?? false
    let w = CGFloat(l.breedte), h = CGFloat(l.hoogte)
    ctx.saveGState()
    ctx.setAlpha(CGFloat(l.opacity ?? 1))
    // zelfde volgorde als de CSS-transform in de editor, rond het midden van de laag
    ctx.translateBy(x: CGFloat(l.x) + w / 2, y: CGFloat(l.y) + h / 2 + CGFloat(dy) * h)
    let px = links ? -w / 2 : w / 2
    ctx.translateBy(x: px, y: h / 2)
    ctx.rotate(by: CGFloat((links ? -hoek : hoek) * .pi / 180))
    ctx.translateBy(x: -px, y: -h / 2)
    ctx.rotate(by: CGFloat((l.rotatie ?? 0) * .pi / 180))
    ctx.translateBy(x: -w / 2, y: h / 2); ctx.scaleBy(x: 1, y: -1)
    ctx.draw(beelden[i], in: CGRect(x: 0, y: 0, width: w, height: h))
    ctx.restoreGState()
  }
  let url = URL(fileURLWithPath: String(format: "%@/druk%d_%04d.png", outDir, druk, f))
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, nil); CGImageDestinationFinalize(dest)
}
print("druk \(druk): \(frames) beelden")
