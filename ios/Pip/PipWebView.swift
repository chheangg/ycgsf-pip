// The bridge between the phone's sensors and Pip's brain (frontend/app.js, bundled in the app).
//   JS -> native: window.webkit.messageHandlers.pip.postMessage({type: "frame"|"gps"|"speaking"|"ready", ...})
//   native -> JS: window.pipNative.update(snapshot) ~5x/s, window.pipNative.frame(id, base64jpeg),
//                 window.pipNative.phrase(base64pcm16k)
import SwiftUI
import WebKit

struct PipWebView: UIViewRepresentable {
    let sensors: Sensors

    func makeCoordinator() -> Bridge { Bridge(sensors: sensors) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.userContentController.add(context.coordinator, name: "pip")
        // Tell the page it's running inside the app, before any of its scripts run.
        cfg.userContentController.addUserScript(WKUserScript(source: "window.PIP_NATIVE = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { web.isInspectable = true }   // Safari > Develop for debugging
        context.coordinator.web = web
        if let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "frontend") {
            web.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        }
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    @MainActor
    final class Bridge: NSObject, WKScriptMessageHandler {
        let sensors: Sensors
        weak var web: WKWebView?
        private var timer: Timer?

        init(sensors: Sensors) {
            self.sensors = sensors
            super.init()
            sensors.mic.onPhrase = { [weak self] pcm in
                self?.js("window.pipNative && window.pipNative.phrase('\(pcm.base64EncodedString())')")
            }
        }

        func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "ready":
                sensors.mic.start()
                timer?.invalidate()
                timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
                    Task { @MainActor in self?.pushState() }
                }
            case "frame":
                let id = body["id"] as? Int ?? 0
                let b64 = sensors.jpeg?.base64EncodedString() ?? ""
                js("window.pipNative && window.pipNative.frame(\(id), '\(b64)')")
            case "pin":
                // Pin a detection (portrait u, v in 0..1) to a spot in the room, via LiDAR depth (ARKit mode only).
                let id = body["id"] as? Int ?? 0
                if sensors.useAR, let u = body["u"] as? Double, let v = body["v"] as? Double, let p = sensors.ar.pin(u: Float(u), v: Float(v)) {
                    js("window.pipNative && window.pipNative.pinned(\(id), {x: \(p.x), z: \(p.z), d: \(p.distance)})")
                } else {
                    js("window.pipNative && window.pipNative.pinned(\(id), null)")
                }
            case "path":
                // A* on the floor map from where the phone is to (x, z): waypoints in meters.
                let id = body["id"] as? Int ?? 0
                guard sensors.useAR, let p = sensors.ar.pose, let x = body["x"] as? Double, let z = body["z"] as? Double else {
                    js("window.pipNative && window.pipNative.pinned(\(id), null)"); break
                }
                let map = sensors.ar.map
                DispatchQueue.global(qos: .userInitiated).async {
                    let pts = map.path(from: SIMD2(p.x, p.z), to: SIMD2(Float(x), Float(z)))
                    let json = pts.map { "[" + $0.map { "{\"x\":\($0.x),\"z\":\($0.y)}" }.joined(separator: ",") + "]" } ?? "null"
                    DispatchQueue.main.async { self.js("window.pipNative && window.pipNative.pinned(\(id), \(json))") }
                }
            case "gps":
                sensors.startGPS()
            case "speaking":
                sensors.mic.paused = body["on"] as? Bool ?? false
            default: break
            }
        }

        private func pushState() {
            guard let data = try? JSONSerialization.data(withJSONObject: sensors.snapshot()),
                  let json = String(data: data, encoding: .utf8) else { return }
            js("window.pipNative && window.pipNative.update(\(json))")
        }

        private func js(_ s: String) { web?.evaluateJavaScript(s, completionHandler: nil) }
    }
}
