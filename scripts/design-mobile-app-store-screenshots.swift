#!/usr/bin/env swift

import AppKit
import Foundation

struct Slide {
  let slug: String
  let source: String
  let eyebrow: String
  let title: String
  let subtitle: String
}

struct ResizeExport {
  let directory: URL
  let size: CGSize
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let inputDir = root
  .appendingPathComponent("marketing")
  .appendingPathComponent("app-store-screenshots")
  .appendingPathComponent("mobile")
  .appendingPathComponent("raw")
  .appendingPathComponent("accepted")
let finalDir = root
  .appendingPathComponent("marketing")
  .appendingPathComponent("app-store-screenshots")
  .appendingPathComponent("mobile")
  .appendingPathComponent("final")

let iphone69Dir = finalDir
  .appendingPathComponent("iphone-6-9")
  .appendingPathComponent("en-US")

let iphone65Dir = finalDir
  .appendingPathComponent("iphone-6-5")
  .appendingPathComponent("en-US")

let designed69Dir = iphone69Dir
  .appendingPathComponent("designed-fallback")
let designed65Dir = iphone65Dir
  .appendingPathComponent("designed-fallback")
let direct69Dir = iphone69Dir
  .appendingPathComponent("fallback-direct-resize")
let direct65Dir = iphone65Dir
  .appendingPathComponent("fallback-direct-resize")

for directory in [designed69Dir, designed65Dir, direct69Dir, direct65Dir] {
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
}

let canvas = CGSize(width: 1320, height: 2868)
let iphone65Canvas = CGSize(width: 1242, height: 2688)
let slides = [
  Slide(
    slug: "01-files",
    source: "01-files.png",
    eyebrow: "Misty files",
    title: "Browse files without losing context",
    subtitle: "Local and connected storage stay organized in one mobile view."
  ),
  Slide(
    slug: "02-remotes",
    source: "02-remotes.png",
    eyebrow: "Cloud access",
    title: "Connect storage you already use",
    subtitle: "Set up supported remotes and keep access status close."
  ),
  Slide(
    slug: "03-transfers",
    source: "03-transfers.png",
    eyebrow: "Sync activity",
    title: "Track uploads, downloads, and sync",
    subtitle: "Review progress, retry work, and keep file movement visible."
  ),
  Slide(
    slug: "04-settings-account",
    source: "04-settings-account.png",
    eyebrow: "Account and privacy",
    title: "Control account and privacy",
    subtitle: "Manage sign-in, local processing, diagnostics, and device settings."
  ),
  Slide(
    slug: "05-account-setup",
    source: "05-account-setup.png",
    eyebrow: "Get started",
    title: "Create your Misty login on iPhone",
    subtitle: "Set up account access on this device and keep core file workflows close."
  ),
]

let yellow = color("#F7C948")
let yellowDeep = color("#E9B941")
let ink = color("#07090B")
let panel = color("#0E151D")
let text = color("#FFF7DF")
let muted = color("#AEB7C4")
let blue = color("#86B7FF")
let green = color("#79D5A7")

for slide in slides {
  let sourceUrl = inputDir.appendingPathComponent(slide.source)
  guard let source = NSImage(contentsOf: sourceUrl) else {
    fatalError("Missing source capture: \(sourceUrl.path)")
  }
  let output = render(slide: slide, source: source)
  let designed69Url = designed69Dir.appendingPathComponent("\(slide.slug).png")
  let designed65Url = designed65Dir.appendingPathComponent("\(slide.slug).png")
  let direct69Url = direct69Dir.appendingPathComponent("\(slide.slug).png")
  let direct65Url = direct65Dir.appendingPathComponent("\(slide.slug).png")

  try writePng(output, to: designed69Url)
  try writePng(resizeImage(bitmapImage(output), to: iphone65Canvas), to: designed65Url)
  try writePng(resizeImage(source, to: canvas), to: direct69Url)
  try writePng(resizeImage(source, to: iphone65Canvas), to: direct65Url)

  print(designed69Url.path)
  print(designed65Url.path)
  print(direct69Url.path)
  print(direct65Url.path)
}

func render(slide: Slide, source: NSImage) -> NSBitmapImageRep {
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: Int(canvas.width),
    pixelsHigh: Int(canvas.height),
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .calibratedRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    fatalError("Could not create bitmap context")
  }

  guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("Could not create graphics context")
  }

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context

  drawBackground()
  drawHeader(slide)
  drawDevice(source)
  drawFooter(slide)

  NSGraphicsContext.restoreGraphicsState()
  return bitmap
}

func drawBackground() {
  fill(NSRect(x: 0, y: 0, width: canvas.width, height: canvas.height), ink)
  fill(topRect(x: 0, y: 0, width: canvas.width, height: 670), yellow)
  fill(topRect(x: 0, y: 582, width: canvas.width, height: 170), yellowDeep.withAlphaComponent(0.35))
  fill(topRect(x: 0, y: 668, width: canvas.width, height: canvas.height - 668), color("#071019"))
  fill(topRect(x: 74, y: 690, width: canvas.width - 148, height: 1965), panel, radius: 42)
  stroke(topRect(x: 74, y: 690, width: canvas.width - 148, height: 1965), color("#FFFFFF").withAlphaComponent(0.08), width: 2, radius: 42)
}

