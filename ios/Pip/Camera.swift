// Camera + LiDAR. Best available setup, in order:
//   1. 0.5x ultra-wide for vision AND LiDAR depth together (multi-camera session, where the phone allows it)
//   2. LiDAR depth camera alone (its video comes from the 1x camera)
//   3. 0.5x ultra-wide only (phones without LiDAR)
//   4. 1x wide camera
// Frames are encoded to small portrait JPEGs (640 px wide, ~5/s) for the vision models on the 4090.
import AVFoundation
import CoreImage
import UIKit

final class Camera: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureDepthDataOutputDelegate {
    struct Depth { var left: Float; var center: Float; var right: Float; var nearest: Float }

    var onMode: ((String) -> Void)?
    private let queue = DispatchQueue(label: "pip.camera")
    private var session: AVCaptureSession?
    private let ci = CIContext()
    private let lock = NSLock()
    private var _jpeg: Data?
    private var _depth: Depth?
    private var lastEncode = Date.distantPast

    var jpeg: Data? { lock.lock(); defer { lock.unlock() }; return _jpeg }
    var depth: Depth? { lock.lock(); defer { lock.unlock() }; return _depth }

    func start() {
        AVCaptureDevice.requestAccess(for: .video) { ok in
            guard ok else { self.onMode?("no camera permission"); return }
            self.queue.async { self.configure() }
        }
    }

