import SwiftUI

struct PushToTalkKey: NSViewRepresentable {
    let enabled: Bool
    let setHeld: (Bool) -> Void

    final class Listener: NSView {
        var enabled = false { didSet { if !enabled { releaseKey() } } }
        var setHeld: ((Bool) -> Void)?
        private var monitor: Any?
        private var held = false

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stop()
            guard let window else { return }
            NotificationCenter.default.addObserver(self, selector: #selector(releaseKey), name: NSWindow.didResignKeyNotification, object: window)
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { [weak self] event in
                guard let self, event.keyCode == 49 else { return event }
                if event.type == .keyUp && held { releaseKey(); return nil }
                guard enabled, event.type == .keyDown, event.window === self.window, self.window?.isKeyWindow == true,
                      self.window?.attachedSheet == nil, !(self.window?.firstResponder is NSText),
                      event.modifierFlags.intersection([.command, .option, .control, .shift]).isEmpty else { return event }
                if !event.isARepeat && !held { held = true; setHeld?(true) }
                return nil
            }
        }

        @objc func releaseKey() {
            if held { held = false; setHeld?(false) }
        }

        func stop() {
            releaseKey()
            if let monitor { NSEvent.removeMonitor(monitor); self.monitor = nil }
            NotificationCenter.default.removeObserver(self)
        }
    }

    func makeNSView(context: Context) -> Listener { Listener() }
    func updateNSView(_ view: Listener, context: Context) { view.setHeld = setHeld; view.enabled = enabled }
    static func dismantleNSView(_ view: Listener, coordinator: ()) { view.stop() }
}
