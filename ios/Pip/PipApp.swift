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
        // The whole screen is the web page (frontend/index.html, built from the pen.dev design).
        PipWebView(sensors: sensors)
            .background(Color(red: 7 / 255, green: 7 / 255, blue: 10 / 255))   // design token bg #07070A
    }
}