    private func configure() {
        let ultra = AVCaptureDevice.default(.builtInUltraWideCamera, for: .video, position: .back)
        let lidar = AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .video, position: .back)
        let wide = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)

        if let ultra, let lidar, AVCaptureMultiCamSession.isMultiCamSupported, multiCamAllows([ultra, lidar]),
           configureMultiCam(ultra: ultra, lidar: lidar) {
            onMode?("0.5x + LiDAR"); return
        }
        if let lidar, configureSingle(device: lidar, withDepth: true) { onMode?("1x + LiDAR"); return }
        if let ultra, configureSingle(device: ultra, withDepth: false) { onMode?("0.5x (no LiDAR)"); return }
        if let wide, configureSingle(device: wide, withDepth: false) { onMode?("1x"); return }
        onMode?("no camera")
    }

    private func multiCamAllows(_ devices: [AVCaptureDevice]) -> Bool {
        let types = Set(devices.map(\.deviceType))
        let sets = AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInUltraWideCamera, .builtInLiDARDepthCamera, .builtInWideAngleCamera],
                                                    mediaType: .video, position: .back).supportedMultiCamDeviceSets
        return sets.contains { Set($0.map(\.deviceType)).isSuperset(of: types) }
    }

    private func pickDepthFormat(_ device: AVCaptureDevice) -> Bool {
        // A video format that can also deliver depth, and its float depth format.
        for format in device.formats.reversed() {
            let depthFormats = format.supportedDepthDataFormats.filter {
                CMFormatDescriptionGetMediaSubType($0.formatDescription) == kCVPixelFormatType_DepthFloat32
            }
            guard let df = depthFormats.max(by: { a, b in
                CMVideoFormatDescriptionGetDimensions(a.formatDescription).width < CMVideoFormatDescriptionGetDimensions(b.formatDescription).width
            }) else { continue }
            do {
                try device.lockForConfiguration()
                device.activeFormat = format
                device.activeDepthDataFormat = df
                device.unlockForConfiguration()
                return true
            } catch { continue }
        }
        return false
    }

    private func configureMultiCam(ultra: AVCaptureDevice, lidar: AVCaptureDevice) -> Bool {
        let s = AVCaptureMultiCamSession()
        s.beginConfiguration()
        defer { s.commitConfiguration() }
        guard let ultraIn = try? AVCaptureDeviceInput(device: ultra), s.canAddInput(ultraIn),
              let lidarIn = try? AVCaptureDeviceInput(device: lidar), s.canAddInput(lidarIn) else { return false }
        s.addInputWithNoConnections(ultraIn)
        s.addInputWithNoConnections(lidarIn)

        let video = AVCaptureVideoDataOutput()
        video.alwaysDiscardsLateVideoFrames = true
        video.setSampleBufferDelegate(self, queue: queue)
        guard s.canAddOutput(video),
              let vPort = ultraIn.ports(for: .video, sourceDeviceType: ultra.deviceType, sourceDevicePosition: .back).first else { return false }
        s.addOutputWithNoConnections(video)
        let vConn = AVCaptureConnection(inputPorts: [vPort], output: video)
        guard s.canAddConnection(vConn) else { return false }
        s.addConnection(vConn)
        portrait(vConn)

        guard pickDepthFormat(lidar) else { return false }
        let depthOut = AVCaptureDepthDataOutput()
        depthOut.isFilteringEnabled = true
        depthOut.alwaysDiscardsLateDepthData = true
        depthOut.setDelegate(self, callbackQueue: queue)
        guard s.canAddOutput(depthOut),
              let dPort = lidarIn.ports(for: .depthData, sourceDeviceType: lidar.deviceType, sourceDevicePosition: .back).first else { return false }
        s.addOutputWithNoConnections(depthOut)
        let dConn = AVCaptureConnection(inputPorts: [dPort], output: depthOut)
        guard s.canAddConnection(dConn) else { return false }
        s.addConnection(dConn)
        widest(ultra)
        session = s
        s.startRunning()
        return s.isRunning
    }

    private func configureSingle(device: AVCaptureDevice, withDepth: Bool) -> Bool {
        let s = AVCaptureSession()
        s.beginConfiguration()
        s.sessionPreset = withDepth ? .inputPriority : .high
        guard let input = try? AVCaptureDeviceInput(device: device), s.canAddInput(input) else { s.commitConfiguration(); return false }
        s.addInput(input)
        if withDepth && !pickDepthFormat(device) { s.commitConfiguration(); return false }
        let video = AVCaptureVideoDataOutput()
        video.alwaysDiscardsLateVideoFrames = true
        video.setSampleBufferDelegate(self, queue: queue)
        guard s.canAddOutput(video) else { s.commitConfiguration(); return false }
        s.addOutput(video)
        if let c = video.connection(with: .video) { portrait(c) }
        if withDepth {
            let depthOut = AVCaptureDepthDataOutput()
            depthOut.isFilteringEnabled = true
            depthOut.alwaysDiscardsLateDepthData = true
            depthOut.setDelegate(self, callbackQueue: queue)
            if s.canAddOutput(depthOut) { s.addOutput(depthOut) }
        }
        s.commitConfiguration()
        widest(device)
        session = s
        s.startRunning()
        return s.isRunning
    }

    private func portrait(_ c: AVCaptureConnection) {
        if c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
    }

    /// The widest view the lens allows (the ultra-wide is the "0.5x" camera; zoom 1.0 on it = 0.5x).
    private func widest(_ device: AVCaptureDevice) {
        guard (try? device.lockForConfiguration()) != nil else { return }
        device.videoZoomFactor = device.minAvailableVideoZoomFactor
        if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
        device.unlockForConfiguration()
    }

    // MARK: frames -> small portrait JPEGs (~5 per second)
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard Date().timeIntervalSince(lastEncode) > 0.2, let px = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastEncode = Date()
        var img = CIImage(cvPixelBuffer: px)
        if img.extent.width > img.extent.height { img = img.oriented(.right) }   // if rotation wasn't applied
        let scale = 640 / img.extent.width
        img = img.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let data = ci.jpegRepresentation(of: img, colorSpace: CGColorSpaceCreateDeviceRGB(),
                                               options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.7]) else { return }
        lock.lock(); _jpeg = data; lock.unlock()
    }

    // MARK: LiDAR depth -> nearest distance in the left / center / right thirds (meters)
    func depthDataOutput(_ output: AVCaptureDepthDataOutput, didOutput depthData: AVDepthData, timestamp: CMTime, connection: AVCaptureConnection) {
        let d = depthData.depthDataType == kCVPixelFormatType_DepthFloat32 ? depthData : depthData.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
        let map = d.depthDataMap
        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        let w = CVPixelBufferGetWidth(map), h = CVPixelBufferGetHeight(map)
        guard let base = CVPixelBufferGetBaseAddress(map) else { return }
        let row = CVPixelBufferGetBytesPerRow(map)
        // The depth map is in sensor (landscape) orientation. Holding the phone upright in portrait:
        // sensor x runs top->bottom of the portrait view, sensor y runs right->left.
        // Use the middle band (portrait rows 30%..80%: where you'd walk into things) and split into thirds.
        var buckets: [[Float]] = [[], [], []]   // portrait left, center, right
        let x0 = Int(Double(w) * 0.3), x1 = Int(Double(w) * 0.8)
        for y in stride(from: 0, to: h, by: 2) {
            let ptr = base.advanced(by: y * row).assumingMemoryBound(to: Float32.self)
            let third = y < h / 3 ? 2 : y < 2 * h / 3 ? 1 : 0   // small y = portrait right
            for x in stride(from: x0, to: x1, by: 2) {
                let v = ptr[x]
                if v.isFinite && v > 0.1 && v < 8 { buckets[third].append(v) }
            }
        }
        func near(_ a: [Float]) -> Float {   // 10th percentile: robust "closest thing" distance
            guard !a.isEmpty else { return 8 }
            let s = a.sorted()
            return s[s.count / 10]
        }
        let l = near(buckets[0]), c = near(buckets[1]), r = near(buckets[2])
        lock.lock(); _depth = Depth(left: l, center: c, right: r, nearest: min(l, c, r)); lock.unlock()
    }
}
