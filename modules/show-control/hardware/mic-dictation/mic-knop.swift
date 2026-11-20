// For_You mic-knop: leest de Mute-knop van de Delock USB-microfoon (C-Media 0x0D8C/0x0000)
// en start bij elke druk een Keyboard Maestro-macro: blauw = dicteren aan, rood = dicteren uit.
// Twee keer snel drukken na het dicteren = stoppen en versturen (macro "For_You mic: versturen" → mic-versturen).
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
//   POST /api/zaal/aan[?max=20]  de microfoon klinkt over de speakers (zie "Zaal" hieronder)
//   POST /api/zaal/uit           weer dicht
//
// Zaal: de operator praat via deze microfoon tegen de spelers. Het geluid gaat naar de standaard
// geluidsuitgang van de Mac (SQ - Audio, zelfde weg als het extra geluid) en zo via de tafel naar de
// speakers. Alleen open tussen /api/zaal/aan en /api/zaal/uit; gaat vanzelf dicht na MIC_ZAAL_MAX
// seconden, bij een druk op de knop van de microfoon en als Claude gaat dicteren. Tijdens het
// dicteren gaat hij niet open, en zolang hij open is start de knop van de microfoon geen dictaat.
//   mic-knop --meet [seconden]   meet de vertraging microfoon → uitgang, zonder geluid (volume 0)
//
// Bouwen en installeren: ./installeer.sh (bouwt met Info.plist voor de Microfoon-toestemming, zet de LaunchAgent nl.foryou.mic-knop)
// Env: MIC_KNOP_PORT (3231), MIC_KNOP_START (rood|blauw, stand na aansluiten; rood),
//      MIC_KNOP_MACRO_AAN, MIC_KNOP_MACRO_UIT (namen van de KM-macro's)
//      MIC_ZAAL_MAX (30, seconden tot hij vanzelf dichtgaat), MIC_ZAAL_VOLUME (0.5, 0..1)
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
let macroVerstuur = env["MIC_KNOP_MACRO_VERSTUUR"] ?? "For_You mic: versturen"
let vendorID = 0x0D8C, productID = 0x0000
let graceNaAansluiten = 1.5   // bij aansluiten stuurt de mic zelf één rapport
let debounce = 0.15
let dubbelBinnen = 0.9   // tweede druk binnen deze tijd na "dicteren uit" = versturen
// Rood is exact nul; de ruis van een stille open mic ligt rond 0,001. Daarom een lage drempel.
let drempel: Float = Float(env["MIC_KNOP_DREMPEL"] ?? "0.0002") ?? 0.0002  // piek boven drempel = geluid
let wachtNaDruk = 0.5
let claudeID = "com.anthropic.claudefordesktop"
let zaalMax = max(3, Double(env["MIC_ZAAL_MAX"] ?? "30") ?? 30)
let zaalVolume = min(1, max(0, Float(env["MIC_ZAAL_VOLUME"] ?? "0.5") ?? 0.5))

var stand = startStand
var verbonden = false
var aangeslotenOp = Date.distantPast
var laatsteDruk: Date? = nil
var laatsteMacro: String? = nil
var uitGedruktOp = Date.distantPast   // laatste druk die het dicteren stopte
var verstuurd = 0
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

// De mic vanaf de Mac op rood zetten: de gewone CoreAudio-mute zet ook de mute in de mic zelf om
// (lampje rood, digitale stilte); de knop werkt daarna gewoon. De waarde die macOS onthoudt loopt
// uit de pas na een knopdruk, daarom eerst 0 en dan 1.
var gedemptDoorMac = 0
var geopendDoorMac = 0
func zetMicMute(_ aan: Bool) -> Bool {
  let sys = AudioObjectID(kAudioObjectSystemObject)
  var a = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(sys, &a, 0, nil, &size) == noErr, size > 0 else { return false }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(sys, &a, 0, nil, &size, &ids) == noErr else { return false }
  for id in ids {
    var n = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var naam: Unmanaged<CFString>?; var ns = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(id, &n, 0, nil, &ns, &naam) == noErr, let s = naam?.takeRetainedValue() as String?, s == "USB Microphone" else { continue }
    var m = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyMute, mScope: kAudioDevicePropertyScopeInput, mElement: 0)
    var v: UInt32 = aan ? 1 : 0
    return AudioObjectSetPropertyData(id, &m, 0, nil, 4, &v) == noErr
  }
  return false
}
func dempMic(reden: String) {
  _ = zetMicMute(false)
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
    // Niet dempen als er intussen gedrukt is of Claude toch weer opneemt
    if let l = laatsteDruk, Date().timeIntervalSince(l) < 1.5 { log("dempen afgebroken: net gedrukt"); return }
    if claudeNeemtOp() == true { log("dempen afgebroken: Claude neemt weer op"); return }
    let ok = zetMicMute(true)
    if ok { stand = "rood"; gedemptDoorMac += 1 }
    log("\(reden) → mic vanaf de Mac op rood gezet\(ok ? "" : " MISLUKT")")
  }
}

