// The bridge between the phone's sensors and Pip's brain (frontend/app.js, bundled in the app).
//   JS -> native: window.webkit.messageHandlers.pip.postMessage({type: "frame"|"gps"|"talk"|"ready", ...})
//   native -> JS: window.pipNative.update(snapshot) 10x/s, window.pipNative.frame(id, base64jpeg),
//                 window.pipNative.phrase(base64pcm16k)
import MapKit
import SwiftUI
import WebKit

/// VoiceOver gestures from the design: two-finger double-tap (Magic Tap) = pause / repeat, two-finger Z = stop / back.
final class PipWKWebView: WKWebView {
    override func accessibilityPerformMagicTap() -> Bool { evaluateJavaScript("window.pipUI && window.pipUI.magicTap()", completionHandler: nil); return true }
    override func accessibilityPerformEscape() -> Bool { evaluateJavaScript("window.pipUI && window.pipUI.escape()", completionHandler: nil); return true }
}

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
        #if DEBUG
        // Screen testing in the Simulator (debug builds only): launch with SIMCTL_CHILD_PIP_DEMO_JS="<js>" to run
        // that script after the page loads, e.g. to open a screen without walking anywhere.
        if let demo = ProcessInfo.processInfo.environment["PIP_DEMO_JS"], !demo.isEmpty {
            cfg.userContentController.addUserScript(WKUserScript(source: demo, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        #endif
        let web = PipWKWebView(frame: .zero, configuration: cfg)
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 10 / 255, green: 10 / 255, blue: 9 / 255, alpha: 1)   // design token bg #0A0A09
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
        private var tick = 0

        init(sensors: Sensors) {
            self.sensors = sensors
            super.init()
            sensors.mic.onPhrase = { [weak self] pcm in
                self?.js("window.pipNative && window.pipNative.phrase('\(pcm.base64EncodedString())')")
            }
            sensors.voice.onSpoken = { [weak self] id in
                self?.js("window.pipNative && window.pipNative.spoke(\(id))")
            }
        }

        func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "ready":
                sensors.mic.start()
                timer?.invalidate()
                timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in   // 10x a second: guidance reacts fast
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
            case "read":
                // Signs and labels in view (Apple Vision on the phone): [{text, conf, u, v, h, bearing, x?, z?, d?}]
                let id = body["id"] as? Int ?? 0
                guard sensors.useAR else { js("window.pipNative && window.pipNative.pinned(\(id), [])"); break }
                sensors.ar.readText { lines in
                    let json = (try? JSONSerialization.data(withJSONObject: lines)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
                    DispatchQueue.main.async { self.js("window.pipNative && window.pipNative.pinned(\(id), \(json))") }
                }
            case "gps":
                sensors.startGPS()
            case "directions":
                // Apple Maps walking directions: the path's real shape and street names, for GPS guidance to a place
                // with no taught route. Answers {meters, seconds, points: [[lat, lon]], steps: [{text, m, lat, lon}]} or {error}.
                let id = body["id"] as? Int ?? 0
                guard let f = body["from"] as? [String: Any], let t = body["to"] as? [String: Any],
                      let fLat = f["lat"] as? Double, let fLon = f["lon"] as? Double,
                      let tLat = t["lat"] as? Double, let tLon = t["lon"] as? Double else {
                    js("window.pipNative && window.pipNative.pinned(\(id), {error: 'bad request'})"); break
                }
                let req = MKDirections.Request()
                req.source = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: fLat, longitude: fLon)))
                req.destination = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: tLat, longitude: tLon)))
                req.transportType = .walking
                MKDirections(request: req).calculate { resp, err in
                    var out: [String: Any] = ["error": err?.localizedDescription ?? "no walking route"]
                    if let r = resp?.routes.first {
                        let n = r.polyline.pointCount
                        var coords = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: n)
                        r.polyline.getCoordinates(&coords, range: NSRange(location: 0, length: n))
                        let steps: [[String: Any]] = r.steps.compactMap { s in
                            guard s.polyline.pointCount > 0 else { return nil }
                            let c = s.polyline.points()[0].coordinate
                            return ["text": s.instructions, "m": s.distance, "lat": c.latitude, "lon": c.longitude]
                        }
                        out = ["meters": r.distance, "seconds": r.expectedTravelTime,
                               "points": coords.map { [$0.latitude, $0.longitude] }, "steps": steps]
                    }
                    let json = (try? JSONSerialization.data(withJSONObject: out)).flatMap { String(data: $0, encoding: .utf8) } ?? "null"
                    DispatchQueue.main.async { self.js("window.pipNative && window.pipNative.pinned(\(id), \(json))") }
                }
            case "saveMap":
                let id = body["id"] as? Int ?? 0
                guard sensors.useAR else { js("window.pipNative && window.pipNative.pinned(\(id), false)"); break }
                sensors.ar.saveMap { ok in
                    DispatchQueue.main.async { self.js("window.pipNative && window.pipNative.pinned(\(id), \(ok))") }
                }
            case "loadMap":
                let id = body["id"] as? Int ?? 0
                let ok = sensors.useAR && sensors.ar.loadMap(frame: body["frame"] as? String ?? "")
                js("window.pipNative && window.pipNative.pinned(\(id), \(ok))")
            case "resetAR":
                if sensors.useAR { sensors.ar.restart() }
                js("window.pipNative && window.pipNative.pinned(\(body["id"] as? Int ?? 0), true)")
            case "copy":
                UIPasteboard.general.string = body["text"] as? String ?? ""
            case "haptic":   // Button States: a key gives a light haptic the instant a finger lands
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            case "log":
                if let line = body["line"] as? String { LogFile.append(line); Trip.shared.write(["log": line]) }
            case "trace":
                Trip.shared.write(["pip": body["s"] ?? NSNull()])   // what Pip is doing (mission, route, target)
            case "talk":                                // the talk bar: held (on) or let go (off)
                sensors.mic.talk(body["on"] as? Bool ?? false)
            case "tap":
                sensors.voice.tap(side: body["side"] as? String ?? "both", kind: body["kind"] as? String ?? "tap",
                                  inverted: body["inverted"] as? Bool ?? true, freq: body["freq"] as? Double)
            case "say":
                sensors.voice.say(body["text"] as? String ?? "", id: body["id"] as? Int ?? 0,
                                  server: body["server"] as? String ?? "http://100.71.218.127:8100")
            case "warm":
                sensors.voice.warm(body["texts"] as? [String] ?? [], server: body["server"] as? String ?? "http://100.71.218.127:8100")
            case "stopSay":
                sensors.voice.stop(notify: true)
            default: break
            }
        }

        private func pushState() {
            let snap = sensors.snapshot()
            guard let data = try? JSONSerialization.data(withJSONObject: snap),
                  let json = String(data: data, encoding: .utf8) else { return }
            js("window.pipNative && window.pipNative.update(\(json))")
            // Trip recorder: sensors every 0.2 s, a camera photo every 2 s, the floor map every 4 s.
            tick += 1
            if tick % 2 == 0 { Trip.shared.write(["sensors": snap]) }
            if tick % 20 == 0, let jpg = sensors.jpeg { Trip.shared.save(jpg, as: "photos", ext: "jpg") }
            if tick % 40 == 0, sensors.useAR { Trip.shared.save(sensors.ar.map.cellBytes(), as: "maps", ext: "bin") }
        }

        private func js(_ s: String) { web?.evaluateJavaScript(s, completionHandler: nil) }
    }
}

