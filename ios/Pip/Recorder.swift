// Records the app's screen and sound (Pip's voice and taps) for demos, then saves the video to Photos.
// The microphone stays out of the recording: it is already busy listening, and asking ReplayKit for it too would
// change the audio session under the mic.
import ReplayKit
import UIKit

final class Recorder {
    private let rec = RPScreenRecorder.shared()
    var isRecording: Bool { rec.isRecording }

    func start(_ done: @escaping (String?) -> Void) {
        guard !rec.isRecording else { return done(nil) }
        rec.isMicrophoneEnabled = false
        rec.startRecording { err in DispatchQueue.main.async { done(err?.localizedDescription) } }
    }

    /// Stops and saves to Photos. done(nil) when saved, else what went wrong.
    func stop(_ done: @escaping (String?) -> Void) {
        guard rec.isRecording else { return done("not recording") }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("pip-demo-\(Int(Date().timeIntervalSince1970)).mp4")
        rec.stopRecording(withOutput: url) { err in
            if let err { return DispatchQueue.main.async { done(err.localizedDescription) } }
            Saver.save(url, done)
        }
    }
}

/// UISaveVideoAtPathToSavedPhotosAlbum reports back through an Objective-C selector, so it needs an NSObject.
private final class Saver: NSObject {
    private static var pending: [Saver] = []
    private let done: (String?) -> Void
    private init(_ done: @escaping (String?) -> Void) { self.done = done }

    static func save(_ url: URL, _ done: @escaping (String?) -> Void) {
        let s = Saver(done); pending.append(s)
        DispatchQueue.main.async { UISaveVideoAtPathToSavedPhotosAlbum(url.path, s, #selector(Saver.saved(_:error:context:)), nil) }
    }

    @objc private func saved(_ path: String, error: Error?, context: UnsafeMutableRawPointer?) {
        done(error?.localizedDescription)
        try? FileManager.default.removeItem(atPath: path)   // the copy in Photos is the one that matters
        Saver.pending.removeAll { $0 === self }
    }
}
