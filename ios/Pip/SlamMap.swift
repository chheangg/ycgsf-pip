// A live floor map from ARKit + LiDAR, so navigation decisions come from geometry, not guesses.
//   - occupancy grid (10 cm cells, 30 x 30 m around the start): unknown / free / occupied
//   - doors: ARKit plane classification says "door" (a real surface in 3D, not a picture of one)
//   - frontiers: edges between known free space and unexplored space (classic robot exploration)
//   - A* path around obstacles to any target
import ARKit
import simd

final class SlamMap {
    static let res: Float = 0.1
    static let n = 300                                   // 30 m x 30 m, start in the middle
    enum Cell: UInt8 { case unknown = 0, free = 1, occupied = 2 }

    struct Door { var x: Float; var z: Float; var width: Float; var id: UUID }
    struct Frontier { var x: Float; var z: Float; var size: Int }

    private var cells = [UInt8](repeating: 0, count: SlamMap.n * SlamMap.n)
    private var hits = [UInt8](repeating: 0, count: SlamMap.n * SlamMap.n)   // obstacle evidence: +2 per sighting, -1 per floor sighting
    private var walked = [Bool](repeating: false, count: SlamMap.n * SlamMap.n)  // where you walked: never an obstacle
    static let occupiedAt: UInt8 = 4
    private(set) var doors: [UUID: Door] = [:]
    private(set) var floorY: Float?
    private let lock = NSLock()

    // MARK: grid helpers
    private func idx(_ x: Float, _ z: Float) -> Int? {
        let i = Int((x / Self.res).rounded()) + Self.n / 2, j = Int((z / Self.res).rounded()) + Self.n / 2
        return (0..<Self.n).contains(i) && (0..<Self.n).contains(j) ? j * Self.n + i : nil
    }
    private func world(_ k: Int) -> SIMD2<Float> {
        SIMD2(Float(k % Self.n - Self.n / 2) * Self.res, Float(k / Self.n - Self.n / 2) * Self.res)
    }

    func reset() {
        lock.lock(); defer { lock.unlock() }
        cells = [UInt8](repeating: 0, count: Self.n * Self.n); hits = cells; doors = [:]; floorY = nil
        walked = [Bool](repeating: false, count: Self.n * Self.n)
    }

    // MARK: updates
    func update(anchors: [ARAnchor]) {
        lock.lock(); defer { lock.unlock() }
        for case let p as ARPlaneAnchor in anchors {
            if p.classification == .floor {
                let y = p.transform.columns.3.y
                floorY = min(floorY ?? y, y)
            }
            if p.classification == .door {
                let c = p.transform * SIMD4<Float>(p.center, 1)
                doors[p.identifier] = Door(x: c.x, z: c.z, width: p.planeExtent.width, id: p.identifier)
            }
        }
    }

    func remove(anchors: [ARAnchor]) {
        lock.lock(); defer { lock.unlock() }
        for a in anchors { doors[a.identifier] = nil }
    }

