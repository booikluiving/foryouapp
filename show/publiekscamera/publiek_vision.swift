// Leest BGRA-frames (W x H) van stdin, draait Apple Vision en schrijft per frame één JSON-regel.
// Gebruik: publiek_vision <breedte> <hoogte>
import Foundation
import Vision
import CoreImage
import CoreVideo

let args = CommandLine.arguments
guard args.count >= 3, let W = Int(args[1]), let H = Int(args[2]) else {
    FileHandle.standardError.write("gebruik: publiek_vision <w> <h>\n".data(using: .utf8)!)
    exit(2)
}
let frameBytes = W * H * 4
let skip = Set((ProcessInfo.processInfo.environment["PV_SKIP"] ?? "").split(separator: ",").map(String.init))
let stdin = FileHandle.standardInput
let ciContext = CIContext(options: [.useSoftwareRenderer: false])
let smileDetector = CIDetector(ofType: CIDetectorTypeFace, context: ciContext,
                               options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!

// Leest precies n bytes van stdin naar dst; false bij einde invoer.
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

// Vision: genormaliseerd, oorsprong linksonder. Wij geven linksboven terug.
func box(_ b: CGRect) -> [Double] { [r(b.minX), r(1 - b.maxY), r(b.width), r(b.height)] }

var pbOut: CVPixelBuffer?
CVPixelBufferCreate(nil, W, H, kCVPixelFormatType_32BGRA,
                    [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pbOut)
let sharedPixel = pbOut!
var running = true
while running {
  autoreleasepool {
    let pixel = sharedPixel
    CVPixelBufferLockBaseAddress(pixel, [])
    let dst = CVPixelBufferGetBaseAddress(pixel)!
    let rowBytes = CVPixelBufferGetBytesPerRow(pixel)
    var ok = true
    if rowBytes == W * 4 {
        ok = readInto(dst, frameBytes)
    } else {
        for y in 0..<H where ok { ok = readInto(dst + y * rowBytes, W * 4) }
    }
    CVPixelBufferUnlockBaseAddress(pixel, [])
    if !ok { running = false; return }
    let t0 = Date()

    let faceReq = VNDetectFaceRectanglesRequest()
    let humanReq = VNDetectHumanRectanglesRequest()
    humanReq.upperBodyOnly = false
    let poseReq = VNDetectHumanBodyPoseRequest()
    let handler = VNImageRequestHandler(cvPixelBuffer: pixel, options: [:])
    var reqs: [VNRequest] = []
    if !skip.contains("face") { reqs.append(faceReq) }
    if !skip.contains("human") { reqs.append(humanReq) }
    if !skip.contains("pose") { reqs.append(poseReq) }
    try? handler.perform(reqs)

    // Glimlach via CIDetector op het hele beeld (oorsprong linksonder, pixels).
    let ci = CIImage(cvPixelBuffer: pixel)
    let smiles = skip.contains("smile") ? [] : ((smileDetector.features(in: ci, options: [CIDetectorSmile: true]) as? [CIFaceFeature]) ?? [])
    let smileBoxes: [CGRect] = smiles.filter { $0.hasSmile }.map {
        CGRect(x: $0.bounds.minX / CGFloat(W), y: $0.bounds.minY / CGFloat(H),
               width: $0.bounds.width / CGFloat(W), height: $0.bounds.height / CGFloat(H))
    }

    var faces: [[String: Any]] = []
    for f in faceReq.results ?? [] {
        let b = f.boundingBox
        let c = CGPoint(x: b.midX, y: b.midY)
        let smile = smileBoxes.contains { $0.insetBy(dx: -$0.width * 0.3, dy: -$0.height * 0.3).contains(c) }
        faces.append(["b": box(b), "smile": smile, "c": r(CGFloat(f.confidence))])
    }
    let persons: [[Double]] = (humanReq.results ?? []).map { box($0.boundingBox) }

    var poses: [[String: Any]] = []
    let names: [(VNHumanBodyPoseObservation.JointName, String)] = [
        (.nose, "nose"), (.neck, "neck"), (.leftShoulder, "ls"), (.rightShoulder, "rs"),
        (.leftElbow, "le"), (.rightElbow, "re"), (.leftWrist, "lw"), (.rightWrist, "rw"),
        (.leftHip, "lh"), (.rightHip, "rh"),
    ]
    for p in poseReq.results ?? [] {
        guard let pts = try? p.recognizedPoints(.all) else { continue }
        var j: [String: [Double]] = [:]
        for (jn, key) in names {
            if let pt = pts[jn], pt.confidence > 0.2 {
                j[key] = [r(pt.location.x), r(1 - pt.location.y), r(CGFloat(pt.confidence))]
            }
        }
        if !j.isEmpty { poses.append(j) }
    }

    let out: [String: Any] = [
        "faces": faces, "persons": persons, "poses": poses,
        "ms": Int(Date().timeIntervalSince(t0) * 1000),
    ]
    ciContext.clearCaches()
    if let json = try? JSONSerialization.data(withJSONObject: out) {
        FileHandle.standardOutput.write(json)
        FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    }
  }
}
