// Draws the app icon as a 1024x1024 PNG. Usage: swift tools/appicon.swift out.png
import AppKit

let size: CGFloat = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

// macOS icon grid: a rounded square inset from the canvas edge.
let tile = NSRect(x: 0, y: 0, width: size, height: size).insetBy(dx: 100, dy: 100)
let shape = NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185)
NSGradient(starting: NSColor(calibratedRed: 0.16, green: 0.25, blue: 0.52, alpha: 1),
           ending: NSColor(calibratedRed: 0.05, green: 0.07, blue: 0.17, alpha: 1))!.draw(in: shape, angle: -90)

let letter = NSAttributedString(string: "C", attributes: [
  .font: NSFont.systemFont(ofSize: 500, weight: .heavy), .foregroundColor: NSColor.white])
let ls = letter.size()
letter.draw(at: NSPoint(x: (size - ls.width) / 2, y: (size - ls.height) / 2 + 50))

let caption = NSAttributedString(string: "WebGPU", attributes: [
  .font: NSFont.monospacedSystemFont(ofSize: 88, weight: .semibold),
  .foregroundColor: NSColor(calibratedRed: 0.55, green: 0.80, blue: 1, alpha: 1)])
let cs = caption.size()
caption.draw(at: NSPoint(x: (size - cs.width) / 2, y: 175))

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
