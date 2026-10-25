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
        let opts: AVAudioSession.CategoryOptions = [.allowBluetoothA2DP, .defaultToSpeaker]
        // Only touch the session if something else changed it (changing it ourselves fires route-change
        // notifications, which would make the restart logic loop).
        if s.category != .playAndRecord || s.categoryOptions != opts {
            // A2DP keeps Bluetooth headphones in stereo for output; input comes from the built-in mic.
            try? s.setCategory(.playAndRecord, mode: .default, options: opts)
        }
        try? s.setActive(true)
        if s.preferredInput?.portType != .builtInMic,
           let builtIn = s.availableInputs?.first(where: { $0.portType == .builtInMic }) { try? s.setPreferredInput(builtIn) }
    }

    private var lastRun = Date.distantPast

    private var observing = false

    private func run() {
        lastRun = Date()
        Self.configureAudioSession()
        if !observing {
            observing = true
            let nc = NotificationCenter.default
            for name in [AVAudioSession.interruptionNotification, AVAudioSession.routeChangeNotification,
                         AVAudioSession.mediaServicesWereResetNotification, Notification.Name.AVAudioEngineConfigurationChange] {
                nc.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                    guard let self, Date().timeIntervalSince(self.lastRun) > 1.5 else { return }   // our own setup
                    self.restartSoon()
                }
            }
            Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in   // watchdog
                guard let self, !self.engine.isRunning else { return }
                self.restartSoon()
            }
        }
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

    private var restarting = false
    /// iOS stops the engine on route changes, interruptions, or when something else changes the audio
    /// session. Re-assert the session and start listening again.
    private func restartSoon() {
        guard !restarting else { return }
        restarting = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            guard let self else { return }
            self.engine.stop()
            self.engine.inputNode.removeTap(onBus: 0)
            self.restarting = false
            self.run()
        }
    }

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
