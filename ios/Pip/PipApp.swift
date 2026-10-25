// Pip for iPhone: a native shell around Pip's brain (the same web logic as the laptop version), with the
// phone's sensors: 0.5x ultra-wide camera, LiDAR depth, gyro heading, step distance, GPS, and the phone mic.
// The models still run on the RTX 4090 over Tailscale.
import SwiftUI

@main
struct PipApp: App {
    var body: some Scene {
        WindowGroup {
            PipView()
                .ignoresSafeArea(edges: .bottom)
                .preferredColorScheme(.dark)
                .onAppear { UIApplication.shared.isIdleTimerDisabled = true }   // a guide shouldn't fall asleep
        }
    }
}

struct PipView: View {
    @StateObject private var sensors = Sensors()

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(sensors.cameraMode).font(.caption.bold())
                if let d = sensors.depthAhead { Text(String(format: "ahead %.1f m", d)).font(.caption) }
                Text(String(format: "%.0f°", sensors.heading)).font(.caption)
                Text(String(format: "%.1f m walked", sensors.distance)).font(.caption)
                Spacer()
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .accessibilityHidden(true)
            PipWebView(sensors: sensors)
        }
        .background(Color.black)
    }
}
