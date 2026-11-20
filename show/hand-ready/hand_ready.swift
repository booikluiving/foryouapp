// Hand omhoog = ready. Kijkt naar de strook met de drie spelers die TouchDesigner wegschrijft
// (~/ForYou/spelerbeeld/strook_0..2.jpg, drie beelden naast elkaar: plek 1, 2, 3). Houdt een speler
// een hand boven het hoofd een seconde vast (korte gaten in de herkenning tellen niet), dan meldt dit programma die speler
// als ready bij de publieksdienst (POST /audience/ready/speler). Hand omlaag zet ready niet terug.
// Alleen tussen de scènes, als er een scène klaarstaat (GET /audience/ready/stand → klaar).
// In de inloop (instelstand, stand → instel) zet een hand omhoog de key van die speler aan of uit:
// de publieksdienst stuurt het door naar show control. Hand weer omlaag, dan kan het opnieuw.
//
// Bouwen:  swiftc -O hand_ready.swift -o hand_ready
// Gebruik: hand_ready [--map ~/ForYou/spelerbeeld] [--server http://127.0.0.1:3026] [--vast 2.0] [--droog] [--eenmaal pad.jpg]
import Foundation
import Vision
import CoreImage

var argv = Array(CommandLine.arguments.dropFirst())
func opt(_ naam: String) -> String? {
    guard let i = argv.firstIndex(of: naam), i + 1 < argv.count else { return nil }
    return argv[i + 1]
}
let map = (opt("--map") ?? "~/ForYou/spelerbeeld").replacingOccurrences(of: "~", with: NSHomeDirectory())
let server = opt("--server") ?? "http://127.0.0.1:3026"
let vastSeconden = Double(opt("--vast") ?? "1.0") ?? 1.0
let droog = argv.contains("--droog")
let eenmaal = opt("--eenmaal")
let minVertrouwen: Float = 0.3

func log(_ tekst: String) {
    let f = DateFormatter(); f.dateFormat = "HH:mm:ss"
    print("\(f.string(from: Date())) \(tekst)"); fflush(stdout)
}

// Per plek: is er een hand omhoog? Vision: oorsprong linksonder, dus hoger in beeld = grotere y.
func handenOmhoog(_ pad: String) -> [Int: Bool]? {
    guard let beeld = CIImage(contentsOf: URL(fileURLWithPath: pad)) else { return nil }
    let verzoek = VNDetectHumanBodyPoseRequest()
    let handler = VNImageRequestHandler(ciImage: beeld, options: [:])
    do { try handler.perform([verzoek]) } catch { return nil }
    var uit: [Int: Bool] = [1: false, 2: false, 3: false]
    for persoon in verzoek.results ?? [] {
        guard let punten = try? persoon.recognizedPoints(.all) else { continue }
        func p(_ naam: VNHumanBodyPoseObservation.JointName) -> VNRecognizedPoint? {
            guard let punt = punten[naam], punt.confidence >= minVertrouwen else { return nil }
            return punt
        }
        // Welke plek: het midden van het lichaam (nek, anders neus of schouders) in de strook.
        let midden = p(.neck) ?? p(.nose) ?? p(.leftShoulder) ?? p(.rightShoulder)
        guard let m = midden else { continue }
        let plek = min(3, max(1, Int(m.location.x * 3) + 1))
        var omhoog = false
        // Hand boven het hoofd: pols op of boven neushoogte. Valt de pols bij een gestrekte arm
        // boven het beeld weg, dan telt de elleboog duidelijk boven de schouder ook.
        let hoofd = p(.nose) ?? p(.leftEye) ?? p(.rightEye) ?? p(.leftEar) ?? p(.rightEar)
        for (pols, schouder, elleboog) in [(VNHumanBodyPoseObservation.JointName.leftWrist, VNHumanBodyPoseObservation.JointName.leftShoulder, VNHumanBodyPoseObservation.JointName.leftElbow),
                                           (.rightWrist, .rightShoulder, .rightElbow)] {
            if let w = p(pols), let h = hoofd, w.location.y >= h.location.y { omhoog = true }
            if let e = p(elleboog), let s = p(schouder) ?? p(.neck), e.location.y > s.location.y + 0.05 { omhoog = true }
        }
        if omhoog { uit[plek] = true }
    }
    return uit
}

