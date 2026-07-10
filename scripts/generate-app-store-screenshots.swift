#!/usr/bin/env swift

import AppKit
import Foundation

struct SizeSpec {
  let name: String
  let width: CGFloat
  let height: CGFloat
  let device: Device
}

enum Device {
  case phone
  case tablet
  case mac
}

struct Slide {
  let slug: String
  let eyebrow: String
  let title: String
  let subtitle: String
  let mode: MockMode
}

enum MockMode {
  case files
  case remotes
  case search
  case transfer
  case account
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let outDir = root
  .appendingPathComponent("marketing")
  .appendingPathComponent("app-store-screenshots")
  .appendingPathComponent("buttercup")

try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let specs = [
  SizeSpec(name: "mac-16-10", width: 2880, height: 1800, device: .mac),
]

let slides = [
  Slide(
    slug: "01-files",
    eyebrow: "Misty files",
    title: "Everything local and remote, in one calm browser.",
    subtitle: "Browse folders, pin workspaces, preview files, and keep movement visible.",
    mode: .files
  ),
  Slide(
    slug: "02-remotes",
    eyebrow: "Cloud access",
    title: "Connect the storage you already use.",
    subtitle: "Dropbox, Drive, S3-compatible storage, and local mounts sit beside your files.",
    mode: .remotes
  ),
  Slide(
    slug: "03-search",
    eyebrow: "Deep search",
    title: "Find the thing without remembering the path.",
    subtitle: "Saved searches, tags, recents, and filters keep big libraries approachable.",
    mode: .search
  ),
  Slide(
    slug: "04-transfers",
    eyebrow: "Transfer control",
    title: "Move work with progress you can trust.",
    subtitle: "Queue, retry, and inspect operations before they disappear into the background.",
    mode: .transfer
  ),
  Slide(
    slug: "05-account",
    eyebrow: "Private workspace",
    title: "A file app built around your machine.",
    subtitle: "Account state, diagnostics, and settings stay close without crowding your flow.",
    mode: .account
  ),
]

let butter = color("#F7C948")
let cream = color("#FFF7DF")
let ink = color("#0A0B0D")
let slate = color("#151922")
let line = color("#FFFFFF").withAlphaComponent(0.12)
let muted = color("#AEB7C4")
let mint = color("#79D5A7")
let coral = color("#FF7A70")
let sky = color("#86B7FF")

func color(_ hex: String) -> NSColor {
  let trimmed = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
  var int: UInt64 = 0
  Scanner(string: trimmed).scanHexInt64(&int)
  let r = CGFloat((int >> 16) & 0xff) / 255
  let g = CGFloat((int >> 8) & 0xff) / 255
  let b = CGFloat(int & 0xff) / 255
  return NSColor(calibratedRed: r, green: g, blue: b, alpha: 1)
}

func top(_ canvas: CGSize, _ y: CGFloat, _ height: CGFloat) -> CGFloat {
  canvas.height - y - height
}

func pathRounded(_ rect: NSRect, _ radius: CGFloat) -> NSBezierPath {
  NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
}

func fill(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ c: NSColor, _ r: CGFloat = 0) {
  c.setFill()
  let rect = NSRect(x: x, y: top(canvas, y, h), width: w, height: h)
  if r > 0 {
    pathRounded(rect, r).fill()
  } else {
    rect.fill()
  }
}

func stroke(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ c: NSColor, _ r: CGFloat = 0, _ width: CGFloat = 2) {
  c.setStroke()
  let rect = NSRect(x: x, y: top(canvas, y, h), width: w, height: h)
  let p = r > 0 ? pathRounded(rect, r) : NSBezierPath(rect: rect)
  p.lineWidth = width
  p.stroke()
}

func text(
  _ canvas: CGSize,
  _ value: String,
  _ x: CGFloat,
  _ y: CGFloat,
  _ w: CGFloat,
  _ h: CGFloat,
  size: CGFloat,
  weight: NSFont.Weight,
  color: NSColor,
  align: NSTextAlignment = .left,
  lineHeight: CGFloat = 1.12
) {
  let p = NSMutableParagraphStyle()
  p.alignment = align
  p.lineBreakMode = .byWordWrapping
  p.lineSpacing = max(0, size * (lineHeight - 1))
  let font = NSFont.systemFont(ofSize: size, weight: weight)
  let attrs: [NSAttributedString.Key: Any] = [
    .font: font,
    .foregroundColor: color,
    .paragraphStyle: p,
  ]
  (value as NSString).draw(
    in: NSRect(x: x, y: top(canvas, y, h), width: w, height: h),
    withAttributes: attrs
  )
}

func pill(_ canvas: CGSize, _ label: String, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ c: NSColor) {
  fill(canvas, x, y, w, 52, c.withAlphaComponent(0.14), 26)
  stroke(canvas, x, y, w, 52, c.withAlphaComponent(0.26), 26, 1.5)
  fill(canvas, x + 18, y + 18, 16, 16, c, 8)
  text(canvas, label, x + 46, y + 13, w - 62, 28, size: 20, weight: .semibold, color: cream)
}

func drawBackground(_ canvas: CGSize) {
  fill(canvas, 0, 0, canvas.width, canvas.height, ink)
  fill(canvas, 0, 0, canvas.width, canvas.height, color("#15100A"))
  fill(canvas, 0, 0, canvas.width, 540, butter.withAlphaComponent(0.94))
  fill(canvas, 0, 560, canvas.width, 300, color("#0C1118"), 0)
  fill(canvas, 72, 670, canvas.width - 144, canvas.height - 800, color("#0E131B"), 52)
  stroke(canvas, 72, 670, canvas.width - 144, canvas.height - 800, color("#FFFFFF").withAlphaComponent(0.08), 52, 2)
}

func drawHeader(_ canvas: CGSize, _ slide: Slide, tablet: Bool) {
  let pad: CGFloat = tablet ? 156 : 92
  let topY: CGFloat = tablet ? 96 : 118
  text(canvas, slide.eyebrow.uppercased(), pad, topY, canvas.width - pad * 2, 44, size: tablet ? 26 : 22, weight: .heavy, color: ink.withAlphaComponent(0.72))
  text(canvas, slide.title, pad, topY + 58, canvas.width - pad * 2, tablet ? 230 : 250, size: tablet ? 78 : 72, weight: .black, color: ink, lineHeight: 1.03)
  text(canvas, slide.subtitle, pad, topY + (tablet ? 260 : 286), canvas.width - pad * 2, tablet ? 92 : 120, size: tablet ? 32 : 31, weight: .medium, color: ink.withAlphaComponent(0.82), lineHeight: 1.18)
}

func drawDevice(_ canvas: CGSize, _ slide: Slide, spec: SizeSpec) {
  switch spec.device {
  case .phone:
    let w: CGFloat = 870
    let h: CGFloat = 1884
    let x = (canvas.width - w) / 2
    let y: CGFloat = 792
    fill(canvas, x - 22, y + 24, w + 44, h + 48, NSColor.black.withAlphaComponent(0.28), 72)
    fill(canvas, x, y, w, h, color("#05070A"), 72)
    stroke(canvas, x, y, w, h, color("#FFFFFF").withAlphaComponent(0.2), 72, 3)
    fill(canvas, x + 32, y + 34, w - 64, h - 68, color("#070B10"), 46)
    drawMobileUI(canvas, x + 32, y + 34, w - 64, h - 68, slide.mode)
  case .tablet:
    let w: CGFloat = 1540
    let h: CGFloat = 1660
    let x = (canvas.width - w) / 2
    let y: CGFloat = 780
    fill(canvas, x - 26, y + 28, w + 52, h + 56, NSColor.black.withAlphaComponent(0.25), 64)
    fill(canvas, x, y, w, h, color("#05070A"), 64)
    stroke(canvas, x, y, w, h, color("#FFFFFF").withAlphaComponent(0.18), 64, 3)
    fill(canvas, x + 38, y + 42, w - 76, h - 84, color("#070B10"), 34)
    drawTabletUI(canvas, x + 38, y + 42, w - 76, h - 84, slide.mode)
  case .mac:
    drawMacDevice(canvas, slide)
  }
}

func drawMacBackground(_ canvas: CGSize) {
  fill(canvas, 0, 0, canvas.width, canvas.height, color("#0A0B0D"))
  fill(canvas, 0, 0, canvas.width, 420, butter)
  fill(canvas, 0, 420, canvas.width, canvas.height - 420, color("#0D141C"))
  fill(canvas, 110, 520, canvas.width - 220, canvas.height - 650, color("#111923"), 46)
  stroke(canvas, 110, 520, canvas.width - 220, canvas.height - 650, color("#FFFFFF").withAlphaComponent(0.08), 46, 2)
}

func drawMacHeader(_ canvas: CGSize, _ slide: Slide) {
  text(canvas, slide.eyebrow.uppercased(), 160, 84, 620, 42, size: 27, weight: .heavy, color: ink.withAlphaComponent(0.68))
  text(canvas, slide.title, 160, 132, 1580, 158, size: 60, weight: .black, color: ink, lineHeight: 1.02)
  text(canvas, slide.subtitle, 160, 310, 1540, 54, size: 29, weight: .medium, color: ink.withAlphaComponent(0.82), lineHeight: 1.14)
  pill(canvas, "Mac App Store ready", canvas.width - 660, 122, 390, ink.withAlphaComponent(0.78))
  pill(canvas, "16:10", canvas.width - 248, 122, 124, ink.withAlphaComponent(0.78))
}

func drawMacDevice(_ canvas: CGSize, _ slide: Slide) {
  let x: CGFloat = 218
  let y: CGFloat = 570
  let w: CGFloat = canvas.width - 436
  let h: CGFloat = 1070
  fill(canvas, x - 24, y + 34, w + 48, h + 62, NSColor.black.withAlphaComponent(0.28), 36)
  fill(canvas, x, y, w, h, color("#05070A"), 30)
  stroke(canvas, x, y, w, h, color("#FFFFFF").withAlphaComponent(0.18), 30, 2)
  fill(canvas, x, y, w, 72, color("#111923"), 30)
  fill(canvas, x + 28, y + 26, 18, 18, coral, 9)
  fill(canvas, x + 58, y + 26, 18, 18, butter, 9)
  fill(canvas, x + 88, y + 26, 18, 18, mint, 9)
  text(canvas, "Misty", x + 132, y + 20, 160, 32, size: 24, weight: .heavy, color: cream)

  let contentY = y + 72
  fill(canvas, x, contentY, 288, h - 72, color("#0A0F15"), 0)
  text(canvas, "Workspace", x + 42, contentY + 42, 200, 34, size: 29, weight: .black, color: cream)
  let nav = ["Home", "Files", "Extensions", "Transfers"]
  for (idx, item) in nav.enumerated() {
    let selected = item == navItem(for: slide.mode)
    let yy = contentY + 112 + CGFloat(idx) * 72
    fill(canvas, x + 26, yy, 236, 52, selected ? butter.withAlphaComponent(0.18) : NSColor.clear, 14)
    text(canvas, item, x + 62, yy + 14, 170, 26, size: 21, weight: .bold, color: selected ? cream : muted)
  }
  pill(canvas, "Proxy running", x + 32, y + h - 126, 220, mint)

  let mainX = x + 328
  let mainY = contentY + 34
  let mainW = w - 370
  fill(canvas, mainX, mainY, mainW, 64, color("#111923"), 18)
  text(canvas, "Search files, providers, tags, and saved views", mainX + 30, mainY + 18, mainW - 60, 26, size: 22, weight: .medium, color: muted)

  switch slide.mode {
  case .files:
    drawMacFiles(canvas, mainX, mainY + 98, mainW)
  case .remotes:
    drawMacRemotes(canvas, mainX, mainY + 98, mainW)
  case .search:
    drawMacSearch(canvas, mainX, mainY + 98, mainW)
  case .transfer:
    drawMacTransfers(canvas, mainX, mainY + 98, mainW)
  case .account:
    drawMacSettings(canvas, mainX, mainY + 98, mainW)
  }
}

func navItem(for mode: MockMode) -> String {
  switch mode {
  case .files, .search:
    return "Files"
  case .remotes:
    return "Extensions"
  case .transfer:
    return "Transfers"
  case .account:
    return "Home"
  }
}

func drawMacFiles(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat) {
  card(canvas, x, y, w * 0.62, 246)
  text(canvas, "Launch workspace", x + 32, y + 32, w * 0.62 - 64, 42, size: 34, weight: .black, color: cream)
  text(canvas, "Local folders, remote mounts, tags, previews, and operation history sit in one place.", x + 32, y + 88, w * 0.62 - 64, 76, size: 24, weight: .medium, color: muted, lineHeight: 1.16)
  pill(canvas, "14 pinned", x + 32, y + 174, 154, butter)
  pill(canvas, "3 remotes", x + 204, y + 174, 164, sky)

  let sideX = x + w * 0.65
  card(canvas, sideX, y, w * 0.35, 246)
  text(canvas, "Preview", sideX + 30, y + 32, w * 0.35 - 60, 36, size: 30, weight: .black, color: cream)
  fill(canvas, sideX + 30, y + 86, w * 0.35 - 60, 110, butter.withAlphaComponent(0.15), 18)
  text(canvas, "store-readiness.pdf", sideX + 58, y + 124, w * 0.35 - 116, 32, size: 25, weight: .bold, color: cream)

  let rows = ["Screenshots", "App Store Copy", "Release Notes", "Provider Audit", "Support Assets"]
  for (idx, row) in rows.enumerated() {
    let yy = y + 286 + CGFloat(idx) * 92
    card(canvas, x, yy, w, 72)
    fill(canvas, x + 28, yy + 18, 36, 36, idx % 2 == 0 ? butter : sky, 10)
    text(canvas, row, x + 86, yy + 20, w - 400, 30, size: 24, weight: .bold, color: cream)
    text(canvas, idx == 0 ? "Ready for upload" : "Updated today", x + w - 310, yy + 22, 260, 28, size: 20, weight: .medium, color: muted, align: .right)
  }
}

func drawMacRemotes(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat) {
  let cards = [
    ("Dropbox", "Connected and verified", mint),
    ("Google Drive", "OAuth ready", sky),
    ("S3 Archive", "Encrypted bucket", butter),
    ("SFTP", "Launch server", coral),
  ]
  for (idx, item) in cards.enumerated() {
    let col = CGFloat(idx % 2)
    let row = CGFloat(idx / 2)
    let cw = (w - 28) / 2
    let cx = x + col * (cw + 28)
    let cy = y + row * 184
    card(canvas, cx, cy, cw, 156)
    fill(canvas, cx + 30, cy + 36, 72, 72, item.2.withAlphaComponent(0.18), 22)
    fill(canvas, cx + 52, cy + 58, 28, 28, item.2, 8)
    text(canvas, item.0, cx + 128, cy + 34, cw - 170, 34, size: 29, weight: .black, color: cream)
    text(canvas, item.1, cx + 128, cy + 78, cw - 170, 30, size: 22, weight: .medium, color: muted)
  }
  drawMacTransfers(canvas, x, y + 420, w)
}

func drawMacSearch(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat) {
  card(canvas, x, y, w, 190)
  text(canvas, "kind:image tag:launch", x + 36, y + 34, w - 72, 46, size: 38, weight: .black, color: cream)
  text(canvas, "Search across local folders, mounted providers, and cached metadata without losing context.", x + 36, y + 92, w - 72, 36, size: 24, weight: .medium, color: muted)
  pill(canvas, "128 matches", x + 36, y + 134, 190, butter)
  pill(canvas, "Saved", x + 244, y + 134, 132, sky)
  let results = [
    ("launch-hero.png", "Screenshots / Mac"),
    ("buttercup-cover.png", "Design exports"),
    ("store-readiness.pdf", "Release folder"),
    ("metadata-notes.md", "App Store copy"),
    ("provider-audit.csv", "QA packet"),
  ]
  for (idx, result) in results.enumerated() {
    let yy = y + 232 + CGFloat(idx) * 96
    card(canvas, x, yy, w, 72)
    fill(canvas, x + 28, yy + 18, 36, 36, idx % 2 == 0 ? butter : sky, 10)
    text(canvas, result.0, x + 86, yy + 18, w - 420, 30, size: 24, weight: .bold, color: cream)
    text(canvas, result.1, x + w - 360, yy + 20, 310, 28, size: 20, weight: .medium, color: muted, align: .right)
  }
}

func drawMacTransfers(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat) {
  let jobs = [
    ("Uploading release bundle", CGFloat(0.72), butter),
    ("Syncing screenshots", CGFloat(1.0), mint),
    ("Copying support archive", CGFloat(0.38), sky),
  ]
  for (idx, job) in jobs.enumerated() {
    let yy = y + CGFloat(idx) * 128
    card(canvas, x, yy, w, 100)
    text(canvas, job.0, x + 34, yy + 24, 520, 30, size: 25, weight: .bold, color: cream)
    fill(canvas, x + 34, yy + 66, w - 68, 12, color("#FFFFFF").withAlphaComponent(0.1), 6)
    fill(canvas, x + 34, yy + 66, (w - 68) * job.1, 12, job.2, 6)
  }
}

func drawMacSettings(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat) {
  let tiles = [
    ("Desktop-native shell", "Borderless window, tray status, and launch controls."),
    ("Local runtime", "Proxy status, cache paths, and diagnostics stay inspectable."),
    ("Open with Misty", "Keep file actions attached to macOS workflows."),
    ("Private by default", "Account and device state without noisy cloud assumptions."),
  ]
  for (idx, tile) in tiles.enumerated() {
    let col = CGFloat(idx % 2)
    let row = CGFloat(idx / 2)
    let cw = (w - 28) / 2
    let cx = x + col * (cw + 28)
    let cy = y + row * 204
    card(canvas, cx, cy, cw, 174)
    text(canvas, tile.0, cx + 34, cy + 34, cw - 68, 36, size: 29, weight: .black, color: cream)
    text(canvas, tile.1, cx + 34, cy + 86, cw - 68, 56, size: 23, weight: .medium, color: muted, lineHeight: 1.15)
  }
  drawMacTransfers(canvas, x, y + 438, w)
}

func drawMobileChrome(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ title: String) {
  text(canvas, "9:41", x + 42, y + 26, 112, 32, size: 22, weight: .bold, color: cream)
  fill(canvas, x + w - 168, y + 30, 56, 20, cream.withAlphaComponent(0.82), 6)
  fill(canvas, x + w - 102, y + 30, 62, 20, mint, 7)
  text(canvas, "Misty", x + 42, y + 92, 160, 34, size: 22, weight: .heavy, color: muted)
  text(canvas, title, x + 42, y + 126, w - 84, 58, size: 44, weight: .black, color: cream)
}

func drawMobileTabs(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, active: String) {
  fill(canvas, x, y + h - 126, w, 126, color("#0A0F15"), 0)
  let tabs = ["Files", "Remotes", "Account"]
  let tabW = w / CGFloat(tabs.count)
  for (idx, tab) in tabs.enumerated() {
    let tx = x + CGFloat(idx) * tabW
    let selected = tab == active
    fill(canvas, tx + tabW / 2 - 18, y + h - 96, 36, 28, selected ? butter : muted.withAlphaComponent(0.55), 9)
    text(canvas, tab, tx, y + h - 58, tabW, 28, size: 18, weight: .bold, color: selected ? cream : muted, align: .center)
  }
}

func drawMobileUI(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ mode: MockMode) {
  let title: String
  let active: String
  switch mode {
  case .files, .search, .transfer:
    title = "Files"
    active = "Files"
  case .remotes:
    title = "Remotes"
    active = "Remotes"
  case .account:
    title = "Account"
    active = "Account"
  }
  drawMobileChrome(canvas, x, y, w, h, title)
  fill(canvas, x + 36, y + 214, w - 72, 64, color("#111923"), 20)
  text(canvas, "Search files, tags, providers", x + 64, y + 231, w - 128, 28, size: 22, weight: .medium, color: muted)

  switch mode {
  case .files:
    drawFileList(canvas, x + 36, y + 318, w - 72, compact: true)
  case .remotes:
    drawRemoteList(canvas, x + 36, y + 318, w - 72)
  case .search:
    drawSearchList(canvas, x + 36, y + 318, w - 72)
  case .transfer:
    drawTransferList(canvas, x + 36, y + 318, w - 72)
  case .account:
    drawAccountPanel(canvas, x + 36, y + 318, w - 72)
  }

  drawMobileTabs(canvas, x, y, w, h, active: active)
}

func drawTabletUI(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ mode: MockMode) {
  fill(canvas, x, y, 264, h, color("#0A0F15"), 34)
  text(canvas, "Misty", x + 42, y + 44, 180, 42, size: 32, weight: .black, color: cream)
  let nav = ["Home", "Files", "Remotes", "Account"]
  for (idx, item) in nav.enumerated() {
    let selected = (mode == .remotes && item == "Remotes") || (mode == .account && item == "Account") || (mode != .remotes && mode != .account && item == "Files")
    let yy = y + 134 + CGFloat(idx) * 76
    fill(canvas, x + 24, yy, 216, 56, selected ? butter.withAlphaComponent(0.18) : NSColor.clear, 16)
    text(canvas, item, x + 56, yy + 15, 170, 26, size: 22, weight: .bold, color: selected ? cream : muted)
  }
  fill(canvas, x + 300, y + 42, w - 342, 72, color("#111923"), 22)
  text(canvas, "Search across local folders, remotes, and saved views", x + 332, y + 62, w - 406, 30, size: 24, weight: .medium, color: muted)
  switch mode {
  case .files:
    drawFileList(canvas, x + 300, y + 154, w - 342, compact: false)
  case .remotes:
    drawRemoteList(canvas, x + 300, y + 154, w - 342)
  case .search:
    drawSearchList(canvas, x + 300, y + 154, w - 342)
  case .transfer:
    drawTransferList(canvas, x + 300, y + 154, w - 342)
  case .account:
    drawAccountPanel(canvas, x + 300, y + 154, w - 342)
  }
}

func card(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) {
  fill(canvas, x, y, w, h, slate, 24)
  stroke(canvas, x, y, w, h, line, 24, 1.5)
}

func drawFileList(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, compact: Bool) {
  let rows = [
    ("Launch Assets", "24 items", butter),
    ("Screenshots", "Ready for review", sky),
    ("Client notes.pdf", "Edited 8 min ago", coral),
    ("Archive.zip", "1.2 GB", mint),
    ("Design References", "Pinned", butter),
  ]
  let headerH: CGFloat = compact ? 150 : 180
  card(canvas, x, y, w, headerH)
  text(canvas, "Workspace", x + 30, y + 28, w - 60, 34, size: compact ? 24 : 30, weight: .heavy, color: cream)
  text(canvas, "Macintosh HD / Misty / Store launch", x + 30, y + 70, w - 60, 28, size: compact ? 19 : 23, weight: .medium, color: muted)
  pill(canvas, "Synced", x + 30, y + headerH - 68, compact ? 142 : 160, mint)
  var yy = y + headerH + 22
  for (name, meta, c) in rows {
    card(canvas, x, yy, w, compact ? 114 : 126)
    fill(canvas, x + 26, yy + 28, 58, 58, c.withAlphaComponent(0.18), 16)
    fill(canvas, x + 43, yy + 45, 24, 24, c, 6)
    text(canvas, name, x + 104, yy + 24, w - 158, 30, size: compact ? 24 : 27, weight: .bold, color: cream)
    text(canvas, meta, x + 104, yy + 60, w - 158, 28, size: compact ? 18 : 21, weight: .medium, color: muted)
    yy += compact ? 134 : 148
  }
}

func drawRemoteList(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat) {
  let remotes = [
    ("Dropbox", "Connected", mint),
    ("Google Drive", "OAuth ready", sky),
    ("S3 Archive", "Encrypted bucket", butter),
    ("Local NAS", "On network", coral),
  ]
  card(canvas, x, y, w, 148)
  text(canvas, "4 connected remotes", x + 30, y + 30, w - 60, 36, size: 30, weight: .black, color: cream)
  text(canvas, "One browser for cloud storage and local files.", x + 30, y + 76, w - 60, 32, size: 22, weight: .medium, color: muted)
  var yy = y + 174
  for (name, status, c) in remotes {
    card(canvas, x, yy, w, 128)
    fill(canvas, x + 28, yy + 30, 68, 68, c.withAlphaComponent(0.18), 20)
    fill(canvas, x + 48, yy + 50, 28, 28, c, 8)
    text(canvas, name, x + 122, yy + 28, w - 176, 34, size: 27, weight: .bold, color: cream)
    text(canvas, status, x + 122, yy + 68, w - 176, 28, size: 20, weight: .medium, color: muted)
    pill(canvas, "Ready", x + w - 168, yy + 38, 132, mint)
    yy += 150
  }
}

func drawSearchList(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat) {
  card(canvas, x, y, w, 172)
  text(canvas, "Saved search", x + 30, y + 30, w - 60, 32, size: 24, weight: .heavy, color: muted)
  text(canvas, "kind:image tag:launch", x + 30, y + 74, w - 60, 44, size: 34, weight: .black, color: cream)
  pill(canvas, "128 matches", x + 30, y + 124, 178, butter)
  let chips = ["Screenshots", "Recent", "Tagged", "Large files", "PDFs"]
  var cx = x
  var cy = y + 214
  for chip in chips {
    let chipW = CGFloat(chip.count * 15 + 56)
    if cx + chipW > x + w {
      cx = x
      cy += 74
    }
    pill(canvas, chip, cx, cy, chipW, chip == "Screenshots" ? butter : sky)
    cx += chipW + 16
  }
  drawFileList(canvas, x, cy + 98, w, compact: true)
}

func drawTransferList(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat) {
  let items = [
    ("Uploading launch deck", "68%", butter, CGFloat(0.68)),
    ("Syncing screenshots", "Done", mint, CGFloat(1)),
    ("Copying video exports", "Queued", sky, CGFloat(0.18)),
    ("Retrying archive move", "1 issue", coral, CGFloat(0.42)),
  ]
  var yy = y
  for (title, detail, c, progress) in items {
    card(canvas, x, yy, w, 150)
    text(canvas, title, x + 30, yy + 28, w - 60, 34, size: 27, weight: .bold, color: cream)
    text(canvas, detail, x + 30, yy + 66, w - 60, 28, size: 20, weight: .medium, color: muted)
    fill(canvas, x + 30, yy + 108, w - 60, 14, color("#FFFFFF").withAlphaComponent(0.1), 7)
    fill(canvas, x + 30, yy + 108, (w - 60) * progress, 14, c, 7)
    yy += 176
  }
  pill(canvas, "Queue stays visible", x, yy + 18, 246, butter)
}

func drawAccountPanel(_ canvas: CGSize, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat) {
  card(canvas, x, y, w, 178)
  fill(canvas, x + 30, y + 34, 92, 92, butter.withAlphaComponent(0.18), 28)
  fill(canvas, x + 58, y + 62, 36, 36, butter, 18)
  text(canvas, "Misty account", x + 148, y + 38, w - 188, 34, size: 28, weight: .black, color: cream)
  text(canvas, "Signed in and ready on this device.", x + 148, y + 78, w - 188, 30, size: 21, weight: .medium, color: muted)
  let settings = [
    ("Local-first access", "Files stay on your devices unless you move them."),
    ("Diagnostics", "Inspect runtime health before publishing."),
    ("Open with Misty", "Keep file actions close to the system."),
    ("Privacy controls", "Clear account and local session state."),
  ]
  var yy = y + 212
  for (title, body) in settings {
    card(canvas, x, yy, w, 132)
    text(canvas, title, x + 30, yy + 26, w - 60, 30, size: 25, weight: .bold, color: cream)
    text(canvas, body, x + 30, yy + 62, w - 60, 44, size: 19, weight: .medium, color: muted)
    yy += 154
  }
}

func renderPNG(_ size: CGSize, drawing: () -> Void) throws -> Data {
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: Int(size.width),
    pixelsHigh: Int(size.height),
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    throw NSError(domain: "screenshots", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not allocate bitmap."])
  }
  bitmap.size = size
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
  drawing()
  NSGraphicsContext.restoreGraphicsState()
  guard let png = bitmap.representation(using: .png, properties: [:]) else {
    throw NSError(domain: "screenshots", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not encode PNG."])
  }
  return png
}

var manifest: [String] = []

for spec in specs {
  let specDir = outDir.appendingPathComponent(spec.name)
  try FileManager.default.createDirectory(at: specDir, withIntermediateDirectories: true)
  for slide in slides {
    let size = CGSize(width: spec.width, height: spec.height)
    let png = try renderPNG(size) {
      if spec.device == .mac {
        drawMacBackground(size)
        drawMacHeader(size, slide)
      } else {
        drawBackground(size)
        drawHeader(size, slide, tablet: spec.device == .tablet)
      }
      drawDevice(size, slide, spec: spec)
    }
    let url = specDir.appendingPathComponent("\(slide.slug).png")
    try png.write(to: url)
    manifest.append("- \(spec.name)/\(slide.slug).png (\(Int(spec.width))x\(Int(spec.height)))")
    print("Wrote \(url.path)")
  }
}

let manifestText = """
# Buttercup App Store Screenshot Set

Generated by `swift scripts/generate-app-store-screenshots.swift`.

Apple accepts 1 to 10 screenshots per device size. This set includes five Mac screenshots at 2880x1800, one of Apple's accepted 16:10 Mac App Store screenshot sizes.

\(manifest.joined(separator: "\n"))
"""

try manifestText.write(to: outDir.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)
