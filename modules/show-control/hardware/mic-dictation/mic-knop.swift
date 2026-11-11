// For_You mic-knop: leest de Mute-knop van de Delock USB-microfoon (C-Media 0x0D8C/0x0000)
// en start bij elke druk een Keyboard Maestro-macro: blauw = dicteren aan, rood = dicteren uit.
// De microfoon meldt alleen "er is gedrukt", niet zijn stand. Daarom luistert de helper naar het
// signaal: gedempt (rood) = digitale stilte, aan (blauw) = altijd wat ruis. Na een druk wacht hij even
// en kiest de macro op wat hij hoort. Zonder geluid (geen toestemming) valt hij terug op omdraaien.
// Dicteren-uit drukt alleen als Claude vooraan staat, zodat Cmd+D nooit in een ander programma landt.
//
// HTTP (alleen 127.0.0.1):
//   GET  /api/state      stand, verbonden, laatste druk
//   POST /api/omdraaien  stand omdraaien, geen macro
//   POST /api/druk       doet alsof er op Mute gedrukt is
//   POST /api/blauw | /api/rood   stand vastzetten, geen macro
//
// Bouwen en installeren: ./installeer.sh (bouwt met Info.plist voor de Microfoon-toestemming, zet de LaunchAgent nl.foryou.mic-knop)
// Env: MIC_KNOP_PORT (3231), MIC_KNOP_START (rood|blauw, stand na aansluiten; rood),
//      MIC_KNOP_MACRO_AAN, MIC_KNOP_MACRO_UIT (namen van de KM-macro's)
import Foundation
import AVFoundation
import AppKit
import CoreAudio
import IOKit.hid
import Network

let env = ProcessInfo.processInfo.environment
let port = UInt16(env["MIC_KNOP_PORT"] ?? "3231") ?? 3231
let startStand = (env["MIC_KNOP_START"] ?? "rood") == "blauw" ? "blauw" : "rood"
let macroAan = env["MIC_KNOP_MACRO_AAN"] ?? "For_You mic: dicteren aan"
let macroUit = env["MIC_KNOP_MACRO_UIT"] ?? "For_You mic: dicteren uit"
let vendorID = 0x0D8C, productID = 0x0000
let graceNaAansluiten = 1.5   // bij aansluiten stuurt de mic zelf één rapport
let debounce = 0.3
let drempel: Float = Float(env["MIC_KNOP_DREMPEL"] ?? "0.002") ?? 0.002  // piek boven drempel = geluid
let wachtNaDruk = 0.5
let claudeID = "com.anthropic.claudefordesktop"

var stand = startStand
var verbonden = false
var aangeslotenOp = Date.distantPast
var laatsteDruk: Date? = nil
var laatsteMacro: String? = nil
var drukken = 0
var geluidActief = false
var laatsteGeluid = Date.distantPast
var piekLaatsteSeconde: Float = 0
func gemeten() -> String? { geluidActief ? (Date().timeIntervalSince(laatsteGeluid) < 0.3 ? "blauw" : "rood") : nil }

func ts() -> String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"; return f.string(from: Date()) }
func log(_ s: String) { print("\(ts()) \(s)"); fflush(stdout) }

func startMacro(_ naam: String) {
  laatsteMacro = naam
  // kmtrigger://macro=<naam>, naam URL-gecodeerd
  let enc = naam.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? naam
  let url = "kmtrigger://macro=\(enc)"
  let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/open"); p.arguments = ["-g", url]
  do { try p.run() } catch { log("macro starten mislukt: \(error)") }
  log("macro: \(naam)")
}

// Neemt Claude nu op? Via de CoreAudio-proceslijst; nil als macOS dat niet kan zeggen.
func claudeNeemtOp() -> Bool? {
  func lees<T>(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ standaard: T) -> T? {
    var a = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var v = standaard; var size = UInt32(MemoryLayout<T>.size)
    return AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v) == noErr ? v : nil
  }
  let sys = AudioObjectID(kAudioObjectSystemObject)
  var a = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(sys, &a, 0, nil, &size) == noErr, size > 0 else { return nil }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(sys, &a, 0, nil, &size, &ids) == noErr else { return nil }
  for id in ids {
    guard let bid = lees(id, kAudioProcessPropertyBundleID, "" as CFString) as String?, bid.hasPrefix(claudeID) else { continue }
    if let inp = lees(id, kAudioProcessPropertyIsRunningInput, UInt32(0)), inp != 0 { return true }
  }
  return false
}

