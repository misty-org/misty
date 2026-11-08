import Foundation

/// Rust context, PCM16 samples, sample count, status. Status 0 carries audio;
/// status 2 means the device failed and the capture has stopped.
public typealias PCMCallback = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<Int16>?, Int, Int32) -> Void

/// Start results shared with Rust.
enum CaptureStatus: Int32 {
    case ok = 0, denied = 1, device = 2, unsupported = 3, noSuchProcess = 4
}

protocol NativeCapture: AnyObject {
    func stop()
}

/// Delivers PCM to Rust until stopped. Stop is synchronous: once it returns,
/// the callback never runs again, so Rust can free its context.
final class PCMDelivery {
    private let lock = NSLock()
    private var open = true
    private let context: UnsafeMutableRawPointer?
    private let callback: PCMCallback

    init(context: UnsafeMutableRawPointer?, callback: @escaping PCMCallback) {
        self.context = context
        self.callback = callback
    }

    func send(_ samples: UnsafePointer<Int16>, count: Int) {
        lock.lock(); defer { lock.unlock() }
        if open { callback(context, samples, count, CaptureStatus.ok.rawValue) }
    }

    func fail() {
        lock.lock(); defer { lock.unlock() }
        if open { callback(context, nil, 0, CaptureStatus.device.rawValue); open = false }
    }

    func close() {
        lock.lock(); open = false; lock.unlock()
    }
}

func retain(_ capture: NativeCapture) -> UnsafeMutableRawPointer {
    Unmanaged.passRetained(capture as AnyObject).toOpaque()
}

@_cdecl("misty_audio_capture_stop")
public func mistyAudioCaptureStop(_ handle: UnsafeMutableRawPointer?) {
    guard let handle else { return }
    let object = Unmanaged<AnyObject>.fromOpaque(handle).takeRetainedValue()
    (object as? NativeCapture)?.stop()
}

@_cdecl("misty_audio_string_free")
public func mistyAudioStringFree(_ value: UnsafeMutablePointer<CChar>?) {
    free(value)
}

@_cdecl("misty_audio_system_supported")
public func mistyAudioSystemSupported() -> Bool {
    if #available(macOS 14.2, *) { return true }
    return false
}