// Zaal: het geluid van de microfoon doorgeven aan de standaard geluidsuitgang (SQ - Audio → tafel → speakers).
// Een kleine buffer tussen de opname en de uitgang; hij houdt net genoeg voorraad om niet te haperen.
func nuNs() -> UInt64 { var tb = mach_timebase_info_data_t(); mach_timebase_info(&tb); return mach_absolute_time() * UInt64(tb.numer) / UInt64(tb.denom) }
final class Doorgeef {
  private var engine: AVAudioEngine?
  private var slot = os_unfair_lock()
  private let maat = 1 << 16
  private var ring = [Float](repeating: 0, count: 1 << 16)
  private var w = 0, r = 0            // tellers in samples, lopen door
  private var open = false, gevuld = false
  private var stuk = 480              // grootste blok dat de opname in één keer aanlevert
  private var ankerIndex = 0, ankerTijd: UInt64 = 0   // tijdstip (ns) van sample ankerIndex bij de microfoon
  private var tbN: UInt64 = 1, tbD: UInt64 = 1
  private(set) var rate: Double = 48000
  // metingen (ms): van de microfoon tot het moment dat de uitgang het sample afspeelt
  private var som = 0.0, aantal = 0, laagst = Double.infinity, hoogst = 0.0, onderlopen = 0, aankomst = 0.0, uitgang = ""

  init() { var tb = mach_timebase_info_data_t(); mach_timebase_info(&tb); tbN = UInt64(tb.numer); tbD = UInt64(tb.denom) }

  func schrijf(_ p: UnsafePointer<Float>, frames: Int, stap: Int, rate nieuw: Double, tijd: UInt64) {
    os_unfair_lock_lock(&slot); defer { os_unfair_lock_unlock(&slot) }
    if nieuw > 0 { rate = nieuw }
    guard open, frames > 0, frames < maat / 4 else { return }
    stuk = max(stuk, frames)
    ankerIndex = w; ankerTijd = tijd
    aankomst = Double(Int64(nuNs()) - Int64(tijd)) / 1e6 + Double(frames) / rate * 1000
    for i in 0..<frames { ring[(w + i) & (maat - 1)] = p[i * stap] }
    w += frames
  }

  private func lees(_ uit: UnsafeMutablePointer<Float>, _ n: Int, _ hostTijd: UInt64) {
    os_unfair_lock_lock(&slot); defer { os_unfair_lock_unlock(&slot) }
    let doel = stuk + stuk / 4
    var voorraad = w - r
    if voorraad > 3 * doel + n { r = w - doel - n; voorraad = doel + n }   // te ver achter: inhalen
    if !gevuld, voorraad >= doel + n { gevuld = true }
    guard gevuld, voorraad >= n else {
      if gevuld { gevuld = false; onderlopen += 1 }
      for i in 0..<n { uit[i] = 0 }
      return
    }
    if ankerTijd > 0 {
      let bij = Double(ankerTijd) - Double(ankerIndex - r) / rate * 1e9
      let ms = (Double(hostTijd * tbN / tbD) - bij) / 1e6
      if ms > 0, ms < 2000 { som += ms; aantal += 1; laagst = min(laagst, ms); hoogst = max(hoogst, ms) }
    }
    for i in 0..<n { uit[i] = ring[(r + i) & (maat - 1)] }
    r += n
  }

