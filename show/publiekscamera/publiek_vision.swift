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
let stdin = FileHandle.standardInput
let ciContext = CIContext(options: [.useSoftwareRenderer: false])
let smileDetector = CIDetector(ofType: CIDetectorTypeFace, context: ciContext,
                               options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!

func readExactly(_ n: Int) -> Data? {
    var buf = Data(capacity: n)
    while buf.count < n {
        let chunk = stdin.readData(ofLength: n - buf.count)
        if chunk.isEmpty { return nil }
        buf.append(chunk)
    }
    return buf
}

func r(_ v: CGFloat) -> Double { (Double(v) * 1000).rounded() / 1000 }

// Vision: genormaliseerd, oorsprong linksonder. Wij geven linksboven terug.
func box(_ b: CGRect) -> [Double] { [r(b.minX), r(1 - b.maxY), r(b.width), r(b.height)] }

while true {
    guard let data = readExactly(frameBytes) else { break }
    let t0 = Date()
    var pb: CVPixelBuffer?
    CVPixelBufferCreate(nil, W, H, kCVPixelFormatType_32BGRA,
                        [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pb)
    guard let pixel = pb else { continue }
    CVPixelBufferLockBaseAddress(pixel, [])
    let dst = CVPixelBufferGetBaseAddress(pixel)!
    let rowBytes = CVPixelBufferGetBytesPerRow(pixel)
    data.withUnsafeBytes { (src: UnsafeRawBufferPointer) in
        for y in 0..<H {
            memcpy(dst + y * rowBytes, src.baseAddress! + y * W * 4, W * 4)
        }
    }
    CVPixelBufferUnlockBaseAddress(pixel, [])

    let faceReq = VNDetectFaceRectanglesRequest()
    let humanReq = VNDetectHumanRectanglesRequest()
    humanReq.upperBodyOnly = false
    let poseReq = VNDetectHumanBodyPoseRequest()
    let handler = VNImageRequestHandler(cvPixelBuffer: pixel, options: [:])
    try? handler.perform([faceReq, humanReq, poseReq])

    // Glimlach via CIDetector op het hele beeld (oorsprong linksonder, pixels).
    let ci = CIImage(cvPixelBuffer: pixel)
    let smiles = (smileDetector.features(in: ci, options: [CIDetectorSmile: true]) as? [CIFaceFeature]) ?? []
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
    if let json = try? JSONSerialization.data(withJSONObject: out) {
        FileHandle.standardOutput.write(json)
        FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    }
}
