// All phone sensors in one place, published to SwiftUI and pushed to Pip's brain (the web view) 10x a second.
import AVFoundation
import CoreLocation
import CoreMotion
import Foundation

@MainActor
final class Sensors: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var cameraMode = "starting camera…"
    @Published var depthAhead: Float?
    @Published var heading: Double = 0
    @Published var distance: Double = 0

    let camera = Camera()
    let ar = ARSense()
    let useAR = ARSense.supported          // LiDAR iPhones: ARKit (knows position in the room); others: 0.5x camera
    let mic = Mic()
    let voice: Voice
    private let motion = CMMotionManager()
    private let pedometer = CMPedometer()
    private let location = CLLocationManager()
    private(set) var gps: CLLocation?
    private var gpsOn = false
    private var mapTick = 0
    // Compass: which way the back camera points, clockwise degrees from north (nil until the magnetometer is calibrated).
    // GPS routes need it, because ARKit's heading only says how far you turned since the app started.
    private(set) var compass: Double?
    private var declination: Double = 0            // true north minus magnetic north, once GPS is on

    override init() {
        Mic.configureAudioSession()        // before anything plays: record + stereo Bluetooth output
        voice = Voice()
        super.init()
        location.delegate = self
        location.desiredAccuracy = kCLLocationAccuracyBest
        if useAR {
            cameraMode = "ARKit + LiDAR (1x)"
            ar.start()
        } else {
            camera.onMode = { [weak self] mode in Task { @MainActor in self?.cameraMode = mode } }
            camera.start()
        }
        startMotion()
    }

    // Heading of the camera's view direction on the horizontal plane, clockwise degrees. Relative (gyro +
    // gravity, corrected): good for "turn until you face it", not a compass bearing.
    private func startMotion() {
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 1.0 / 30
        let magnetic = CMMotionManager.availableAttitudeReferenceFrames().contains(.xMagneticNorthZVertical)
        motion.startDeviceMotionUpdates(using: magnetic ? .xMagneticNorthZVertical : .xArbitraryCorrectedZVertical, to: .main) { [weak self] m, _ in
            guard let self, let m else { return }
            let v = Self.rotate((0, 0, -1), by: m.attitude.quaternion)   // the back camera looks along the device's -Z axis
            var deg = -atan2(v.1, v.0) * 180 / .pi            // clockwise positive
            deg = (deg.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
            self.heading = deg
            self.compass = magnetic ? Self.compassHeading(m).map { ($0 + self.declination + 360).truncatingRemainder(dividingBy: 360) } : nil
        }
        if CMPedometer.isDistanceAvailable() {
            pedometer.startUpdates(from: Date()) { [weak self] data, _ in
                guard let d = data?.distance?.doubleValue else { return }
                Task { @MainActor in self?.distance = d }
            }
        }
    }

    /// Camera direction clockwise from magnetic north, from gravity and the magnetic field (both in device axes).
    private static func compassHeading(_ m: CMDeviceMotion) -> Double? {
        guard m.magneticField.accuracy != .uncalibrated else { return nil }
        let g = m.gravity, f = m.magneticField.field
        let up = (-g.x, -g.y, -g.z), mag = (f.x, f.y, f.z)
        func cross(_ a: (Double, Double, Double), _ b: (Double, Double, Double)) -> (Double, Double, Double) {
            (a.1 * b.2 - a.2 * b.1, a.2 * b.0 - a.0 * b.2, a.0 * b.1 - a.1 * b.0)
        }
        let east = cross(mag, up), north = cross(up, east)
        guard abs(east.2) + abs(north.2) > 1e-6 else { return nil }   // camera pointing straight down or up
        let deg = atan2(-east.2, -north.2) * 180 / .pi                // the camera looks along -Z
        return (deg + 360).truncatingRemainder(dividingBy: 360)
    }

    private static func rotate(_ v: (Double, Double, Double), by q: CMQuaternion) -> (Double, Double, Double) {
        // v' = q * v * q^-1
        let (x, y, z, w) = (q.x, q.y, q.z, q.w)
        let ix = w * v.0 + y * v.2 - z * v.1, iy = w * v.1 + z * v.0 - x * v.2
        let iz = w * v.2 + x * v.1 - y * v.0, iw = -x * v.0 - y * v.1 - z * v.2
        return (ix * w + iw * -x + iy * -z - iz * -y,
                iy * w + iw * -y + iz * -x - ix * -z,
                iz * w + iw * -z + ix * -y - iy * -x)
    }

    func startGPS() {
        guard !gpsOn else { return }
        gpsOn = true
        location.requestWhenInUseAuthorization()
        location.startUpdatingLocation()
        location.startUpdatingHeading()                 // only for true north vs magnetic north
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateHeading h: CLHeading) {
        guard h.trueHeading >= 0 else { return }
        let d = ((h.trueHeading - h.magneticHeading + 540).truncatingRemainder(dividingBy: 360)) - 180
        Task { @MainActor in self.declination = d }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in self.gps = locations.last }
    }

    /// Snapshot for the brain. Depth in meters (LiDAR), nil without LiDAR.
    var jpeg: Data? { useAR ? ar.jpeg : camera.jpeg }

    func snapshot() -> [String: Any] {
        var out: [String: Any] = ["heading": heading, "distance_m": distance, "camera": cameraMode, "mic": Double(mic.level)]
        if let c = compass { out["compass"] = c }
        if useAR, let p = ar.pose {
            // ARKit's heading and position are better than the gyro/pedometer ones: use them.
            out["heading"] = Double(p.heading); heading = Double(p.heading)
            var pose: [String: Any] = ["x": p.x, "y": p.y, "z": p.z, "tracking": ar.tracking]
            if let f = ar.map.floorY { pose["floor_y"] = f }      // phone height above the floor = y - floor_y
            out["pose"] = pose
            out["frame"] = ar.frameId; out["mapping"] = ar.mapping
        }
        if let d = useAR ? ar.depth.map({ Camera.Depth(left: $0.left, center: $0.center, right: $0.right, nearest: $0.nearest) }) : camera.depth {
            out["depth"] = ["left": d.left, "ahead": d.center, "right": d.right, "nearest": d.nearest]
            depthAhead = d.center
        }
        if useAR, mapTick % 6 == 0 {                       // the floor map's real doors and unexplored edges (~1.7/s)
            out["doors"] = ar.map.doorList().map { ["x": $0.x, "z": $0.z, "w": $0.width, "id": $0.id.uuidString] }
            out["frontiers"] = ar.map.frontiers().map { ["x": $0.x, "z": $0.z, "size": $0.size] }
            out["mapped_m2"] = Double(ar.map.knownCells) * 0.01
        }
        mapTick += 1
        if let g = gps {
            out["gps"] = ["lat": g.coordinate.latitude, "lon": g.coordinate.longitude, "acc": g.horizontalAccuracy]
        }
        return out
    }
}
