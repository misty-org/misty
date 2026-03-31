#!/usr/bin/env swift

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let iconDir = root
  .appendingPathComponent("src-tauri")
  .appendingPathComponent("gen")
  .appendingPathComponent("apple")
  .appendingPathComponent("Assets.xcassets")
  .appendingPathComponent("AppIcon.appiconset")

let contentsUrl = iconDir.appendingPathComponent("Contents.json")
let contentsData = try Data(contentsOf: contentsUrl)
let contents = try JSONSerialization.jsonObject(with: contentsData) as? [String: Any]
let images = contents?["images"] as? [[String: Any]] ?? []
let filenames = Set(images.compactMap { $0["filename"] as? String })

for filename in filenames.sorted() {
  let url = iconDir.appendingPathComponent(filename)
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fatalError("Could not read icon: \(url.path)")
  }
  let width = image.width
  let height = image.height
  guard width > 0 && height > 0 else {
    fatalError("Invalid icon dimensions for \(url.path)")
  }

  let colorSpace = CGColorSpaceCreateDeviceRGB()
  guard let context = CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: width * 4,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
  ) else {
    fatalError("Could not create graphics context for \(url.path)")
  }

  context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

  guard let flattened = context.makeImage(),
        let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fatalError("Could not create opaque PNG for \(url.path)")
  }
  CGImageDestinationAddImage(destination, flattened, nil)
  guard CGImageDestinationFinalize(destination) else {
    fatalError("Could not write opaque PNG for \(url.path)")
  }
  print(url.path)
}