// Trip recorder: one folder per app launch in Documents/trips/<date-time>/ with
//   trace.jsonl  one JSON line per event: {"t": seconds since 1970, "sensors" | "pip" | "log": ...}
//   photos/<t>.jpg  what the camera saw;  maps/<t>.bin  the floor map (300 x 300 bytes, 10 cm cells)
// Only the newest 10 trips are kept. Copy them off the phone with tools/pull_trip.sh.
final class Trip {
    static let shared = Trip()
    private let q = DispatchQueue(label: "pip.trip")
    private let dir: URL
    private var handle: FileHandle?

    private init() {
        let fm = FileManager.default
        let root = fm.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("trips")
        let f = DateFormatter(); f.dateFormat = "yyyyMMdd-HHmmss"
        dir = root.appendingPathComponent(f.string(from: Date()))
        for sub in ["photos", "maps"] { try? fm.createDirectory(at: dir.appendingPathComponent(sub), withIntermediateDirectories: true) }
        let old = ((try? fm.contentsOfDirectory(atPath: root.path)) ?? []).sorted().dropLast(10)
        for name in old { try? fm.removeItem(at: root.appendingPathComponent(name)) }
        let trace = dir.appendingPathComponent("trace.jsonl")
        fm.createFile(atPath: trace.path, contents: nil)
        handle = try? FileHandle(forWritingTo: trace)
    }

