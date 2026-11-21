import Foundation
import AVFoundation

// Speelt een geluidsbestand af, met dezelfde aanroep als afplay:  speel-fade [-v volume] [--lus] <bestand>
// --lus: het bestand herhaalt zonder naad tot het programma wordt gestopt.
// Verschil: bij SIGTERM (zo zet show control een geluid uit) zakt het geluid in FADE seconden weg
// en stopt het programma dan pas. FADE komt uit de omgeving (SPEEL_FADE_SEC, standaard 1.5).
// --in <seconden>: het geluid komt in zoveel seconden op in plaats van meteen op volle sterkte.
// SIGUSR1: uitzetten met een eigen fadetijd; die staat als getal in /tmp/speel-fade-<pid>.
var volume: Float = 1
var pad = ""
var lus = false
var opkomst: Double = 0
var args = Array(CommandLine.arguments.dropFirst())
while !args.isEmpty {
  let a = args.removeFirst()
  if a == "-v", !args.isEmpty { volume = Float(args.removeFirst()) ?? 1 } else if a == "--lus" { lus = true } else if a == "--in", !args.isEmpty { opkomst = max(0, Double(args.removeFirst()) ?? 0) } else { pad = a }
}
let fade = Double(ProcessInfo.processInfo.environment["SPEEL_FADE_SEC"] ?? "") ?? 1.5
guard !pad.isEmpty, let speler = try? AVAudioPlayer(contentsOf: URL(fileURLWithPath: pad)) else {
  FileHandle.standardError.write("speel-fade: kan bestand niet openen\n".data(using: .utf8)!)
  exit(1)
}
let doel = max(0, min(1, volume))
speler.volume = opkomst > 0 ? 0 : doel
if lus { speler.numberOfLoops = -1 }
speler.prepareToPlay()
speler.play()
if opkomst > 0 { speler.setVolume(doel, fadeDuration: opkomst) }

signal(SIGTERM, SIG_IGN)
let bron = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
var bezig = false
func zakWeg(_ duur: Double) {
  if bezig { exit(0) }          // tweede keer: meteen weg
  bezig = true
  speler.setVolume(0, fadeDuration: duur)
  DispatchQueue.main.asyncAfter(deadline: .now() + duur + 0.05) { exit(0) }
}
bron.setEventHandler { zakWeg(fade) }
bron.resume()
signal(SIGUSR1, SIG_IGN)
let lang = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
lang.setEventHandler {
  let bestand = "/tmp/speel-fade-\(getpid())"
  let tekst = (try? String(contentsOfFile: bestand, encoding: .utf8)) ?? ""
  try? FileManager.default.removeItem(atPath: bestand)
  let duur = Double(tekst.trimmingCharacters(in: .whitespacesAndNewlines)) ?? fade
  zakWeg(max(0.05, min(30, duur)))
}
lang.resume()
// klaar met spelen = stoppen (zoals afplay)
Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in if !speler.isPlaying && !bezig { exit(0) } }
RunLoop.main.run()
