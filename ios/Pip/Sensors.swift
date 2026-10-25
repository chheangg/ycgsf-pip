// All phone sensors in one place, published to SwiftUI and pushed to Pip's brain (the web view) ~5x a second.
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
    private let motion = CMMotionManager()
    private let pedometer = CMPedometer()
    private let location = CLLocationManager()
    private(set) var gps: CLLocation?
    private var gpsOn = false
    private var walkedOffset: Double = 0

    override init() {
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
        motion.startDeviceMotionUpdates(using: .xArbitraryCorrectedZVertical, to: .main) { [weak self] m, _ in
            guard let self, let q = m?.attitude.quaternion else { return }
            let v = Self.rotate((0, 0, -1), by: q)            // the back camera looks along the device's -Z axis
            var deg = -atan2(v.1, v.0) * 180 / .pi            // clockwise positive
            deg = (deg.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
            self.heading = deg
        }
        if CMPedometer.isDistanceAvailable() {
            pedometer.startUpdates(from: Date()) { [weak self] data, _ in
                guard let d = data?.distance?.doubleValue else { return }
                Task { @MainActor in self?.distance = d }
            }
        }
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
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in self.gps = locations.last }
    }

    /// Snapshot for the brain. Depth in meters (LiDAR), nil without LiDAR.
    var jpeg: Data? { useAR ? ar.jpeg : camera.jpeg }

    func snapshot() -> [String: Any] {
        var out: [String: Any] = ["heading": heading, "distance_m": distance, "camera": cameraMode]
        if useAR, let p = ar.pose {
            // ARKit's heading and position are better than the gyro/pedometer ones: use them.
            out["heading"] = Double(p.heading); heading = Double(p.heading)
            out["pose"] = ["x": p.x, "z": p.z, "tracking": ar.tracking]
        }
        if let d = useAR ? ar.depth.map({ Camera.Depth(left: $0.left, center: $0.center, right: $0.right, nearest: $0.nearest) }) : camera.depth {
            out["depth"] = ["left": d.left, "ahead": d.center, "right": d.right, "nearest": d.nearest]
            depthAhead = d.center
        }
        if let g = gps {
            out["gps"] = ["lat": g.coordinate.latitude, "lon": g.coordinate.longitude, "acc": g.horizontalAccuracy]
        }
        return out
    }
}
