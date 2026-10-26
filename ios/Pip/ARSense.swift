// ARKit mode (iPhones with LiDAR): Apple's built-in SLAM. Pip knows WHERE the phone is in the room (meters,
// from where it started), which way it faces, how far things are (LiDAR), and can pin a landmark the vision
// model found ("the door") to a 3D spot, so it can guide to it even when it's out of view.
// ARKit only runs on the 1x camera, so this mode trades the 0.5x view for knowing position.
import ARKit
import CoreImage
import Vision

final class ARSense: NSObject, ARSessionDelegate {
    struct Pose { var x: Float; var y: Float; var z: Float; var heading: Float }   // meters from start (y = up); heading clockwise degrees
    struct Depth { var left: Float; var center: Float; var right: Float; var nearest: Float }

    static var supported: Bool { ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) }

    let session = ARSession()
    let map = SlamMap()
    private var lastMap = Date.distantPast
    private let ci = CIContext()
    private let lock = NSLock()
    private var _jpeg: Data?, _depth: Depth?, _pose: Pose?, _tracking = "starting"
    private var lastEncode = Date.distantPast, lastDepth = Date.distantPast
    private var lastFrame: ARFrame?
    // Saved routes keep a scan of the room (ARWorldMap), so after a restart Pip can recognize the room and the
    // route's points line up again (the approach Clew uses). frameId names the current coordinate frame.
    private var _frameId = UUID().uuidString, pendingFrame: String?, pendingSawLimited = false, _mapping = "none"

    var jpeg: Data? { lock.lock(); defer { lock.unlock() }; return _jpeg }
    var depth: Depth? { lock.lock(); defer { lock.unlock() }; return _depth }
    var pose: Pose? { lock.lock(); defer { lock.unlock() }; return _pose }
    var tracking: String { lock.lock(); defer { lock.unlock() }; return _tracking }
    var frameId: String { lock.lock(); defer { lock.unlock() }; return _frameId }
    var mapping: String { lock.lock(); defer { lock.unlock() }; return _mapping }

    func start() {
        session.delegate = self
        session.run(config())
    }

    private func config() -> ARWorldTrackingConfiguration {
        let cfg = ARWorldTrackingConfiguration()
        cfg.frameSemantics = [.sceneDepth, .smoothedSceneDepth]
        cfg.worldAlignment = .gravity
        cfg.planeDetection = [.horizontal, .vertical]        // floor + walls + DOORS (plane classification)
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) {
            cfg.sceneReconstruction = .meshWithClassification
        }
        return cfg
    }

    private static var mapsDir: URL {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("maps")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    /// Save the room scan for the current coordinate frame (called when a route is saved).
    func saveMap(done: @escaping (Bool) -> Void) {
        let id = frameId
        guard id != "relocalizing" else { return done(false) }
        session.getCurrentWorldMap { worldMap, _ in
            guard let worldMap,
                  let data = try? NSKeyedArchiver.archivedData(withRootObject: worldMap, requiringSecureCoding: true)
            else { return done(false) }
            done((try? data.write(to: Self.mapsDir.appendingPathComponent("\(id).arworldmap"))) != nil)
        }
    }

    /// Start fresh (new coordinate frame), e.g. after a saved room could not be recognized.
    func restart() {
        map.reset()
        lock.lock(); _frameId = UUID().uuidString; pendingFrame = nil; lock.unlock()
        session.run(config(), options: [.resetTracking, .removeExistingAnchors])
    }

    /// Restart tracking from a saved room scan. frameId becomes `frame` once ARKit recognizes the room.
    func loadMap(frame: String) -> Bool {
        guard let data = try? Data(contentsOf: Self.mapsDir.appendingPathComponent("\(frame).arworldmap")),
              let worldMap = try? NSKeyedUnarchiver.unarchivedObject(ofClass: ARWorldMap.self, from: data)
        else { return false }
        let cfg = config()
        cfg.initialWorldMap = worldMap
        map.reset()                                           // the old floor map is in the old coordinates
        lock.lock(); _frameId = "relocalizing"; pendingFrame = frame; pendingSawLimited = false; lock.unlock()
        session.run(cfg, options: [.resetTracking, .removeExistingAnchors])
        return true
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let t = frame.camera.transform
        // The camera looks along its -Z axis; project onto the floor plane for a heading.
        let fwd = -SIMD3<Float>(t.columns.2.x, t.columns.2.y, t.columns.2.z)
        var heading = atan2(fwd.x, -fwd.z) * 180 / .pi            // clockwise from the starting direction
        if heading < 0 { heading += 360 }
        let pose = Pose(x: t.columns.3.x, y: t.columns.3.y, z: t.columns.3.z, heading: heading)
        var state = "ok"
        switch frame.camera.trackingState {
        case .normal: state = "ok"
        case .limited(let why): state = "limited: \(why)"
        case .notAvailable: state = "lost"
        }
        let now = Date()
        var jpegData: Data?
        if now.timeIntervalSince(lastEncode) > 0.2 {
            lastEncode = now
            jpegData = encode(frame.capturedImage)
        }
        var d: Depth?
        if now.timeIntervalSince(lastDepth) > 0.1, let sd = frame.smoothedSceneDepth ?? frame.sceneDepth {
            lastDepth = now
            d = sectors(sd.depthMap)
        }
        if now.timeIntervalSince(lastMap) > 0.2, case .normal = frame.camera.trackingState {
            lastMap = now
            map.integrate(frame: frame)                       // grow the floor map from LiDAR
        }
        var mapping = "none"
        switch frame.worldMappingStatus {
        case .notAvailable: mapping = "none"
        case .limited: mapping = "limited"
        case .extending: mapping = "extending"
        case .mapped: mapping = "mapped"
        @unknown default: break
        }
        lock.lock()
        _pose = pose; _tracking = state; lastFrame = frame; _mapping = mapping
        if let p = pendingFrame {                             // recognized the saved room: coordinates line up again
            if state != "ok" { pendingSawLimited = true } else if pendingSawLimited { _frameId = p; pendingFrame = nil }
        }
        if let jpegData { _jpeg = jpegData }
        if let d { _depth = d }
        lock.unlock()
    }

    func session(_ session: ARSession, didAdd anchors: [ARAnchor]) { map.update(anchors: anchors) }
    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) { map.update(anchors: anchors) }
    func session(_ session: ARSession, didRemove anchors: [ARAnchor]) { map.remove(anchors: anchors) }

    private func encode(_ px: CVPixelBuffer) -> Data? {
        var img = CIImage(cvPixelBuffer: px).oriented(.right)        // sensor is landscape; phone is held upright
        let scale = 640 / img.extent.width
        img = img.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        return ci.jpegRepresentation(of: img, colorSpace: CGColorSpaceCreateDeviceRGB(),
                                     options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.7])
    }

    /// The LiDAR depth as a point cloud for the demo's 3D view: a grid of up to ~1200 points from the latest frame,
    /// in meters from the phone, portrait axes (x right, y up, z ahead).
    func cloud() -> [Float] {
        lock.lock(); let latest = lastFrame; lock.unlock()
        guard let frame = latest, let sd = frame.smoothedSceneDepth ?? frame.sceneDepth else { return [] }
        let map = sd.depthMap
        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        let w = CVPixelBufferGetWidth(map), h = CVPixelBufferGetHeight(map), row = CVPixelBufferGetBytesPerRow(map)
        guard let base = CVPixelBufferGetBaseAddress(map) else { return [] }
        let res = frame.camera.imageResolution, K = frame.camera.intrinsics
        let sx = Float(w) / Float(res.width), sy = Float(h) / Float(res.height)
        let fx = K[0][0] * sx, fy = K[1][1] * sy, cx = K[2][0] * sx, cy = K[2][1] * sy
        var out: [Float] = []
        out.reserveCapacity(3600)
        for v in stride(from: 0, to: h, by: max(1, h / 30)) {
            let p = base.advanced(by: v * row).assumingMemoryBound(to: Float32.self)
            for u in stride(from: 0, to: w, by: max(1, w / 40)) {
                let d = p[u]
                guard d.isFinite, d > 0.1, d < 6 else { continue }
                // sensor x runs portrait top->bottom, sensor y portrait right->left (see sectors below)
                out += [-(Float(v) - cy) * d / fy, -(Float(u) - cx) * d / fx, d]
            }
        }
        return out
    }

    /// Nearest distance (meters) in the portrait left / center / right thirds of the middle band.
    private func sectors(_ map: CVPixelBuffer) -> Depth {
        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        let w = CVPixelBufferGetWidth(map), h = CVPixelBufferGetHeight(map), row = CVPixelBufferGetBytesPerRow(map)
        guard let base = CVPixelBufferGetBaseAddress(map) else { return Depth(left: 8, center: 8, right: 8, nearest: 8) }
        var b: [[Float]] = [[], [], []]
        let x0 = Int(Double(w) * 0.3), x1 = Int(Double(w) * 0.8)   // sensor x = portrait top->bottom
        for y in stride(from: 0, to: h, by: 2) {                  // sensor y = portrait right->left
            let p = base.advanced(by: y * row).assumingMemoryBound(to: Float32.self)
            let third = y < h / 3 ? 2 : y < 2 * h / 3 ? 1 : 0
            for x in stride(from: x0, to: x1, by: 2) where p[x].isFinite && p[x] > 0.1 && p[x] < 8 { b[third].append(p[x]) }
        }
        func near(_ a: [Float]) -> Float { a.isEmpty ? 8 : a.sorted()[a.count / 10] }
        let l = near(b[0]), c = near(b[1]), r = near(b[2])
        return Depth(left: l, center: c, right: r, nearest: min(l, c, r))
    }

    /// Pin a point seen in the latest frame (u, v in 0..1 of the PORTRAIT image) to the room: returns its
    /// floor-plane position (x, z) in meters, using the LiDAR depth at that pixel.
    func pin(u: Float, v: Float, frame given: ARFrame? = nil) -> (x: Float, z: Float, distance: Float)? {
        lock.lock(); let frame = given ?? lastFrame; lock.unlock()
        guard let frame, let sd = frame.smoothedSceneDepth ?? frame.sceneDepth else { return nil }
        let map = sd.depthMap
        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        let w = CVPixelBufferGetWidth(map), h = CVPixelBufferGetHeight(map), row = CVPixelBufferGetBytesPerRow(map)
        guard let base = CVPixelBufferGetBaseAddress(map) else { return nil }
        // portrait (u, v) -> sensor (sx, sy): portrait x = right->left along sensor y; portrait y = sensor x
        let sx = Int(v * Float(w - 1)), sy = Int((1 - u) * Float(h - 1))
        var vals: [Float] = []
        for dy in -3...3 { for dx in -3...3 {
            let x = min(max(sx + dx, 0), w - 1), y = min(max(sy + dy, 0), h - 1)
            let d = base.advanced(by: y * row).assumingMemoryBound(to: Float32.self)[x]
            if d.isFinite && d > 0.1 { vals.append(d) }
        } }
        guard !vals.isEmpty else { return nil }
        let depth = vals.sorted()[vals.count / 2]
        // Back-project through the camera: image point in sensor pixels -> camera ray -> world point.
        let res = frame.camera.imageResolution
        let px = Float(sx) / Float(w) * Float(res.width), py = Float(sy) / Float(h) * Float(res.height)
        let K = frame.camera.intrinsics
        let ray = SIMD3<Float>((px - K[2][0]) / K[0][0], -(py - K[2][1]) / K[1][1], -1)   // camera space, -Z forward
        let pCam = SIMD4<Float>(ray * depth, 1)
        let world = frame.camera.transform * pCam
        return (world.x, world.z, depth)
    }

    /// Which way a portrait point (u, v) lies, clockwise degrees like `heading` (works beyond LiDAR's ~5 m).
    private func rayHeading(u: Float, v: Float, frame: ARFrame) -> Float {
        let res = frame.camera.imageResolution, K = frame.camera.intrinsics
        let px = v * Float(res.width), py = (1 - u) * Float(res.height)
        let w = frame.camera.transform * SIMD4<Float>((px - K[2][0]) / K[0][0], -(py - K[2][1]) / K[1][1], -1, 0)
        let h = atan2(w.x, -w.z) * 180 / .pi
        return h < 0 ? h + 360 : h
    }

    /// Read the text in view with Apple Vision, on the phone, at full camera resolution (the server only gets a
    /// 640 px photo: too small for an aisle sign across a store). Each line: text, confidence, portrait u/v,
    /// height (share of the image), the direction it's in, and x/z/d in the room when LiDAR reaches it (~5 m).
    /// All from ONE frame, so turning while it reads doesn't shift the answers.
    func readText(done: @escaping ([[String: Any]]) -> Void) {
        lock.lock(); let frame = lastFrame; lock.unlock()
        guard let frame else { return done([]) }
        DispatchQueue.global(qos: .userInitiated).async {
            let req = VNRecognizeTextRequest()
            req.recognitionLevel = .accurate
            req.usesLanguageCorrection = true
            req.minimumTextHeight = 0.012
            try? VNImageRequestHandler(cvPixelBuffer: frame.capturedImage, orientation: .right).perform([req])
            var out: [[String: Any]] = []
            for o in req.results ?? [] {
                guard let c = o.topCandidates(1).first, c.confidence >= 0.4 else { continue }
                let b = o.boundingBox                               // portrait, normalized, origin bottom-left
                let u = Float(b.midX), v = Float(1 - b.midY)
                var e: [String: Any] = ["text": c.string, "conf": Double(c.confidence), "u": Double(u), "v": Double(v),
                                        "h": Double(b.height), "bearing": Double(self.rayHeading(u: u, v: v, frame: frame))]
                if let p = self.pin(u: u, v: v, frame: frame) { e["x"] = Double(p.x); e["z"] = Double(p.z); e["d"] = Double(p.distance) }
                out.append(e)
            }
            done(out)
        }
    }
}
