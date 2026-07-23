import AppKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    fputs("usage: remove_green.swift input.png output.png\n", stderr)
    exit(2)
}

let inputURL = URL(fileURLWithPath: arguments[1])
let outputURL = URL(fileURLWithPath: arguments[2])
guard
    let source = CGImageSourceCreateWithURL(inputURL as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
    fputs("could not read input image\n", stderr)
    exit(3)
}

let width = image.width
let height = image.height
let bytesPerRow = width * 4
var pixels = [UInt8](repeating: 0, count: height * bytesPerRow)
let colorSpace = CGColorSpaceCreateDeviceRGB()
guard let context = CGContext(
    data: &pixels,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fputs("could not create image context\n", stderr)
    exit(4)
}

context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

for index in stride(from: 0, to: pixels.count, by: 4) {
    let red = Double(pixels[index])
    let green = Double(pixels[index + 1])
    let blue = Double(pixels[index + 2])
    let keyDistance = sqrt(red * red + pow(green - 255, 2) + blue * blue)
    let normalized = max(0, min(1, (keyDistance - 12) / (150 - 12)))
    let alpha = normalized * normalized * (3 - 2 * normalized)

    if alpha < 1 {
        let despilledGreen = min(green, max(red, blue))
        pixels[index] = UInt8(max(0, min(255, red * alpha)))
        pixels[index + 1] = UInt8(max(0, min(255, despilledGreen * alpha)))
        pixels[index + 2] = UInt8(max(0, min(255, blue * alpha)))
        pixels[index + 3] = UInt8(max(0, min(255, 255 * alpha)))
    }
}

guard
    let result = context.makeImage(),
    let destination = CGImageDestinationCreateWithURL(
        outputURL as CFURL,
        UTType.png.identifier as CFString,
        1,
        nil
    )
else {
    fputs("could not prepare output image\n", stderr)
    exit(5)
}

CGImageDestinationAddImage(destination, result, nil)
guard CGImageDestinationFinalize(destination) else {
    fputs("could not write output image\n", stderr)
    exit(6)
}
