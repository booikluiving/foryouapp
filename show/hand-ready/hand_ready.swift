// Hand omhoog = ready. Kijkt naar de strook met de drie spelers die TouchDesigner wegschrijft
// (~/ForYou/spelerbeeld/strook_0..2.jpg, drie beelden naast elkaar: plek 1, 2, 3). Houdt een speler
// een hand omhoog (onderarm rechtop) een seconde vast, dan meldt dit programma die speler
// als ready bij de publieksdienst (POST /audience/ready/speler). Hand omlaag zet ready niet terug.
// Alleen tussen de scènes, als er een scène klaarstaat (GET /audience/ready/stand → klaar).
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
        for (pols, schouder, elleboog) in [(VNHumanBodyPoseObservation.JointName.leftWrist, VNHumanBodyPoseObservation.JointName.leftShoulder, VNHumanBodyPoseObservation.JointName.leftElbow),
                                           (.rightWrist, .rightShoulder, .rightElbow)] {
            guard let w = p(pols), let e = p(elleboog) else { continue }
            // Onderarm rechtop (pols duidelijk boven de elleboog) en de pols op of boven schouderhoogte.
            guard w.location.y > e.location.y + 0.12 else { continue }
            if let s = p(schouder) ?? p(.neck), w.location.y < s.location.y - 0.03 { continue }
            omhoog = true
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
var gemeld: [Int: Bool] = [:]       // plek → al gemeld voor deze hand omhoog
var laatsteBeeld = Date.distantPast
var stand: [String: Any] = [:]
var standOm = Date.distantPast

while true {
    if Date().timeIntervalSince(standOm) > 1 {
        stand = haal("/audience/ready/stand") ?? [:]
        standOm = Date()
    }
    let klaar = (stand["klaar"] as? Bool) ?? false
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
            if sinds[plek] == nil { sinds[plek] = nu; log("plek \(plek): hand omhoog") }
            if gemeld[plek] != true, nu.timeIntervalSince(sinds[plek]!) >= vastSeconden {
                gemeld[plek] = true
                if ready.contains(plek) { log("plek \(plek): al ready"); continue }
                log("plek \(plek): \(vastSeconden) s vastgehouden → ready")
                if !droog { _ = haal("/audience/ready/speler", methode: "POST", body: ["plek": plek, "ready": true, "bron": "hand"]) }
                standOm = .distantPast
            }
        } else if sinds[plek] != nil {
            sinds[plek] = nil; gemeld[plek] = nil
        }
    }
}