  func start(volume: Float) throws {
    stop()
    os_unfair_lock_lock(&slot)
    w = 0; r = 0; gevuld = false; ankerTijd = 0; som = 0; aantal = 0; laagst = .infinity; hoogst = 0; onderlopen = 0
    let hz = rate
    os_unfair_lock_unlock(&slot)
    let e = AVAudioEngine()
    guard let mono = AVAudioFormat(standardFormatWithSampleRate: hz, channels: 1) else { throw NSError(domain: "zaal", code: 1) }
    let bron = AVAudioSourceNode(format: mono) { [unowned self] _, ts, frames, abl -> OSStatus in
      let lijst = UnsafeMutableAudioBufferListPointer(abl)
      guard let data = lijst[0].mData else { return noErr }
      let t = ts.pointee.mFlags.contains(.hostTimeValid) ? ts.pointee.mHostTime : mach_absolute_time()
      self.lees(data.assumingMemoryBound(to: Float.self), Int(frames), t)
      return noErr
    }
    e.attach(bron)
    e.connect(bron, to: e.mainMixerNode, format: mono)
    // De tafel heeft 32 kanalen over USB; het geluid hoort op de eerste twee, net als afplay.
    let uitFormaat = e.outputNode.outputFormat(forBus: 0)
    if uitFormaat.channelCount > 2, let stereo = AVAudioFormat(standardFormatWithSampleRate: uitFormaat.sampleRate, channels: 2) {
      e.connect(e.mainMixerNode, to: e.outputNode, format: stereo)
    }
    e.mainMixerNode.outputVolume = volume
    e.prepare()
    try e.start()
    engine = e
    os_unfair_lock_lock(&slot)
    uitgang = "\(Int(uitFormaat.sampleRate)) Hz, \(uitFormaat.channelCount) kanalen"
    open = true
    os_unfair_lock_unlock(&slot)
  }

  func stop() {
    os_unfair_lock_lock(&slot); open = false; os_unfair_lock_unlock(&slot)
    engine?.stop(); engine = nil
  }

  func meting() -> [String: Any] {
    os_unfair_lock_lock(&slot); defer { os_unfair_lock_unlock(&slot) }
    let rond = { (x: Double) in (x * 10).rounded() / 10 }
    return ["vertragingMs": aantal > 0 ? rond(som / Double(aantal)) : NSNull(), "laagstMs": aantal > 0 ? rond(laagst) : NSNull(),
            "hoogstMs": aantal > 0 ? rond(hoogst) : NSNull(), "onderlopen": onderlopen, "aankomstMs": rond(aankomst),
            "blokSamples": stuk, "microfoonHz": Int(rate), "uitgang": uitgang]
  }
}
let doorgeef = Doorgeef()

var zaalOpen = false
var zaalSinds: Date? = nil
var zaalTot: Date? = nil
var zaalReden: String? = nil      // waarom hij de laatste keer dichtging
var zaalKeren = 0
var zaalTimer: Timer? = nil

// Geeft nil als hij open is, anders waarom niet.
func zaalAan(maxSeconden: Double?) -> String? {
  let duur = min(zaalMax, max(3, maxSeconden ?? zaalMax))
  if zaalOpen { return nil }
  guard verbonden else { return "microfoon niet aangesloten" }
  guard geluidActief else { return "geen geluid van de microfoon" }
  if claudeNeemtOp() == true { return "dicteren loopt" }
  do { try doorgeef.start(volume: zaalVolume) } catch { log("zaal: uitgang starten mislukt: \(error)"); return "geluidsuitgang start niet" }
  zaalOpen = true; zaalSinds = Date(); zaalTot = Date().addingTimeInterval(duur); zaalReden = nil; zaalKeren += 1
  // De microfoon zelf open zetten (blauw): eerst mute 1, dan 0.
  if gemeten() != "blauw" {
    _ = zetMicMute(true)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
      guard zaalOpen else { return }
      if zetMicMute(false) { stand = "blauw" } else { log("zaal: microfoon open zetten MISLUKT") }
    }
  }
  zaalTimer?.invalidate()
  zaalTimer = Timer.scheduledTimer(withTimeInterval: duur, repeats: false) { _ in zaalUit(reden: "vanzelf dicht na \(Int(duur)) s") }
  log("zaal: open (hooguit \(Int(duur)) s, volume \(zaalVolume))")
  return nil
}