    func write(_ event: [String: Any]) {
        var e = event; e["t"] = Date().timeIntervalSince1970
        guard JSONSerialization.isValidJSONObject(e), let data = try? JSONSerialization.data(withJSONObject: e) else { return }
        q.async { self.handle?.write(data + Data("\n".utf8)) }
    }

    func save(_ data: Data, as sub: String, ext: String) {
        let name = String(format: "%.1f.%@", Date().timeIntervalSince1970, ext)
        q.async { try? data.write(to: self.dir.appendingPathComponent(sub).appendingPathComponent(name)) }
    }
}

// Everything the page logs (what Pip heard, what it said, errors), saved so it can be copied off the phone:
//   xcrun devicectl device copy from --device <id> --domain-type appDataContainer --domain-identifier com.ycgsf.pip --source Documents/pip-log.txt --destination pip-log.txt
enum LogFile {
    static let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("pip-log.txt")

    static func append(_ line: String) {
        let data = Data((line + "\n").utf8)
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile(); h.write(data); try? h.close()
        } else {
            try? data.write(to: url)
        }
    }
}

#if DEBUG
/// Xcode canvas previews of Pip's screens (the web page built from the pen.dev design), with sample data,
/// so the screens and their animations can be seen in Xcode without walking anywhere.
private struct ScreenPreview: UIViewRepresentable {
    var js = ""
    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        if !js.isEmpty {
            cfg.userContentController.addUserScript(WKUserScript(source: "setTimeout(() => { start(); \(js) }, 200);", injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 10 / 255, green: 10 / 255, blue: 9 / 255, alpha: 1)
        if let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "frontend") {
            web.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        }
        return web
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

private struct Screen: View {   // full screen, page background color under the status bar too
    var js = ""
    var body: some View {
        ScreenPreview(js: js).ignoresSafeArea(edges: .bottom).background(Color(red: 10 / 255, green: 10 / 255, blue: 9 / 255))
    }
}

private let walkJS = """
locate = () => ({ d: 2.4, off: 4, via: "ar", r: 0.6 }); nextTurn = () => ({ d: 1.4, j: 1, turn: "left", last: false });
legGeom = () => null; skipReached = () => {}; S.tickTaught = true; N.depth = { ahead: 4.2 };
S.walk = { name: "restroom", pts: [{ ar: { x: 0, z: -2.4 } }, { ar: { x: -3, z: -2.4 } }, { ar: { x: -3, z: -8 } }], i: 0, same: true, phase: "go", onCourse: true, saidAt: Date.now(), bearAt: Date.now(), warned: 0, lostSince: null, lostSaid: false, dest: null };
"""

#Preview("01 Start") { Screen() }
#Preview("02 Listening") { Screen(js: "say('Where to?');") }
#Preview("02d Muted") { Screen(js: "document.getElementById('mute').click();") }
#Preview("03 Guiding") { Screen(js: walkJS) }
#Preview("04 Find") { Screen(js: "findCue = () => null; S.find = { target: 'door knob', move: 'up', size: 0.04, dx: 0.08, dy: -0.12, score: 0.87, seenAt: Date.now() + 3600000, lastSay: 'Up, up. A little left.', started: Date.now(), saidAt: Date.now(), gotAt: 0 };") }
#Preview("06 Teach · Orient") { Screen(js: "S.learning = { name: 'kitchen', orienting: true, crumbs: null }; S.orient = { seen: 3, dirs: [0, 1, 2], name: 'kitchen' }; let k = 3; setInterval(() => { if (k < 12) { S.orient.dirs.push(k++); S.orient.seen = S.orient.dirs.length; } }, 600);") }
#Preview("09 Route preview") { Screen(js: "const p = buildPath([{lat:32.88,lon:-117.234},{lat:32.885,lon:-117.234},{lat:32.885,lon:-117.23}], []); S.preview = { name: 'Ralphs', path: p, mins: 44, entrance: true, to: {lat:32.885,lon:-117.23}, acc: 8 };") }
#endif
