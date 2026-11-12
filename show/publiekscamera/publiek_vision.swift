// Leest frames (W x H) van stdin, draait Apple Vision en schrijft per frame één JSON-regel.
// Gebruik: publiek_vision <breedte> <hoogte> [--gray] [--tiles N] [--overlap px]
//   --gray     invoer is 1 byte per pixel (luma), anders BGRA (4 bytes)
//   --tiles N  kijkt in N verticale delen van hetzelfde beeld (vensters op hetzelfde geheugen, geen kopie)
// Coördinaten in de uitvoer: 0..1 van het hele beeld, oorsprong linksboven.
import Foundation
import Vision
import CoreImage
import CoreVideo

var argv = Array(CommandLine.arguments.dropFirst())
guard argv.count >= 2, let W = Int(argv[0]), let H = Int(argv[1]) else {
    FileHandle.standardError.write("gebruik: publiek_vision <w> <h> [--gray] [--tiles N] [--overlap px]\n".data(using: .utf8)!)
    exit(2)
}
func opt(_ name: String) -> String? {
    guard let i = argv.firstIndex(of: name), i + 1 < argv.count else { return nil }
    return argv[i + 1]
}
let gray = argv.contains("--gray")
let tiles = max(1, Int(opt("--tiles") ?? "1") ?? 1)
let overlap = Int(opt("--overlap") ?? "256") ?? 256
let bpp = gray ? 1 : 4
let frameBytes = W * H * bpp
let skip = Set((ProcessInfo.processInfo.environment["PV_SKIP"] ?? "").split(separator: ",").map(String.init))
let ciContext = CIContext(options: [.useSoftwareRenderer: false])
let smileDetector = CIDetector(ofType: CIDetectorTypeFace, context: ciContext,
                               options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!

// Tegels als genormaliseerde rechthoeken (Vision: oorsprong linksonder).
var tw = (W + (tiles - 1) * overlap + tiles - 1) / tiles
tw += tw % 2
let rois: [CGRect] = (0..<tiles).map { i in
    let x0 = tiles == 1 ? 0 : min(i * (tw - overlap), W - tw)
    let w = tiles == 1 ? W : tw
    return CGRect(x: CGFloat(x0) / CGFloat(W), y: 0, width: CGFloat(w) / CGFloat(W), height: 1)
}

func readInto(_ dst: UnsafeMutableRawPointer, _ n: Int) -> Bool {
    var got = 0
    while got < n {
        let k = read(0, dst + got, n - got)
        if k <= 0 { return false }
        got += k
    }
    return true
}

func r(_ v: CGFloat) -> Double { (Double(v) * 1000).rounded() / 1000 }
// ROI-coördinaten → heel beeld (nog oorsprong linksonder)
func full(_ b: CGRect, _ roi: CGRect) -> CGRect {
    CGRect(x: roi.minX + b.minX * roi.width, y: roi.minY + b.minY * roi.height,
           width: b.width * roi.width, height: b.height * roi.height)
}
func fullPt(_ p: CGPoint, _ roi: CGRect) -> CGPoint {
    CGPoint(x: roi.minX + p.x * roi.width, y: roi.minY + p.y * roi.height)
}
// → linksboven
func box(_ b: CGRect) -> [Double] { [r(b.minX), r(1 - b.maxY), r(b.width), r(b.height)] }
func isDup(_ list: [CGRect], _ b: CGRect) -> Bool { list.contains { $0.contains(CGPoint(x: b.midX, y: b.midY)) } }

// Beweging: luma op een rooster van GX x GY punten, vergeleken met het vorige frame.
let GX = 320, GY = max(1, 320 * H / W)
var prevGrid = [UInt8](repeating: 0, count: GX * GY)
var curGrid = [UInt8](repeating: 0, count: GX * GY)
var havePrev = false

var pbOut: CVPixelBuffer?
CVPixelBufferCreate(nil, W, H, gray ? kCVPixelFormatType_OneComponent8 : kCVPixelFormatType_32BGRA,
                    [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pbOut)
let pixel = pbOut!
CVPixelBufferLockBaseAddress(pixel, [])
let bigBase = CVPixelBufferGetBaseAddress(pixel)!
let bigRow = CVPixelBufferGetBytesPerRow(pixel)
CVPixelBufferUnlockBaseAddress(pixel, [])
// Per tegel een CVPixelBuffer die naar hetzelfde geheugen wijst (geen kopie).
let tileBuffers: [CVPixelBuffer] = rois.map { roi in
    let x0 = Int((roi.minX * CGFloat(W)).rounded()), w = Int((roi.width * CGFloat(W)).rounded())
    var tb: CVPixelBuffer?
    CVPixelBufferCreateWithBytes(nil, w, H, gray ? kCVPixelFormatType_OneComponent8 : kCVPixelFormatType_32BGRA,
                                 bigBase + x0 * bpp, bigRow, nil, nil, nil, &tb)
    return tb!
}
let names: [(VNHumanBodyPoseObservation.JointName, String)] = [
    (.nose, "nose"), (.neck, "neck"), (.leftShoulder, "ls"), (.rightShoulder, "rs"),
    (.leftElbow, "le"), (.rightElbow, "re"), (.leftWrist, "lw"), (.rightWrist, "rw"),
    (.leftHip, "lh"), (.rightHip, "rh"),
]

var running = true
while running {
  autoreleasepool {
    CVPixelBufferLockBaseAddress(pixel, [])
    let base = CVPixelBufferGetBaseAddress(pixel)!
    let rowBytes = CVPixelBufferGetBytesPerRow(pixel)
    var ok = true
    if rowBytes == W * bpp {
        ok = readInto(base, frameBytes)
    } else {
        for y in 0..<H where ok { ok = readInto(base + y * rowBytes, W * bpp) }
    }
    if ok {
        let p = base.assumingMemoryBound(to: UInt8.self)
        for gy in 0..<GY {
            let row = p + (gy * H / GY) * rowBytes
            for gx in 0..<GX {
                curGrid[gy * GX + gx] = row[(gx * W / GX) * bpp + (gray ? 0 : 1)]
            }
        }
    }
    CVPixelBufferUnlockBaseAddress(pixel, [])
    if !ok { running = false; return }
    let t0 = Date()

    var moving = [Bool](repeating: false, count: GX * GY)
    var nMoving = 0
    if havePrev {
        for i in 0..<(GX * GY) where abs(Int(curGrid[i]) - Int(prevGrid[i])) > 18 { moving[i] = true; nMoving += 1 }
    }
    swap(&prevGrid, &curGrid); havePrev = true
    func motionIn(_ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double) -> Double {
        let gx0 = max(0, Int(x0 * Double(GX))), gx1 = min(GX - 1, Int(x1 * Double(GX)))
        let gy0 = max(0, Int(y0 * Double(GY))), gy1 = min(GY - 1, Int(y1 * Double(GY)))
        guard gx1 >= gx0, gy1 >= gy0 else { return 0 }
        var m = 0, n = 0
        for gy in gy0...gy1 { for gx in gx0...gx1 { n += 1; if moving[gy * GX + gx] { m += 1 } } }
        return Double(m) / Double(n)
    }

    var faceBoxes: [CGRect] = [], faceConf: [Float] = [], personBoxes: [CGRect] = []
    var poses: [[String: [Double]]] = []
    var poseAnchors: [CGPoint] = []

    for (roi, tile) in zip(rois, tileBuffers) {
        let handler = VNImageRequestHandler(cvPixelBuffer: tile, options: [:])
        let faceReq = VNDetectFaceRectanglesRequest()
        let humanReq = VNDetectHumanRectanglesRequest()
        humanReq.upperBodyOnly = false
        let poseReq = VNDetectHumanBodyPoseRequest()
        var reqs: [VNImageBasedRequest] = []
        if !skip.contains("face") { reqs.append(faceReq) }
        if !skip.contains("human") { reqs.append(humanReq) }
        if !skip.contains("pose") { reqs.append(poseReq) }
        try? handler.perform(reqs)

        for f in faceReq.results ?? [] {
            let b = full(f.boundingBox, roi)
            if !isDup(faceBoxes, b) { faceBoxes.append(b); faceConf.append(f.confidence) }
        }
        for h in humanReq.results ?? [] {
            let b = full(h.boundingBox, roi)
            if !isDup(personBoxes, b) { personBoxes.append(b) }
        }
        for po in poseReq.results ?? [] {
            guard let pts = try? po.recognizedPoints(.all) else { continue }
            var j: [String: [Double]] = [:]
            var anchor: CGPoint?
            for (jn, key) in names {
                if let pt = pts[jn], pt.confidence > 0.2 {
                    let q = fullPt(pt.location, roi)
                    j[key] = [r(q.x), r(1 - q.y), r(CGFloat(pt.confidence))]
                    if key == "neck" || anchor == nil { anchor = q }
                }
            }
            guard let a = anchor, !j.isEmpty else { continue }
            if poseAnchors.contains(where: { abs($0.x - a.x) < 0.01 && abs($0.y - a.y) < 0.03 }) { continue }
            poseAnchors.append(a)
            if let lw = j["lw"], let rw = j["rw"] {
                j["wm"] = [r(CGFloat(motionIn(min(lw[0], rw[0]) - 0.01, min(lw[1], rw[1]) - 0.03,
                                              max(lw[0], rw[0]) + 0.01, max(lw[1], rw[1]) + 0.03)))]
            }
            poses.append(j)
        }
    }

    // Glimlach: alleen een klein uitsnede rond elk gezicht (kopie van een paar KB) naar CIDetector.
    func smileAt(_ b: CGRect) -> Bool {
        if skip.contains("smile") { return false }
        let pad = 0.4
        let x0 = max(0, Int((b.minX - b.width * pad) * CGFloat(W)))
        let x1 = min(W, Int((b.maxX + b.width * pad) * CGFloat(W)))
        let y0 = max(0, Int((1 - b.maxY - b.height * pad) * CGFloat(H)))   // linksboven
        let y1 = min(H, Int((1 - b.minY + b.height * pad) * CGFloat(H)))
        let cw = x1 - x0, chh = y1 - y0
        guard cw > 8, chh > 8 else { return false }
        var data = Data(count: cw * chh * bpp)
        CVPixelBufferLockBaseAddress(pixel, .readOnly)
        data.withUnsafeMutableBytes { (d: UnsafeMutableRawBufferPointer) in
            for y in 0..<chh {
                memcpy(d.baseAddress! + y * cw * bpp, bigBase + (y0 + y) * bigRow + x0 * bpp, cw * bpp)
            }
        }
        CVPixelBufferUnlockBaseAddress(pixel, .readOnly)
        let img = CIImage(bitmapData: data, bytesPerRow: cw * bpp, size: CGSize(width: cw, height: chh),
                          format: gray ? .L8 : .BGRA8, colorSpace: gray ? CGColorSpaceCreateDeviceGray() : CGColorSpaceCreateDeviceRGB())
        let feats = (smileDetector.features(in: img, options: [CIDetectorSmile: true]) as? [CIFaceFeature]) ?? []
        return feats.contains { $0.hasSmile }
    }

    var faces: [[String: Any]] = []
    for (b, c) in zip(faceBoxes, faceConf) {
        let smile = smileAt(b)
        faces.append(["b": box(b), "smile": smile, "c": r(CGFloat(c))])
    }
    let out: [String: Any] = [
        "faces": faces, "persons": personBoxes.map(box), "poses": poses,
        "motion": r(CGFloat(Double(nMoving) / Double(GX * GY) * 100)),
        "ms": Int(Date().timeIntervalSince(t0) * 1000),
    ]
    ciContext.clearCaches()
    if let json = try? JSONSerialization.data(withJSONObject: out) {
        FileHandle.standardOutput.write(json)
        FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    }
  }
}
