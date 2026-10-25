// All of Pip's sound in the app goes through native audio (not the web view): if WebKit plays audio it
// switches the app's audio session to playback-only and the mic stops listening.
//   - taps: short clicks on ONE channel (left/right), swapped when the headphones are worn upside down
//   - voice: Kokoro speech from the 4090 (/tts), Apple's voice as a fallback; tells the brain when done
import AVFoundation

final class Voice: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    var onSpoken: ((Int) -> Void)?                 // speech id finished (or was stopped)
    var onSpeaking: ((Bool) -> Void)?
    private let engine = AVAudioEngine()
    private let taps = AVAudioPlayerNode()
    private let fmt = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
    private var player: AVAudioPlayer?
    private let synth = AVSpeechSynthesizer()
    private var currentId: Int?
    private var task: URLSessionDataTask?

    override init() {
        super.init()
        synth.delegate = self
        engine.attach(taps)
        engine.connect(taps, to: engine.mainMixerNode, format: fmt)
        try? engine.start()
        taps.play()
    }

    /// side: left | right | both. kind: tap | warn | stop | up | down | got. inverted: headphones upside down.
    func tap(side: String, kind: String, inverted: Bool) {
        if !engine.isRunning { try? engine.start(); taps.play() }
        let (f, dur, vol): (Double, Double, Float) = switch kind {
        case "warn": (520, 0.06, 0.55)
        case "stop": (200, 0.09, 0.7)
        case "up": (2600, 0.03, 0.45)
        case "down": (700, 0.04, 0.55)
        case "got": (1320, 0.12, 0.5)
        default: (1800, 0.022, 0.45)
        }
        let n = AVAudioFrameCount(44100 * (dur + 0.02))
        guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: n), let ch = buf.floatChannelData else { return }
        buf.frameLength = n
        var left = side == "left" || side == "both", right = side == "right" || side == "both"
        if inverted && side != "both" { swap(&left, &right) }   // the "R" cup sits on the left ear
        for i in 0..<Int(n) {
            let t = Double(i) / 44100
            let env = Float(t < dur ? exp(-5 * t / dur) : 0)
            let s = Float(sin(2 * .pi * f * t)) * env * vol
            ch[0][i] = left ? s : 0
            ch[1][i] = right ? s : 0
        }
        taps.scheduleBuffer(buf, at: nil, options: [], completionHandler: nil)
    }

    func say(_ text: String, id: Int, server: String) {
        stop(notify: true)
        currentId = id
        onSpeaking?(true)
        let q = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        guard let url = URL(string: "\(server)/tts?text=\(q)") else { return fallback(text) }
        var req = URLRequest(url: url); req.timeoutInterval = 6
        task = URLSession.shared.dataTask(with: req) { [weak self] data, resp, _ in
            DispatchQueue.main.async {
                guard let self, self.currentId == id else { return }
                if let data, (resp as? HTTPURLResponse)?.statusCode == 200, let p = try? AVAudioPlayer(data: data) {
                    self.player = p; p.delegate = self; p.play()
                } else { self.fallback(text) }
            }
        }
        task?.resume()
    }

    private func fallback(_ text: String) {
        let u = AVSpeechUtterance(string: text)
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 1.05
        synth.speak(u)
    }

    func stop(notify: Bool) {
        task?.cancel(); task = nil
        player?.stop(); player = nil
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        if notify, let id = currentId { finished(id) }
    }

    private func finished(_ id: Int) {
        guard currentId == id else { return }
        currentId = nil
        onSpeaking?(false)
        onSpoken?(id)
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) { if let id = currentId { finished(id) } }
    func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { if let id = currentId { finished(id) } }
}