func drawHeader(_ slide: Slide) {
  drawText(
    slide.eyebrow.uppercased(),
    in: topRect(x: 90, y: 92, width: canvas.width - 180, height: 42),
    size: 23,
    weight: .heavy,
    color: ink.withAlphaComponent(0.66),
    lineHeight: 1.08
  )
  drawText(
    slide.title,
    in: topRect(x: 88, y: 150, width: canvas.width - 176, height: 248),
    size: 76,
    weight: .black,
    color: ink,
    lineHeight: 0.98
  )
  drawText(
    slide.subtitle,
    in: topRect(x: 90, y: 430, width: canvas.width - 180, height: 96),
    size: 30,
    weight: .medium,
    color: ink.withAlphaComponent(0.78),
    lineHeight: 1.16
  )
}

func drawDevice(_ source: NSImage) {
  let outer = topRect(x: 212, y: 750, width: 896, height: 1948)
  let inner = topRect(x: 250, y: 794, width: 820, height: 1783)
  let gloss = topRect(x: 242, y: 778, width: 836, height: 1816)

  fill(outer.offsetBy(dx: 0, dy: -22), NSColor.black.withAlphaComponent(0.24), radius: 88)
  fill(outer, color("#030506"), radius: 86)
  stroke(outer, color("#FFFFFF").withAlphaComponent(0.23), width: 3, radius: 86)
  fill(gloss, color("#0B1118"), radius: 64)

  let clip = NSBezierPath(roundedRect: inner, xRadius: 54, yRadius: 54)
  NSGraphicsContext.saveGraphicsState()
  clip.addClip()
  source.draw(in: inner, from: .zero, operation: .sourceOver, fraction: 1)
  NSGraphicsContext.restoreGraphicsState()

  fill(topRect(x: 514, y: 815, width: 292, height: 38), color("#05070A"), radius: 19)
  stroke(inner, color("#FFFFFF").withAlphaComponent(0.12), width: 1.5, radius: 54)
}

func drawFooter(_ slide: Slide) {
  let y: CGFloat = 2706
  fill(topRect(x: 90, y: y, width: canvas.width - 180, height: 76), color("#FFFFFF").withAlphaComponent(0.055), radius: 28)
  fill(topRect(x: 120, y: y + 26, width: 22, height: 22), blue, radius: 11)
  fill(topRect(x: 156, y: y + 26, width: 22, height: 22), green, radius: 11)
  drawText(
    "Misty for iPhone",
    in: topRect(x: 198, y: y + 20, width: 380, height: 34),
    size: 24,
    weight: .heavy,
    color: text,
    lineHeight: 1
  )
  drawText(
    "Files, remotes, transfers, and account controls.",
    in: topRect(x: 560, y: y + 21, width: 640, height: 34),
    size: 21,
    weight: .medium,
    color: muted,
    align: .right,
    lineHeight: 1
  )
}

func writePng(_ bitmap: NSBitmapImageRep, to url: URL) throws {
  guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Could not encode PNG for \(url.path)")
  }
  try png.write(to: url)
}

func bitmapImage(_ bitmap: NSBitmapImageRep) -> NSImage {
  let image = NSImage(size: NSSize(width: bitmap.pixelsWide, height: bitmap.pixelsHigh))
  image.addRepresentation(bitmap)
  return image
}

func resizeImage(_ image: NSImage, to target: CGSize) -> NSBitmapImageRep {
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: Int(target.width),
    pixelsHigh: Int(target.height),
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .calibratedRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    fatalError("Could not create resized bitmap context.")
  }

  guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("Could not create resized graphics context.")
  }

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  image.draw(
    in: NSRect(x: 0, y: 0, width: target.width, height: target.height),
    from: .zero,
    operation: .sourceOver,
    fraction: 1
  )
  NSGraphicsContext.restoreGraphicsState()
  return bitmap
}

func color(_ hex: String) -> NSColor {
  let clean = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
  var int: UInt64 = 0
  Scanner(string: clean).scanHexInt64(&int)
  return NSColor(
    calibratedRed: CGFloat((int >> 16) & 0xff) / 255,
    green: CGFloat((int >> 8) & 0xff) / 255,
    blue: CGFloat(int & 0xff) / 255,
    alpha: 1
  )
}

func topRect(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) -> NSRect {
  NSRect(x: x, y: canvas.height - y - height, width: width, height: height)
}

func fill(_ rect: NSRect, _ color: NSColor, radius: CGFloat = 0) {
  color.setFill()
  if radius > 0 {
    NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
  } else {
    rect.fill()
  }
}

func stroke(_ rect: NSRect, _ color: NSColor, width: CGFloat, radius: CGFloat = 0) {
  color.setStroke()
  let path = radius > 0 ? NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius) : NSBezierPath(rect: rect)
  path.lineWidth = width
  path.stroke()
}

func drawText(
  _ value: String,
  in rect: NSRect,
  size: CGFloat,
  weight: NSFont.Weight,
  color: NSColor,
  align: NSTextAlignment = .left,
  lineHeight: CGFloat
) {
  let paragraph = NSMutableParagraphStyle()
  paragraph.alignment = align
  paragraph.lineBreakMode = .byWordWrapping
  paragraph.lineSpacing = max(0, size * (lineHeight - 1))
  let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: size, weight: weight),
    .foregroundColor: color,
    .paragraphStyle: paragraph,
  ]
  (value as NSString).draw(in: rect, withAttributes: attributes)
}