    /// Integrate one LiDAR depth frame: hit points between knee and head height are obstacles, the space
    /// between the camera and each hit is free.
    /// Trip data (2026-10-25) showed the old rule (2 sightings = blocked forever) blocked 18 of the 89 cells the user
    /// actually walked through and grew the blocked area from 10 to 39 m2. Now obstacles need repeated sightings,
    /// fade when the floor is seen there instead, and the cells you walk through (phone held up) stay free.
    func integrate(frame: ARFrame) {
        guard let sd = frame.smoothedSceneDepth ?? frame.sceneDepth else { return }
        let map = sd.depthMap
        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        let w = CVPixelBufferGetWidth(map), h = CVPixelBufferGetHeight(map), row = CVPixelBufferGetBytesPerRow(map)
        guard let base = CVPixelBufferGetBaseAddress(map) else { return }
        let res = frame.camera.imageResolution
        let sx = Float(w) / Float(res.width), sy = Float(h) / Float(res.height)
        let K = frame.camera.intrinsics
        let fx = K[0][0] * sx, fy = K[1][1] * sy, cx = K[2][0] * sx, cy = K[2][1] * sy
        let T = frame.camera.transform
        let cam = SIMD3<Float>(T.columns.3.x, T.columns.3.y, T.columns.3.z)
        lock.lock(); defer { lock.unlock() }
        let floor = floorY ?? (cam.y - 1.35)              // until a floor plane is found: phone ~1.35 m up
        for v in stride(from: 0, to: h, by: 6) {
            let p = base.advanced(by: v * row).assumingMemoryBound(to: Float32.self)
            for u in stride(from: 0, to: w, by: 6) {
                let d = p[u]
                guard d.isFinite, d > 0.2, d < 5 else { continue }
                let pc = SIMD4<Float>((Float(u) - cx) / fx * d, -(Float(v) - cy) / fy * d, -d, 1)
                let pw = T * pc
                let height = pw.y - floor
                guard height > -0.3, height < 2.2 else { continue }
                // free space along the ray (floor-plane projection), stopping short of the hit
                let dx = pw.x - cam.x, dz = pw.z - cam.z
                let len = (dx * dx + dz * dz).squareRoot()
                var s: Float = 0
                while s < len - Self.res * 1.5 {
                    if let k = idx(cam.x + dx * s / len, cam.z + dz * s / len), cells[k] != Cell.occupied.rawValue { cells[k] = Cell.free.rawValue }
                    s += Self.res
                }
                guard let k = idx(pw.x, pw.z) else { continue }
                if height > 0.15 && height < 1.9 {         // an obstacle you'd walk into (not floor, not ceiling)
                    hits[k] = min(hits[k] &+ 2, 30)
                    if hits[k] >= Self.occupiedAt && !walked[k] { cells[k] = Cell.occupied.rawValue }
                } else if height <= 0.15 {                 // floor seen here: less sure there's an obstacle
                    if hits[k] > 0 { hits[k] -= 1 }
                    if cells[k] == Cell.unknown.rawValue || (cells[k] == Cell.occupied.rawValue && hits[k] < Self.occupiedAt) {
                        cells[k] = Cell.free.rawValue
                    }
                }
            }
        }
        // the spot you stand on is free; with the phone held up (not lying on a couch), you walked here: always free
        if let k = idx(cam.x, cam.z) {
            cells[k] = Cell.free.rawValue
            if cam.y - floor > 0.9 {
                let i = k % Self.n, j = k / Self.n
                for dj in -1...1 { for di in -1...1 {
                    let ii = i + di, jj = j + dj
                    guard (0..<Self.n).contains(ii), (0..<Self.n).contains(jj) else { continue }
                    let q = jj * Self.n + ii
                    walked[q] = true; cells[q] = Cell.free.rawValue; hits[q] = 0
                } }
            }
        }
    }

    // MARK: queries
    /// The whole grid (300 x 300 bytes: 0 unknown, 1 free, 2 occupied), for the trip recorder.
    func cellBytes() -> Data { lock.lock(); defer { lock.unlock() }; return Data(cells) }
    func doorList() -> [Door] { lock.lock(); defer { lock.unlock() }; return Array(doors.values) }

    /// Unexplored edges: free cells next to unknown ones, clustered; biggest first.
    func frontiers(max count: Int = 8) -> [Frontier] {
        lock.lock(); let c = cells; lock.unlock()
        let n = Self.n
        var isF = [Bool](repeating: false, count: n * n)
        for j in 1..<(n - 1) { for i in 1..<(n - 1) {
            let k = j * n + i
            guard c[k] == Cell.free.rawValue else { continue }
            if c[k - 1] == 0 || c[k + 1] == 0 || c[k - n] == 0 || c[k + n] == 0 { isF[k] = true }
        } }
        var seen = [Bool](repeating: false, count: n * n)
        var out: [Frontier] = []
        for k in 0..<(n * n) where isF[k] && !seen[k] {
            var stack = [k], members: [Int] = []
            seen[k] = true
            while let q = stack.popLast() {
                members.append(q)
                for nb in [q - 1, q + 1, q - n, q + n, q - n - 1, q - n + 1, q + n - 1, q + n + 1] where nb >= 0 && nb < n * n && isF[nb] && !seen[nb] {
                    seen[nb] = true; stack.append(nb)
                }
            }
            guard members.count >= 6 else { continue }      // ignore tiny gaps
            let cen = members.map(world).reduce(SIMD2<Float>(0, 0), +) / Float(members.count)
            out.append(Frontier(x: cen.x, z: cen.y, size: members.count))
        }
        return Array(out.sorted { $0.size > $1.size }.prefix(count))
    }