func zaalUit(reden: String, micDicht: Bool = true) {
  guard zaalOpen else { return }
  zaalOpen = false; zaalTot = nil; zaalReden = reden
  zaalTimer?.invalidate(); zaalTimer = nil
  let m = doorgeef.meting()
  doorgeef.stop()
  log("zaal: dicht (\(reden)); vertraging \(m["vertragingMs"] ?? "-") ms, onderlopen \(m["onderlopen"] ?? 0)")
  guard micDicht else { return }
  // De microfoon zelf weer op rood: eerst mute 0, dan 1.
  _ = zetMicMute(false)
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
    if zaalOpen || claudeNeemtOp() == true { return }
    if zetMicMute(true) { stand = "rood" } else { log("zaal: microfoon op rood zetten MISLUKT") }
  }
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
  if voor == claudeID { startMacro(macroUit); uitGedruktOp = Date() } else { log("dicteren uit overgeslagen: \(voor) staat vooraan, niet Claude") }
}

func druk(bron: String) {
  let nu = Date()
  if let l = laatsteDruk, nu.timeIntervalSince(l) < debounce { return }
  laatsteDruk = nu; drukken += 1
  // Open naar de zaal: de knop van de microfoon sluit hem (de mic staat na de druk zelf op rood), geen dictaat.
  if zaalOpen {
    if bron == "mic" { stand = "rood" }
    zaalUit(reden: "knop op de microfoon", micDicht: bron != "mic"); return
  }
  // Twee keer snel drukken na het dicteren: de eerste druk heeft het dicteren gestopt, de tweede verstuurt.
  // De tweede druk zet de mic zelf weer open, dus die gaat vanaf de Mac terug op rood.
  if bron == "mic", nu.timeIntervalSince(uitGedruktOp) < dubbelBinnen {
    uitGedruktOp = Date.distantPast; verstuurd += 1
    log("dubbele druk → versturen, mic terug op rood")
    startMacro(macroVerstuur)
    _ = zetMicMute(false)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { if zetMicMute(true) { stand = "rood" } else { log("mic terug op rood MISLUKT") } }
    return
  }
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
    // Naar de zaal (alleen als die open is): het eerste kanaal, met het tijdstip van het eerste sample.
    let kanalen = max(1, Int(f.mChannelsPerFrame)); let tijd = UInt64(max(0, CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sb))) * 1e9)
    if f.mFormatFlags & kAudioFormatFlagIsFloat != 0 {
      doorgeef.schrijf(p.assumingMemoryBound(to: Float.self), frames: bytes / 4 / kanalen, stap: kanalen, rate: f.mSampleRate, tijd: tijd)
    } else {
      let x = p.assumingMemoryBound(to: Int16.self); let n = bytes / 2 / kanalen
      let fl = (0..<n).map { Float(x[$0 * kanalen]) / 32768 }
      fl.withUnsafeBufferPointer { doorgeef.schrijf($0.baseAddress!, frames: n, stap: 1, rate: f.mSampleRate, tijd: tijd) }
    }
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

// Claude gestopt met dicteren zonder knopdruk (bericht verstuurd met Enter) terwijl de mic nog blauw is:
// de mic zelf op rood zetten, zodat de volgende druk meteen weer start.
var claudeNamOp = false
var nietOpSinds: Date? = nil
Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
  guard verbonden, let op = claudeNeemtOp() else { return }
  // Dicteren gestart terwijl de microfoon open staat naar de zaal: de zaal gaat dicht, de mic blijft open.
  if op, zaalOpen { zaalUit(reden: "dicteren gestart", micDicht: false) }
  if op {
    nietOpSinds = nil
    if !claudeNamOp {
      claudeNamOp = true
      // Dicteren gestart met de muis of Cmd+D terwijl de mic rood is: de mic zelf open zetten.
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
        guard claudeNeemtOp() == true, gemeten() == "rood" else { return }
        if let l = laatsteDruk, Date().timeIntervalSince(l) < 1.0 { return }
        _ = zetMicMute(true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
          let ok = zetMicMute(false)
          if ok { stand = "blauw"; geopendDoorMac += 1 }
          log("Claude dicteert, mic was rood → mic vanaf de Mac op blauw gezet\(ok ? "" : " MISLUKT")")
        }
      }
    }
    return
  }
  guard claudeNamOp else { return }
  if nietOpSinds == nil { nietOpSinds = Date() }
  // Bij het starten flappert de opname van Claude kort; pas handelen als hij 1,2 s echt uit is
  guard Date().timeIntervalSince(nietOpSinds!) >= 1.2 else { return }
  claudeNamOp = false; nietOpSinds = nil
  if let l = laatsteDruk, Date().timeIntervalSince(l) < 2.5 { return }  // gestopt met de knop
  if gemeten() == "blauw" { dempMic(reden: "Claude gestopt zonder druk, mic nog blauw") }
}

