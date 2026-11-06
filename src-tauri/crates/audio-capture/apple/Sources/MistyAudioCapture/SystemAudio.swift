import AVFoundation
import CoreAudio
import Foundation

/// System or per-process audio through a Core Audio process tap on a private
/// aggregate device (macOS 14.2+).
/// The tap copies audio; what the user hears is unchanged.
@available(macOS 14.2, *)
final class SystemAudioCapture: NativeCapture {
    private var tap: AudioObjectID = 0
    private var device: AudioObjectID = 0
    private var io: AudioDeviceIOProcID?
    private var listener: AudioObjectPropertyListenerBlock?
    private let delivery: PCMDelivery
    private let queue = DispatchQueue(label: "misty.audio.system-audio")
    private var outputAddress = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)

    init(delivery: PCMDelivery) { self.delivery = delivery }

    func start(processes: [AudioObjectID], excludeSelf: Bool) throws {
        func check(_ code: OSStatus) throws {
            if code != noErr { throw NSError(domain: "CoreAudio", code: Int(code)) }
        }
        do {
            let description: CATapDescription
            if processes.isEmpty {
                let own = excludeSelf ? processObject(getpid()) : nil
                description = CATapDescription(monoGlobalTapButExcludeProcesses: own.map { [$0] } ?? [])
            } else {
                description = CATapDescription(monoMixdownOfProcesses: processes)
            }
            description.name = "Misty capture"
            description.isPrivate = true
            description.muteBehavior = .unmuted
            try check(AudioHardwareCreateProcessTap(description, &tap))

            var asbd = AudioStreamBasicDescription()
            var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            var address = AudioObjectPropertyAddress(
                mSelector: kAudioTapPropertyFormat,
                mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            try check(AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &asbd))
            guard let format = AVAudioFormat(streamDescription: &asbd),
                  let output = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
                  let converter = AVAudioConverter(from: format, to: output) else {
                throw NSError(domain: "MistyAudioCapture", code: Int(CaptureStatus.device.rawValue))
            }
            let aggregate: [String: Any] = [
                kAudioAggregateDeviceNameKey: "Misty private capture",
                kAudioAggregateDeviceUIDKey: UUID().uuidString,
                kAudioAggregateDeviceIsPrivateKey: true,
                kAudioAggregateDeviceTapAutoStartKey: true,
                kAudioAggregateDeviceTapListKey: [[
                    kAudioSubTapUIDKey: description.uuid.uuidString,
                    kAudioSubTapDriftCompensationKey: true,
                ]],
            ]
            try check(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device))
            let delivery = self.delivery
            try check(AudioDeviceCreateIOProcIDWithBlock(&io, device, queue) { _, input, _, _, _ in
                let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
                guard let first = list.first, first.mData != nil, asbd.mBytesPerFrame > 0 else { return }
                let frames = first.mDataByteSize / asbd.mBytesPerFrame
                guard frames > 0,
                      let buffer = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: input),
                      let pcm = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: AVAudioFrameCount(ceil(Double(frames) * 16000 / format.sampleRate) + 32))
                else { return }
                buffer.frameLength = frames
                var supplied = false
                var error: NSError?
                converter.convert(to: pcm, error: &error) { _, status in
                    if supplied { status.pointee = .noDataNow; return nil }
                    supplied = true; status.pointee = .haveData; return buffer
                }
                guard error == nil, let samples = pcm.int16ChannelData?[0], pcm.frameLength > 0 else { return }
                delivery.send(samples, count: Int(pcm.frameLength))
            })
            // A new default output device invalidates the tap; report it.
            let listener: AudioObjectPropertyListenerBlock = { _, _ in delivery.fail() }
            self.listener = listener
            try check(AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &outputAddress, queue, listener))
            try check(AudioDeviceStart(device, io))
        } catch { stop(); throw error }
    }

    func stop() {
        delivery.close()
        if let listener {
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &outputAddress, queue, listener)
            self.listener = nil
        }
        if let io { AudioDeviceStop(device, io); AudioDeviceDestroyIOProcID(device, io) }
        io = nil
        if device != 0 { AudioHardwareDestroyAggregateDevice(device); device = 0 }
        if tap != 0 { AudioHardwareDestroyProcessTap(tap); tap = 0 }
    }
}

/// The Core Audio process object for a PID, or nil when that process has
/// never opened audio.
func processObject(_ pid: pid_t) -> AudioObjectID? {
    var pid = pid
    var object: AudioObjectID = 0
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    let status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &address,
        UInt32(MemoryLayout<pid_t>.size), &pid, &size, &object)
    return status == noErr && object != 0 ? object : nil
}

@_cdecl("misty_audio_system_start")
public func mistyAudioSystemStart(
    _ pids: UnsafePointer<Int32>?,
    _ count: Int,
    _ excludeSelf: Bool,
    _ context: UnsafeMutableRawPointer?,
    _ callback: @escaping PCMCallback,
    _ status: UnsafeMutablePointer<Int32>
) -> UnsafeMutableRawPointer? {
    guard #available(macOS 14.2, *) else { status.pointee = CaptureStatus.unsupported.rawValue; return nil }
    var processes: [AudioObjectID] = []
    if let pids, count > 0 {
        processes = UnsafeBufferPointer(start: pids, count: count).compactMap { processObject($0) }
        guard !processes.isEmpty else { status.pointee = CaptureStatus.noSuchProcess.rawValue; return nil }
    }
    let capture = SystemAudioCapture(delivery: PCMDelivery(context: context, callback: callback))
    do {
        try capture.start(processes: processes, excludeSelf: excludeSelf)
        status.pointee = CaptureStatus.ok.rawValue
        return retain(capture)
    } catch let error as NSError {
        // A refused tap means the user has not allowed audio capture.
        let denied = error.domain == "CoreAudio" && error.code == Int(kAudioHardwareIllegalOperationError)
        status.pointee = denied ? CaptureStatus.denied.rawValue : CaptureStatus.device.rawValue
        return nil
    }
}