func voerUit() {
  // Alleen Cmd+D als Claude anders staat dan de mic; anders raakt de stand omgekeerd
  // (na aansluiten is de mic blauw terwijl Claude niet dicteert).
  let neemtOp = claudeNeemtOp()
  if stand == "blauw" {
    if neemtOp == true { log("Claude dicteert al, geen macro"); return }
    startMacro(macroAan); return
  }
  if neemtOp == false { log("Claude dicteert niet, geen macro"); return }
  let voor = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "?"
  if voor == claudeID { startMacro(macroUit) } else { log("dicteren uit overgeslagen: \(voor) staat vooraan, niet Claude") }
}

func druk(bron: String) {
  let nu = Date()
  if let l = laatsteDruk, nu.timeIntervalSince(l) < debounce { return }
  laatsteDruk = nu; drukken += 1
  if bron == "mic", let voor = gemeten() {
    // De stand vlak vóór de druk is gehoord; de druk draait hem om. Meteen handelen, niet wachten.
    stand = (voor == "rood") ? "blauw" : "rood"
    log("druk (mic) → was \(voor), nu \(stand)"); voerUit()
    DispatchQueue.main.asyncAfter(deadline: .now() + wachtNaDruk) {
      if let na = gemeten(), na != stand { log("let op: na de druk gehoord \(na), verwacht \(stand)") }
    }
    return
  }
  stand = (stand == "rood") ? "blauw" : "rood"
  log("druk (\(bron)) → \(stand)"); voerUit()
}

// Geluid: alleen meten, niets opnemen of opslaan
final class Luisteraar: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
  let sessie = AVCaptureSession()
  func start() {
    guard let dev = AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified)
      .devices.first(where: { $0.uniqueID.contains("Fonglun") || $0.localizedName == "USB Microphone" }) else { log("geluid: mic niet gevonden"); return }
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: break
    case .notDetermined:
      log("geluid: vraagt Microfoon-toestemming")
      AVCaptureDevice.requestAccess(for: .audio) { ok in
        DispatchQueue.main.async { log("geluid: toestemming \(ok ? "gegeven" : "geweigerd")"); if ok { self.start() } }
      }
      return
    default: log("geluid: geen Microfoon-toestemming, val terug op omdraaien"); return
    }
    do {
      sessie.beginConfiguration()
      sessie.inputs.forEach { sessie.removeInput($0) }; sessie.outputs.forEach { sessie.removeOutput($0) }
      sessie.addInput(try AVCaptureDeviceInput(device: dev))
      let out = AVCaptureAudioDataOutput(); out.setSampleBufferDelegate(self, queue: DispatchQueue(label: "geluid")); sessie.addOutput(out)
      sessie.commitConfiguration(); sessie.startRunning()
      geluidActief = true; log("geluid: luistert naar \(dev.localizedName)")
    } catch { log("geluid: starten mislukt: \(error)") }
  }
  func stop() { if sessie.isRunning { sessie.stopRunning() }; geluidActief = false }
  func captureOutput(_ o: AVCaptureOutput, didOutput sb: CMSampleBuffer, from c: AVCaptureConnection) {
    var abl = AudioBufferList(); var bb: CMBlockBuffer?
    guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sb, bufferListSizeNeededOut: nil, bufferListOut: &abl,
      bufferListSize: MemoryLayout<AudioBufferList>.size, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &bb) == noErr,
      let f = CMSampleBufferGetFormatDescription(sb).flatMap({ CMAudioFormatDescriptionGetStreamBasicDescription($0)?.pointee }),
      let p = abl.mBuffers.mData else { return }
    var piek: Float = 0; let bytes = Int(abl.mBuffers.mDataByteSize)
    if f.mFormatFlags & kAudioFormatFlagIsFloat != 0 { let x = p.assumingMemoryBound(to: Float.self); for i in 0..<bytes/4 { piek = max(piek, abs(x[i])) } }
    else { let x = p.assumingMemoryBound(to: Int16.self); for i in 0..<bytes/2 { piek = max(piek, Float(abs(Int(x[i]))) / 32768) } }
    DispatchQueue.main.async { if piek > drempel { laatsteGeluid = Date() }; piekLaatsteSeconde = max(piekLaatsteSeconde, piek) }
  }
}
let luisteraar = Luisteraar()
var piekLog: [String] = []
// Stand bijsturen op wat er klinkt, zonder macro (alleen als er niet net gedrukt is)
Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
  piekLog.append(String(format: "%.4f", piekLaatsteSeconde)); if piekLog.count > 10 { piekLog.removeFirst() }
  piekLaatsteSeconde = 0
  guard let g = gemeten(), g != stand else { return }
  if let l = laatsteDruk, Date().timeIntervalSince(l) < 2 { return }
  stand = g; log("stand bijgesteld op geluid → \(stand)")
}