// Meten zonder geluid: opname + uitgang op volume 0, daarna de cijfers en klaar. Geen knop, geen HTTP.
if let i = CommandLine.arguments.firstIndex(of: "--meet") {
  let duur = CommandLine.arguments.count > i + 1 ? (Double(CommandLine.arguments[i + 1]) ?? 6) : 6
  luisteraar.start()
  RunLoop.main.run(until: Date().addingTimeInterval(1.5))
  guard geluidActief else { print("meten: geen geluid van de microfoon (toestemming of niet aangesloten)"); exit(1) }
  do { try doorgeef.start(volume: 0) } catch { print("meten: uitgang start niet: \(error)"); exit(1) }
  RunLoop.main.run(until: Date().addingTimeInterval(duur))
  let m = doorgeef.meting(); doorgeef.stop(); luisteraar.stop()
  let d = (try? JSONSerialization.data(withJSONObject: m, options: [.prettyPrinted, .sortedKeys])) ?? Data()
  print(String(decoding: d, as: UTF8.self)); exit(0)
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
                          "claudeNeemtOp": claudeNeemtOp() ?? NSNull(), "gedemptDoorMac": gedemptDoorMac, "verstuurd": verstuurd, "geopendDoorMac": geopendDoorMac,
                          "gehoord": gemeten() ?? NSNull(),"geluidActief": geluidActief, "piekPerSeconde": piekLog,
                          "zaal": ["open": zaalOpen, "sinds": iso(zaalSinds), "tot": iso(zaalTot), "dichtDoor": zaalReden ?? NSNull(),
                                   "keren": zaalKeren, "maxSeconden": zaalMax, "volume": zaalVolume, "meting": doorgeef.meting()] as [String: Any]]
  return (try? JSONSerialization.data(withJSONObject: o, options: [.prettyPrinted, .sortedKeys])) ?? Data()
}
func antwoord(_ c: NWConnection, _ code: Int, _ body: Data) {
  let head = "HTTP/1.1 \(code) \(code == 200 ? "OK" : code == 409 ? "Conflict" : "Not Found")\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
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
    let delen = regel.split(separator: " "); let methode = delen.first ?? ""; let doel = delen.count > 1 ? String(delen[1]) : ""
    let pad = String(doel.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first ?? "")
    let vraag = URLComponents(string: doel)?.queryItems ?? []
    switch (methode, pad) {
    case ("GET", "/api/state"): antwoord(c, 200, stateJSON())
    case ("POST", "/api/omdraaien"): stand = (stand == "rood") ? "blauw" : "rood"; log("omgedraaid → \(stand)"); antwoord(c, 200, stateJSON())
    case ("POST", "/api/blauw"): stand = "blauw"; log("vastgezet → blauw"); antwoord(c, 200, stateJSON())
    case ("POST", "/api/rood"): stand = "rood"; log("vastgezet → rood"); antwoord(c, 200, stateJSON())
    case ("POST", "/api/druk"): druk(bron: "http"); antwoord(c, 200, stateJSON())
    case ("POST", "/api/zaal/aan"):
      if let waarom = zaalAan(maxSeconden: vraag.first(where: { $0.name == "max" })?.value.flatMap(Double.init)) {
        log("zaal: niet open: \(waarom)")
        antwoord(c, 409, (try? JSONSerialization.data(withJSONObject: ["fout": waarom, "zaal": ["open": false]])) ?? Data())
      } else { antwoord(c, 200, stateJSON()) }
    case ("POST", "/api/zaal/uit"): zaalUit(reden: "knop"); antwoord(c, 200, stateJSON())
    default: antwoord(c, 404, Data("{\"fout\":\"onbekend\"}".utf8))
    }
  }
}
listener.start(queue: .main)
log("mic-knop luistert op 127.0.0.1:\(port), start-stand \(startStand), macro's: \"\(macroAan)\" / \"\(macroUit)\"")
RunLoop.main.run()
