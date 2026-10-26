// Hold-to-talk with the PHONE's microphone (opening a Bluetooth headset's mic would switch it to mono
// "call" audio and break the left/right taps). While the talk bar is held, the mic records; on release the
// recording goes to the brain as 16 kHz float32 PCM, the format the 4090's speech model takes.
import AVFoundation

final class Mic {
    var onPhrase: ((Data) -> Void)?
    var level: Float = 0                    // loudness of the last buffer while held (0..1), drives the voice wave on screen
    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private let out = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
    private var phrase: [Float] = []
    private var holding = false
    private let lock = NSLock()             // talk() runs on the main thread, handle() on the audio thread
    private static let maxSamples = 16000 * 30   // 30 s at 16 kHz: longer holds keep only the first 30 s

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
        try? s.setAllowHapticsAndSystemSoundsDuringRecording(true)   // iOS mutes haptics while the mic records: the turn buzz never played
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

    /// The talk bar went down (on) or up (off). On release, anything longer than a quarter second is sent.
    func talk(_ on: Bool) {
        lock.lock()
        let done = holding && !on ? phrase : []
        holding = on; phrase = []
        lock.unlock()
        if !on { level = 0 }
        if done.count > 4000 { onPhrase?(done.withUnsafeBufferPointer { Data(buffer: $0) }) }
    }

    private func handle(_ buf: AVAudioPCMBuffer) {
        guard let pcm = to16k(buf) else { return }
        lock.lock(); defer { lock.unlock() }
        guard holding else { return }
        var e: Float = 0
        for v in pcm { e += v * v }
        level = sqrt(e / Float(max(pcm.count, 1)))
        if phrase.count < Self.maxSamples { phrase += pcm }
    }

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