// HID
let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
IOHIDManagerSetDeviceMatching(manager, [kIOHIDVendorIDKey: vendorID, kIOHIDProductIDKey: productID] as CFDictionary)
let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 64)
IOHIDManagerRegisterDeviceMatchingCallback(manager, { _, _, _, device in
  let r = IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone))
  verbonden = true; aangeslotenOp = Date(); stand = startStand
  log("mic aangesloten (open: \(r == kIOReturnSuccess ? "ok" : String(format: "0x%x", r))), stand → \(stand)")
  DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { luisteraar.stop(); luisteraar.start() }
  IOHIDDeviceRegisterInputReportCallback(device, buffer, 64, { _, _, _, _, _, report, length in
    if Date().timeIntervalSince(aangeslotenOp) < graceNaAansluiten { return }
    guard length >= 1, report[0] == 0x08 else {
      log("onbekend rapport: " + (0..<length).map { String(format: "%02X", report[$0]) }.joined(separator: " ")); return
    }
    druk(bron: "mic")
  }, nil)
}, nil)
IOHIDManagerRegisterDeviceRemovalCallback(manager, { _, _, _, _ in verbonden = false; luisteraar.stop(); log("mic weg (uit of losgetrokken)") }, nil)
IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
let openResult = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))
log("HID-manager open: \(openResult == kIOReturnSuccess ? "ok" : String(format: "0x%x", openResult))")

// HTTP
func iso(_ d: Date?) -> Any { guard let d = d else { return NSNull() }; return ISO8601DateFormatter().string(from: d) }
func stateJSON() -> Data {
  let o: [String: Any] = ["stand": stand, "dicteren": stand == "blauw", "verbonden": verbonden,
                          "laatsteDruk": iso(laatsteDruk), "laatsteMacro": laatsteMacro ?? NSNull(), "drukken": drukken,
                          "macroAan": macroAan, "macroUit": macroUit,
                          "claudeNeemtOp": claudeNeemtOp() ?? NSNull(),
                          "gehoord": gemeten() ?? NSNull(),"geluidActief": geluidActief, "piekPerSeconde": piekLog]
  return (try? JSONSerialization.data(withJSONObject: o, options: [.prettyPrinted, .sortedKeys])) ?? Data()
}
func antwoord(_ c: NWConnection, _ code: Int, _ body: Data) {
  let head = "HTTP/1.1 \(code) \(code == 200 ? "OK" : "Not Found")\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
  c.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in c.cancel() })
}
let tcp = NWParameters.tcp
tcp.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
tcp.allowLocalEndpointReuse = true
let listener = try! NWListener(using: tcp)
listener.newConnectionHandler = { c in
  c.start(queue: .main)
  c.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, _, _ in
    let regel = String(decoding: data ?? Data(), as: UTF8.self).split(separator: "\r\n").first.map(String.init) ?? ""
    let delen = regel.split(separator: " "); let methode = delen.first ?? ""; let pad = delen.count > 1 ? String(delen[1]) : ""
    switch (methode, pad) {
    case ("GET", "/api/state"): antwoord(c, 200, stateJSON())
    case ("POST", "/api/omdraaien"): stand = (stand == "rood") ? "blauw" : "rood"; log("omgedraaid → \(stand)"); antwoord(c, 200, stateJSON())
    case ("POST", "/api/blauw"): stand = "blauw"; log("vastgezet → blauw"); antwoord(c, 200, stateJSON())
    case ("POST", "/api/rood"): stand = "rood"; log("vastgezet → rood"); antwoord(c, 200, stateJSON())
    case ("POST", "/api/druk"): druk(bron: "http"); antwoord(c, 200, stateJSON())
    default: antwoord(c, 404, Data("{\"fout\":\"onbekend\"}".utf8))
    }
  }
}
listener.start(queue: .main)
log("mic-knop luistert op 127.0.0.1:\(port), start-stand \(startStand), macro's: \"\(macroAan)\" / \"\(macroUit)\"")
RunLoop.main.run()
