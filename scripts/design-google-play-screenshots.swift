#!/usr/bin/env swift

import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let rawDir = root.appendingPathComponent("marketing/google-play-screenshots/mobile/raw/phone")
let outDir = root.appendingPathComponent("marketing/google-play-screenshots/mobile/final/phone-1080x1920/en-US")
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let slots: [(file: String, title: String, subtitle: String)] = [
  ("00-welcome.png", "Welcome to Misty", "Keep on-device files and connected storage close at hand."),
  ("01-files.png", "Browse files anywhere", "On-device and connected storage stay organized in one mobile view."),
  ("02-remotes.png", "Connect storage you use", "Add supported remotes and keep provider setup close at hand."),
  ("03-transfers.png", "Track every transfer", "Follow upload, download, and sync activity from a focused status view."),
  ("04-settings.png", "Control privacy settings", "Manage account state, local processing, notifications, and device settings."),
  ("05-account.png", "Sign in to Misty", "Use Misty as a secure companion for your existing account."),
]

let canvas = CGSize(width: 1080, height: 1920)
let screenRect = CGRect(x: 170, y: 88, width: 740, height: 1316)
let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
paragraph.lineBreakMode = .byWordWrapping

for slot in slots {
  let source = rawDir.appendingPathComponent(slot.file)
  guard let screenshot = NSImage(contentsOf: source) else {
    fputs("Missing raw screenshot: \(source.path)\n", stderr)
    exit(1)
  }
  let output = outDir.appendingPathComponent(slot.file)
  guard let context = CGContext(
    data: nil,
    width: Int(canvas.width),
    height: Int(canvas.height),
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
  ) else {
    fatalError("Could not create bitmap context")
  }

  let cgContext = NSGraphicsContext(cgContext: context, flipped: false)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = cgContext

  NSColor(calibratedRed: 0.035, green: 0.047, blue: 0.058, alpha: 1).setFill()
  NSBezierPath(rect: CGRect(origin: .zero, size: canvas)).fill()

  let accent = NSColor(calibratedRed: 0.95, green: 0.72, blue: 0.28, alpha: 1)
  accent.withAlphaComponent(0.22).setFill()
  NSBezierPath(roundedRect: CGRect(x: -120, y: 1450, width: 1320, height: 560), xRadius: 280, yRadius: 280).fill()

  let titleAttributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 60, weight: .heavy),
    .foregroundColor: NSColor(calibratedWhite: 0.97, alpha: 1),
    .paragraphStyle: paragraph,
  ]
  let subtitleAttributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 28, weight: .medium),
    .foregroundColor: NSColor(calibratedRed: 0.78, green: 0.84, blue: 0.9, alpha: 1),
    .paragraphStyle: paragraph,
  ]
  NSString(string: slot.title).draw(in: CGRect(x: 92, y: 1648, width: 896, height: 150), withAttributes: titleAttributes)
  NSString(string: slot.subtitle).draw(in: CGRect(x: 138, y: 1510, width: 804, height: 112), withAttributes: subtitleAttributes)

  NSColor(calibratedWhite: 0.02, alpha: 1).setFill()
  NSBezierPath(roundedRect: screenRect.insetBy(dx: -18, dy: -18), xRadius: 74, yRadius: 74).fill()
  NSColor(calibratedWhite: 0.18, alpha: 1).setStroke()
  let frame = NSBezierPath(roundedRect: screenRect.insetBy(dx: -18, dy: -18), xRadius: 74, yRadius: 74)
  frame.lineWidth = 3
  frame.stroke()

  screenshot.draw(in: screenRect, from: CGRect(origin: .zero, size: screenshot.size), operation: .copy, fraction: 1)

  NSGraphicsContext.restoreGraphicsState()

  guard let image = context.makeImage(),
        let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fatalError("Could not create PNG destination")
  }
  CGImageDestinationAddImage(destination, image, nil)
  if !CGImageDestinationFinalize(destination) {
    fatalError("Could not write \(output.path)")
  }
}

print("Google Play screenshots exported to \(outDir.path)")
