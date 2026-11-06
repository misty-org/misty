// swift-tools-version: 5.9
import PackageDescription

// Capture only. No app, billing or account code belongs in this package.
let package = Package(
    name: "MistyAudioCapture",
    platforms: [.macOS(.v13)],
    products: [.library(name: "MistyAudioCapture", type: .static, targets: ["MistyAudioCapture"])],
    targets: [.target(name: "MistyAudioCapture", path: "Sources/MistyAudioCapture")]
)
