// For_You mic-versturen: wacht tot de gedicteerde tekst in het tekstvak van Claude staat en drukt dan Enter.
// Wordt gestart door de Keyboard Maestro-macro "For_You mic: versturen" (KM heeft Toegankelijkheid; de helper niet).
// Leest alleen de lengte van de tekst, nooit de inhoud. Log: ~/Library/Logs/ForYou/mic-versturen.log
//   mic-versturen            wachten tot de tekst stilstaat, dan Enter
//   mic-versturen kijk [s]   alleen meekijken en de lengte loggen (standaard 60 s), geen Enter
import AppKit
import ApplicationServices

let claudeID = "com.anthropic.claudefordesktop"
let rustig = 1.0        // zo lang moet de tekst onveranderd zijn
let maxWachten = 20.0   // daarna opgeven zonder Enter
let logPad = NSHomeDirectory() + "/Library/Logs/ForYou/mic-versturen.log"

func log(_ s: String) {
  let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
  let regel = "\(f.string(from: Date())) \(s)\n"
  if let h = FileHandle(forWritingAtPath: logPad) { h.seekToEndOfFile(); h.write(regel.data(using: .utf8)!); h.closeFile() }
  else { try? regel.write(toFile: logPad, atomically: true, encoding: .utf8) }
}
func attr(_ e: AXUIElement, _ n: String) -> AnyObject? {
  var v: AnyObject?; return AXUIElementCopyAttributeValue(e, n as CFString, &v) == .success ? v : nil
}

guard AXIsProcessTrusted() else { log("geen Toegankelijkheid: niets gedaan"); exit(1) }
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: claudeID).first else { log("Claude draait niet"); exit(1) }
let ax = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetAttributeValue(ax, "AXManualAccessibility" as CFString, kCFBooleanTrue)

// Lengte van de tekst in het element met focus; nil als dat geen tekstvak is.
func tekstLengte() -> (Int, String)? {
  guard let f = attr(ax, kAXFocusedUIElementAttribute as String) else { return nil }
  let e = f as! AXUIElement
  let rol = (attr(e, "AXRole") as? String) ?? "?"
  if let v = attr(e, "AXValue") as? String { return (v.count, rol) }
  if let n = attr(e, "AXNumberOfCharacters") as? Int { return (n, rol) }
  return nil
}
// Alle tekstvelden in de vensters van Claude (rol en lengte), voor de meekijkstand.
func tekstvelden() -> [(Int, String)] {
  var uit: [(Int, String)] = []; var teller = 0
  func loop(_ e: AXUIElement, _ diepte: Int) {
    teller += 1; if teller > 4000 || diepte > 60 { return }
    let rol = (attr(e, "AXRole") as? String) ?? ""
    if rol == "AXTextArea" || rol == "AXTextField" || rol == "AXComboBox" {
      let n = (attr(e, "AXValue") as? String)?.count ?? (attr(e, "AXNumberOfCharacters") as? Int) ?? -1
      let f = (attr(e, "AXFocused") as? Bool) == true ? "*" : ""
      uit.append((n, rol + f))
    }
    for k in (attr(e, "AXChildren") as? [AXUIElement]) ?? [] { loop(k, diepte + 1) }
  }
  for w in (attr(ax, "AXWindows") as? [AXUIElement]) ?? [] { loop(w, 0) }
  return uit
}
func claudeVooraan() -> Bool { NSWorkspace.shared.frontmostApplication?.bundleIdentifier == claudeID }

let args = CommandLine.arguments
if args.count > 1, args[1] == "kijk" {
  let duur = args.count > 2 ? Double(args[2]) ?? 60 : 60
  log("kijk: start, \(Int(duur)) s")
  let start = Date(); var vorige = "-"
  while Date().timeIntervalSince(start) < duur {
    var nu = tekstLengte().map { "focus \($0.1) lengte \($0.0)" } ?? "focus geen tekstvak"
    nu += " | velden: " + tekstvelden().map { "\($0.1):\($0.0)" }.joined(separator: " ")
    if nu != vorige { log("kijk: \(nu)\(claudeVooraan() ? "" : " (Claude niet vooraan)")"); vorige = nu }
    usleep(100_000)
  }
  log("kijk: klaar"); exit(0)
}

// Het tekstvak is leeg bij lengte 1 (alleen een regeleinde). De gedicteerde tekst komt in één keer binnen
// zodra Claude stopt met opnemen (gemeten 12 nov). Enter pas als er tekst staat en die 1 s niet meer verandert.
func veld() -> (lengte: Int, focus: Bool)? {
  guard let v = tekstvelden().first(where: { $0.1.hasPrefix("AXTextArea") }) else { return nil }
  return (v.0, v.1.hasSuffix("*"))
}
let start = Date(); var laatste = -1; var sinds = Date(); var gezien = false
while Date().timeIntervalSince(start) < maxWachten {
  guard claudeVooraan() else { log("Claude staat niet vooraan: geen Enter"); exit(1) }
  if let v = veld() {
    gezien = true
    if v.lengte != laatste { laatste = v.lengte; sinds = Date() }
    else if v.lengte > 1, Date().timeIntervalSince(sinds) >= rustig {
      guard v.focus else { log("tekst staat er (lengte \(v.lengte)) maar het tekstvak heeft geen focus: geen Enter"); exit(1) }
      let src = CGEventSource(stateID: .hidSystemState)
      // Even wachten rond de toets: een programma dat meteen na het versturen stopt, kan de toets kwijtraken.
      CGEvent(keyboardEventSource: src, virtualKey: 36, keyDown: true)?.post(tap: .cghidEventTap)
      usleep(40_000)
      CGEvent(keyboardEventSource: src, virtualKey: 36, keyDown: false)?.post(tap: .cghidEventTap)
      usleep(300_000)
      log("na Enter: lengte \(veld()?.lengte ?? -1)")
      log(String(format: "Enter na %.1f s, lengte %d", Date().timeIntervalSince(start), v.lengte)); exit(0)
    }
  }
  usleep(100_000)
}
log(gezien ? "geen Enter: tekstvak bleef leeg of veranderen (lengte \(laatste))" : "geen Enter: tekstvak niet gevonden"); exit(1)
