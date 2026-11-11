// Regenerate the matching macOS icon with system AppKit, then run iconutil.
// Usage: swift scripts/create-app-icon.swift <absolute output.iconset folder>
import AppKit
import Foundation

guard CommandLine.arguments.count == 2 else { fatalError("Provide an output .iconset directory") }
let folder = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
for (name, pixels) in [("icon_16x16",16),("icon_16x16@2x",32),("icon_32x32",32),("icon_32x32@2x",64),("icon_128x128",128),("icon_128x128@2x",256),("icon_256x256",256),("icon_256x256@2x",512),("icon_512x512",512),("icon_512x512@2x",1024)] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let scale = CGFloat(pixels) / 1024
    let transform = NSAffineTransform(); transform.scale(by: scale); transform.concat()
    NSColor(calibratedRed: 77/255, green: 102/255, blue: 207/255, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 96, y: 96, width: 832, height: 832), xRadius: 192, yRadius: 192).fill()
    // Same 24-unit bookmark outline as icon.svg; AppKit's Y axis is reversed.
    func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: 176 + x*28, y: 1024 - (176 + y*28)) }
    let mark = NSBezierPath()
    mark.move(to: point(18,4)); mark.line(to: point(18,21)); mark.line(to: point(12,17)); mark.line(to: point(6,21)); mark.line(to: point(6,4))
    mark.curve(to: point(7,3), controlPoint1: point(6,3.45), controlPoint2: point(6.45,3))
    mark.line(to: point(17,3)); mark.curve(to: point(18,4), controlPoint1: point(17.55,3), controlPoint2: point(18,3.45)); mark.close()
    mark.lineWidth = 1.65*28; mark.lineJoinStyle = .round; mark.lineCapStyle = .round
    NSColor.white.setStroke(); mark.stroke()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: folder.appendingPathComponent(name+".png"))
}