    /// A* from `a` to `b` on the floor plane, staying ~20 cm from obstacles (10 cm if that finds no way); unknown
    /// space allowed but costlier; where you already walked is always passable. Returns waypoints (meters), or nil.
    func path(from a: SIMD2<Float>, to b: SIMD2<Float>) -> [SIMD2<Float>]? {
        path(from: a, to: b, pad: 2) ?? path(from: a, to: b, pad: 1)
    }

    private func path(from a: SIMD2<Float>, to b: SIMD2<Float>, pad: Int) -> [SIMD2<Float>]? {
        lock.lock(); let c = cells; let walkedNow = walked; lock.unlock()
        let n = Self.n
        guard let s = idx(a.x, a.y), let g = idx(b.x, b.y) else { return nil }
        var blocked = [Bool](repeating: false, count: n * n)   // obstacles, padded by `pad` cells
        for k in 0..<(n * n) where c[k] == Cell.occupied.rawValue {
            let i = k % n, j = k / n
            for dj in -pad...pad { for di in -pad...pad where di * di + dj * dj <= pad * pad {
                let ii = i + di, jj = j + dj
                if ii >= 0 && ii < n && jj >= 0 && jj < n && !walkedNow[jj * n + ii] { blocked[jj * n + ii] = true }
            } }
        }
        blocked[s] = false; blocked[g] = false
        var gScore = [Float](repeating: .infinity, count: n * n)
        var came = [Int](repeating: -1, count: n * n)
        var open: [(f: Float, k: Int)] = [(0, s)]
        gScore[s] = 0
        let gi = g % n, gj = g / n
        func hgt(_ k: Int) -> Float { let di = Float(k % n - gi), dj = Float(k / n - gj); return (di * di + dj * dj).squareRoot() }
        var steps = 0
        while !open.isEmpty && steps < 200_000 {
            steps += 1
            let bi = open.indices.min { open[$0].f < open[$1].f }!
            let cur = open.remove(at: bi).k
            if cur == g { break }
            let ci = cur % n, cj = cur / n
            for (di, dj, cost) in [(1, 0, Float(1)), (-1, 0, 1), (0, 1, 1), (0, -1, 1), (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414)] {
                let ii = ci + di, jj = cj + dj
                guard ii >= 0 && ii < n && jj >= 0 && jj < n else { continue }
                let nb = jj * n + ii
                guard !blocked[nb] else { continue }
                let penalty: Float = c[nb] == Cell.unknown.rawValue ? 3 : 1
                let t = gScore[cur] + cost * penalty
                if t < gScore[nb] { gScore[nb] = t; came[nb] = cur; open.append((t + hgt(nb), nb)) }
            }
        }
        guard came[g] != -1 || s == g else { return nil }
        var cells: [Int] = [g]
        while let last = cells.last, last != s, came[last] != -1 { cells.append(came[last]) }
        let pts = cells.reversed().map(world)
        // keep a waypoint every ~0.6 m
        var out: [SIMD2<Float>] = []
        for p in pts where out.last.map({ simd_distance($0, p) >= 0.6 }) ?? true { out.append(p) }
        if let last = pts.last, out.last != last { out.append(last) }
        return out
    }

    var knownCells: Int { lock.lock(); defer { lock.unlock() }; return cells.reduce(0) { $0 + ($1 == 0 ? 0 : 1) } }
}
