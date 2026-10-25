// ARKit mode (iPhones with LiDAR): Apple's built-in SLAM. Pip knows WHERE the phone is in the room (meters,
// from where it started), which way it faces, how far things are (LiDAR), and can pin a landmark the vision
// model found ("the door") to a 3D spot, so it can guide to it even when it's out of view.
// ARKit only runs on the 1x camera, so this mode trades the 0.5x view for knowing position.
import ARKit
import CoreImage

final class ARSense: NSObject, ARSessionDelegate {
    struct Pose { var x: Float; var z: Float; var heading: Float }   // meters from start; heading clockwise degrees
    struct Depth { var left: Float; var center: Float; var right: Float; var nearest: Float }

    static var supported: Bool { ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) }

    let session = ARSession()
    private let ci = CIContext()
    private let lock = NSLock()
    private var _jpeg: Data?, _depth: Depth?, _pose: Pose?, _tracking = "starting"
    private var lastEncode = Date.distantPast, lastDepth = Date.distantPast
    private var lastFrame: ARFrame?

    var jpeg: Data? { lock.lock(); defer { lock.unlock() }; return _jpeg }
    var depth: Depth? { lock.lock(); defer { lock.unlock() }; return _depth }
    var pose: Pose? { lock.lock(); defer { lock.unlock() }; return _pose }
    var tracking: String { lock.lock(); defer { lock.unlock() }; return _tracking }

    func start() {
        let cfg = ARWorldTrackingConfiguration()
        cfg.frameSemantics = [.sceneDepth, .smoothedSceneDepth]
        cfg.worldAlignment = .gravity
        session.delegate = self
        session.run(cfg)
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let t = frame.camera.transform
        // The camera looks along its -Z axis; project onto the floor plane for a heading.
        let fwd = -SIMD3<Float>(t.columns.2.x, t.columns.2.y, t.columns.2.z)
        var heading = atan2(fwd.x, -fwd.z) * 180 / .pi            // clockwise from the starting direction
        if heading < 0 { heading += 360 }
        let pose = Pose(x: t.columns.3.x, z: t.columns.3.z, heading: heading)
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
        lock.lock()
        _pose = pose; _tracking = state; lastFrame = frame
        if let jpegData { _jpeg = jpegData }
        if let d { _depth = d }
        lock.unlock()
    }

    private func encode(_ px: CVPixelBuffer) -> Data? {
        var img = CIImage(cvPixelBuffer: px).oriented(.right)        // sensor is landscape; phone is held upright
        let scale = 640 / img.extent.width
        img = img.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        return ci.jpegRepresentation(of: img, colorSpace: CGColorSpaceCreateDeviceRGB(),
                                     options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.7])
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
    func pin(u: Float, v: Float) -> (x: Float, z: Float, distance: Float)? {
        lock.lock(); let frame = lastFrame; lock.unlock()
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
}
