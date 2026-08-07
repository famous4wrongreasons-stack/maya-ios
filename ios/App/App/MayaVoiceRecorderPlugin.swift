import AVFoundation
import Capacitor

@objc(MayaVoiceRecorderPlugin)
class MayaVoiceRecorderPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioRecorderDelegate {
    let identifier = "MayaVoiceRecorderPlugin"
    let jsName = "MayaVoiceRecorder"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var startedAt: Date?

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.requestMicrophonePermission { granted in
                DispatchQueue.main.async {
                    guard granted else {
                        call.reject("Microphone permission denied")
                        return
                    }

                    do {
                        try self.startRecording()
                        call.resolve(["recording": true])
                    } catch {
                        self.cleanup(deleteFile: true)
                        call.reject("Unable to start voice recording", nil, error)
                    }
                }
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let recorder = self.recorder, let url = self.recordingURL else {
                call.reject("No active voice recording")
                return
            }

            recorder.stop()
            let duration = self.startedAt.map { Date().timeIntervalSince($0) } ?? 0

            do {
                let data = try Data(contentsOf: url)
                guard data.count > 44 else {
                    self.cleanup(deleteFile: true)
                    call.reject("Voice recording is empty")
                    return
                }

                let dataURL = "data:audio/wav;base64,\(data.base64EncodedString())"
                let payload: [String: Any] = [
                    "dataUrl": dataURL,
                    "mimeType": "audio/wav",
                    "size": data.count,
                    "duration": duration
                ]
                self.cleanup(deleteFile: true)
                call.resolve(payload)
            } catch {
                self.cleanup(deleteFile: true)
                call.reject("Unable to read voice recording", nil, error)
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.cleanup(deleteFile: true)
            call.resolve(["cancelled": true])
        }
    }

    private func requestMicrophonePermission(_ completion: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted:
                completion(true)
            case .denied:
                completion(false)
            case .undetermined:
                AVAudioApplication.requestRecordPermission(completionHandler: completion)
            @unknown default:
                completion(false)
            }
            return
        }

        let session = AVAudioSession.sharedInstance()
        switch session.recordPermission {
        case .granted:
            completion(true)
        case .denied:
            completion(false)
        case .undetermined:
            session.requestRecordPermission(completion)
        @unknown default:
            completion(false)
        }
    }

    private func startRecording() throws {
        cleanup(deleteFile: true)

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try session.setPreferredSampleRate(16_000)
        try session.setActive(true)

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("maya_voice_\(UUID().uuidString)")
            .appendingPathExtension("wav")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false
        ]

        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.delegate = self
        recorder.isMeteringEnabled = false
        guard recorder.prepareToRecord(), recorder.record(forDuration: 20) else {
            throw NSError(
                domain: "MayaVoiceRecorder",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "AVAudioRecorder did not start"]
            )
        }

        self.recorder = recorder
        recordingURL = url
        startedAt = Date()
    }

    private func cleanup(deleteFile: Bool) {
        recorder?.stop()
        recorder = nil
        startedAt = nil

        if deleteFile, let recordingURL {
            try? FileManager.default.removeItem(at: recordingURL)
        }
        recordingURL = nil

        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: [.notifyOthersOnDeactivation])
    }
}
