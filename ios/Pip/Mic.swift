// Always-on listening with the PHONE's microphone (opening a Bluetooth headset's mic would switch it to mono
// "call" audio and break the left/right taps). Speech is cut into phrases by loudness and handed to the brain
// as 16 kHz float32 PCM, the format the 4090's speech model takes.
import AVFoundation

final class Mic {
    var onPhrase: ((Data) -> Void)?
    var paused = false                      // set while Pip is speaking so it doesn't hear itself
    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private let out = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
    private var phrase: [Float] = []
    private var preroll: [[Float]] = []
    private var speaking = false, loudMs = 0.0, quietMs = 0.0, floor: Float = 0.01

    func start() {
        AVAudioApplication.requestRecordPermission { ok in
            guard ok else { return }
            DispatchQueue.main.async { self.run() }
        }
    }

    static func configureAudioSession() {
        let s = AVAudioSession.sharedInstance()
        // A2DP keeps Bluetooth headphones in stereo for output; input comes from the built-in mic.
        try? s.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothA2DP, .defaultToSpeaker])
        try? s.setActive(true)
        if let builtIn = s.availableInputs?.first(where: { $0.portType == .builtInMic }) { try? s.setPreferredInput(builtIn) }
    }

    private func run() {
        Self.configureAudioSession()
        let input = engine.inputNode
        let fmt = input.outputFormat(forBus: 0)
        converter = AVAudioConverter(from: fmt, to: out)
        input.installTap(onBus: 0, bufferSize: 4096, format: fmt) { [weak self] buf, _ in self?.handle(buf) }
        try? engine.start()
    }

    private func handle(_ buf: AVAudioPCMBuffer) {
        guard let pcm = to16k(buf) else { return }
        let ms = Double(pcm.count) / 16.0
        if paused { reset(); return }
        var e: Float = 0
        for v in pcm { e += v * v }
        let rms = sqrt(e / Float(max(pcm.count, 1)))
        let loud = rms > max(0.012, floor * 3)
        if !speaking { floor = floor * 0.98 + rms * 0.02 }
        if loud { loudMs += ms; quietMs = 0 } else { quietMs += ms }
        if !speaking && loudMs > 120 { speaking = true; phrase = preroll.flatMap { $0 } }
        if speaking { phrase += pcm } else {
            preroll.append(pcm); if preroll.count > 3 { preroll.removeFirst() }
            if !loud { loudMs = 0 }
        }
        if speaking && (quietMs > 700 || Double(phrase.count) / 16.0 > 9000) {
            let done = phrase
            reset()
            if done.count > 8000 {
                let data = done.withUnsafeBufferPointer { Data(buffer: $0) }
                DispatchQueue.main.async { self.onPhrase?(data) }
            }
        }
    }

    private func reset() { speaking = false; loudMs = 0; quietMs = 0; phrase = [] }

    private func to16k(_ buf: AVAudioPCMBuffer) -> [Float]? {
        guard let converter else { return nil }
        let cap = AVAudioFrameCount(Double(buf.frameLength) * 16000 / buf.format.sampleRate) + 16
        guard let o = AVAudioPCMBuffer(pcmFormat: out, frameCapacity: cap) else { return nil }
        var fed = false
        var err: NSError?
        converter.convert(to: o, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true; status.pointee = .haveData; return buf
        }
        guard err == nil, let ch = o.floatChannelData?[0] else { return nil }
        return Array(UnsafeBufferPointer(start: ch, count: Int(o.frameLength)))
    }
}
