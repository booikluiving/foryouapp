import Foundation
import AVFoundation

// Speelt een geluidsbestand af, met dezelfde aanroep als afplay:  speel-fade [-v volume] <bestand>
// Verschil: bij SIGTERM (zo zet show control een geluid uit) zakt het geluid in FADE seconden weg
// en stopt het programma dan pas. FADE komt uit de omgeving (SPEEL_FADE_SEC, standaard 1.5).
var volume: Float = 1
var pad = ""
var args = Array(CommandLine.arguments.dropFirst())
while !args.isEmpty {
  let a = args.removeFirst()
  if a == "-v", !args.isEmpty { volume = Float(args.removeFirst()) ?? 1 } else { pad = a }
}
let fade = Double(ProcessInfo.processInfo.environment["SPEEL_FADE_SEC"] ?? "") ?? 1.5
guard !pad.isEmpty, let speler = try? AVAudioPlayer(contentsOf: URL(fileURLWithPath: pad)) else {
  FileHandle.standardError.write("speel-fade: kan bestand niet openen\n".data(using: .utf8)!)
  exit(1)
}
speler.volume = max(0, min(1, volume))
speler.prepareToPlay()
speler.play()

signal(SIGTERM, SIG_IGN)
let bron = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
var bezig = false
bron.setEventHandler {
  if bezig { exit(0) }          // tweede keer: meteen weg
  bezig = true
  speler.setVolume(0, fadeDuration: fade)
  DispatchQueue.main.asyncAfter(deadline: .now() + fade + 0.05) { exit(0) }
}
bron.resume()
// klaar met spelen = stoppen (zoals afplay)
Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in if !speler.isPlaying && !bezig { exit(0) } }
RunLoop.main.run()
