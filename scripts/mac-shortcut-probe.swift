import AppKit
import Carbon

// Electron uses non-exclusive Carbon registration on macOS. That can succeed
// while an exclusive registrant prevents delivery. Probe before registering.
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
let choices: [String: (UInt32, UInt32)] = [
    "Command+Shift+K": (UInt32(kVK_ANSI_K), UInt32(cmdKey | shiftKey)),
    "Command+Alt+K": (UInt32(kVK_ANSI_K), UInt32(cmdKey | optionKey)),
    "Command+Shift+Space": (UInt32(kVK_Space), UInt32(cmdKey | shiftKey))
]
guard CommandLine.arguments.count == 2, let (key, modifiers) = choices[CommandLine.arguments[1]] else {
    exit(2)
}
var hotKey: EventHotKeyRef?
let status = RegisterEventHotKey(key, modifiers, EventHotKeyID(signature: 0x484b5052, id: 1), GetApplicationEventTarget(), UInt32(kEventHotKeyExclusive), &hotKey)
if status == noErr, let reference = hotKey { UnregisterEventHotKey(reference) }
print("{\"available\":\(status == noErr)}")
