// All of Pip's sound in the app goes through native audio (not the web view): if WebKit plays audio it
// switches the app's audio session to playback-only and the mic stops listening.
//   - taps: short clicks on ONE channel (left/right), swapped when the headphones are worn upside down
//   - voice: Kokoro speech from the 4090 (/tts), Apple's voice as a fallback; tells the brain when done
import AVFoundation

final class Voice: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    var onSpoken: ((Int) -> Void)?                 // speech id finished (or was stopped)
    private let engine = AVAudioEngine()
    private let taps = AVAudioPlayerNode()
    private let fmt = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
    private var player: AVAudioPlayer?
    private let synth = AVSpeechSynthesizer()
    private var currentId: Int?

    override init() {
        super.init()
        synth.delegate = self
        engine.attach(taps)
        engine.connect(taps, to: engine.mainMixerNode, format: fmt)
        try? engine.start()
        taps.play()
    }

    /// side: left | right | both. kind: tap | warn | stop | up | down | got. inverted: headphones upside down.
    func tap(side: String, kind: String, inverted: Bool, freq: Double? = nil) {
        if !engine.isRunning { try? engine.start(); taps.play() }
        let (f, dur, vol): (Double, Double, Float) = switch kind {
        case "warn": (520, 0.06, 0.55)
        case "stop": (200, 0.09, 0.7)
        case "up": (2600, 0.03, 0.45)
        case "down": (700, 0.04, 0.55)
        case "got": (1320, 0.12, 0.5)
        case "on": (880, 0.02, 0.35)                     // on course: a soft low tick in both ears
        case "key": (1500, 0.012, 0.2)                   // a key press: a soft short tick
        case "note": (freq ?? 880, 0.09, 0.4)              // progress while you turn around: notes climbing a scale
        case "think": (600, 0.03, 0.18)                  // Pip is working on your answer: a soft slow tick
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

    // Speed: Kokoro takes ~1 s per new short phrase and ~5 s for a long sentence (measured), but a phrase it has
    // made before comes back in ~0.05 s. So: speak sentence by sentence (the first one starts fast), keep every
    // short phrase on the phone (memory + disk), and make Pip's fixed phrases ahead of time (warm).
    private var cache: [String: Data] = [:]
    private var waiting: [String: [(Data?) -> Void]] = [:]
    private var parts: [String] = []
    private var server = ""
    private var serverDownUntil = Date.distantPast
    private var warmQueue: [String] = [], warming = false
    private var askedAt = Date()
    private let cacheDir: URL = {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("tts")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    /// "Turn left. Walk 2.5 meters." -> ["Turn left.", "Walk 2.5 meters."] (a dot inside a number doesn't split)
    static func sentences(_ text: String) -> [String] {
        var out: [String] = [], cur = ""
        let chars = Array(text)
        for (i, ch) in chars.enumerated() {
            cur.append(ch)
            if ".!?".contains(ch) && (i + 1 == chars.count || chars[i + 1] == " ") {
                let t = cur.trimmingCharacters(in: .whitespaces); if !t.isEmpty { out.append(t) }; cur = ""
            }
        }
        let t = cur.trimmingCharacters(in: .whitespaces); if !t.isEmpty { out.append(t) }
        return out
    }

    private func file(_ text: String) -> URL {
        let safe = text.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? String($0) : "_" }.joined()
        return cacheDir.appendingPathComponent(String(safe.prefix(80)) + "-\(text.count).wav")
    }

    /// The WAV for one sentence: from memory, the phone's disk, or the server (nil if it fails).
    private func audio(_ text: String, done: @escaping (Data?, Bool) -> Void) {
        if let d = cache[text] { return done(d, true) }
        let keep = text.count < 60                          // the server keeps the same ones
        if keep, let d = try? Data(contentsOf: file(text)) { cache[text] = d; return done(d, true) }
        if Date() < serverDownUntil { return done(nil, false) }   // don't wait 8 s again for a server that just failed
        if waiting[text] != nil { waiting[text]!.append({ done($0, false) }); return }
        waiting[text] = [{ done($0, false) }]
        var allowed = CharacterSet.alphanumerics; allowed.insert(charactersIn: "-._~")
        let q = text.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        guard let url = URL(string: "\(server)/tts?text=\(q)") else { waiting[text] = nil; return done(nil, false) }
        var req = URLRequest(url: url); req.timeoutInterval = 8
        URLSession.shared.dataTask(with: req) { [weak self] data, resp, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                let ok = (resp as? HTTPURLResponse)?.statusCode == 200 && (data?.count ?? 0) > 100
                if ok, let data, keep { self.cache[text] = data; try? data.write(to: self.file(text)) }
                if !ok { self.serverDownUntil = Date().addingTimeInterval(20) }
                for cb in self.waiting.removeValue(forKey: text) ?? [] { cb(ok ? data : nil) }
            }
        }.resume()
    }

    func say(_ text: String, id: Int, server: String) {
        stop(notify: true)
        currentId = id; self.server = server
        parts = Self.sentences(text)
        playNext(id)
    }

    private func playNext(_ id: Int) {
        guard currentId == id else { return }
        guard !parts.isEmpty else { return finished(id) }
        let part = parts.removeFirst()
        askedAt = Date()
        audio(part) { [weak self] data, cached in
            guard let self, self.currentId == id else { return }
            let ms = Int(Date().timeIntervalSince(self.askedAt) * 1000)
            Trip.shared.write(["voice": ["text": part, "wait_ms": ms, "cached": cached, "ok": data != nil]])
            if let data, let p = try? AVAudioPlayer(data: data) {
                self.player = p; p.delegate = self; p.play()
                if let next = self.parts.first { self.audio(next) { _, _ in } }   // make the next sentence while this one plays
            } else { self.fallback(part) }
        }
    }

    /// Make these phrases ahead of time, one at a time, pausing while Pip talks.
    func warm(_ texts: [String], server: String) {
        self.server = server
        let new = texts.flatMap(Self.sentences).filter { $0.count < 60 && cache[$0] == nil && !warmQueue.contains($0) }
        warmQueue.append(contentsOf: new)
        if !warming { warmNext() }
    }

    private func warmNext() {
        guard !warmQueue.isEmpty else { warming = false; return }
        warming = true
        if currentId != nil {                                // talking: try again in a moment
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.warmNext() }
            return
        }
        let t = warmQueue.removeFirst()
        audio(t) { [weak self] _, _ in self?.warmNext() }
    }

    private func fallback(_ text: String) {
        let u = AVSpeechUtterance(string: text)
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 1.05
        synth.speak(u)
    }

    func stop(notify: Bool) {
        parts = []
        player?.stop(); player = nil
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        if notify, let id = currentId { finished(id) }
    }

    private func finished(_ id: Int) {
        guard currentId == id else { return }
        currentId = nil
        onSpoken?(id)
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) { if let id = currentId { playNext(id) } }
    func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { if let id = currentId { playNext(id) } }
}