if let pad = eenmaal {
    let r = handenOmhoog(pad) ?? [:]
    print("plek 1: \(r[1] ?? false)  plek 2: \(r[2] ?? false)  plek 3: \(r[3] ?? false)")
    exit(0)
}

func haal(_ pad: String, methode: String = "GET", body: [String: Any]? = nil) -> [String: Any]? {
    guard let url = URL(string: server + pad) else { return nil }
    var verzoek = URLRequest(url: url, timeoutInterval: 2)
    verzoek.httpMethod = methode
    if let body = body {
        verzoek.setValue("application/json", forHTTPHeaderField: "content-type")
        verzoek.httpBody = try? JSONSerialization.data(withJSONObject: body)
    }
    let klaar = DispatchSemaphore(value: 0)
    var uit: [String: Any]? = nil
    URLSession.shared.dataTask(with: verzoek) { data, _, _ in
        if let data = data { uit = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] }
        klaar.signal()
    }.resume()
    _ = klaar.wait(timeout: .now() + 3)
    return uit
}

// Het op één na nieuwste bestand is zeker af; het nieuwste wordt misschien nog geschreven.
func strook() -> (String, Date)? {
    var lijst: [(String, Date)] = []
    for n in 0...2 {
        let pad = "\(map)/strook_\(n).jpg"
        if let a = try? FileManager.default.attributesOfItem(atPath: pad), let d = a[.modificationDate] as? Date { lijst.append((pad, d)) }
    }
    lijst.sort { $0.1 > $1.1 }
    return lijst.count >= 2 ? lijst[1] : nil
}

log("hand_ready kijkt in \(map), meldt bij \(server), \(vastSeconden) s vasthouden\(droog ? " (droog)" : "")")
var sinds: [Int: Date] = [:]        // plek → sinds wanneer de hand omhoog is
var laatstGezien: [Int: Date] = [:]  // plek → laatste beeld met hand omhoog
let gatSeconden = 0.5                // zo lang mag de herkenning de hand missen
var gemeld: [Int: Bool] = [:]       // plek → al gemeld voor deze hand omhoog
var laatsteBeeld = Date.distantPast
var stand: [String: Any] = [:]
var standOm = Date.distantPast

while true {
    if Date().timeIntervalSince(standOm) > 1 {
        stand = haal("/audience/ready/stand") ?? [:]
        standOm = Date()
    }
    let instel = (stand["instel"] as? Bool) ?? false
    let klaar = ((stand["klaar"] as? Bool) ?? false) || instel
    let ready = Set(((stand["plekken"] as? [Any]) ?? []).compactMap { ($0 as? NSNumber)?.intValue })
    guard klaar, let (pad, wanneer) = strook(), Date().timeIntervalSince(wanneer) < 3, wanneer != laatsteBeeld else {
        if !klaar { sinds.removeAll(); gemeld.removeAll() }
        Thread.sleep(forTimeInterval: 0.15)
        continue
    }
    laatsteBeeld = wanneer
    guard let handen = handenOmhoog(pad) else { continue }
    let nu = Date()
    for plek in 1...3 {
        if handen[plek] == true {
            laatstGezien[plek] = nu
            if sinds[plek] == nil { sinds[plek] = nu; log("plek \(plek): hand omhoog") }
            if gemeld[plek] != true, nu.timeIntervalSince(sinds[plek]!) >= vastSeconden {
                gemeld[plek] = true
                if !instel && ready.contains(plek) { log("plek \(plek): al ready"); continue }
                log("plek \(plek): \(vastSeconden) s vastgehouden → \(instel ? "key aan/uit" : "ready")")
                if !droog { _ = haal("/audience/ready/speler", methode: "POST", body: ["plek": plek, "ready": true, "bron": "hand"]) }
                standOm = .distantPast
            }
        } else if sinds[plek] != nil, nu.timeIntervalSince(laatstGezien[plek] ?? .distantPast) > gatSeconden {
            sinds[plek] = nil; gemeld[plek] = nil
        }
    }
}
