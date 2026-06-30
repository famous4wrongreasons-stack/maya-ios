import AVFoundation
import Capacitor

@objc(TeamVoicePlayerPlugin)
class TeamVoicePlayerPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioPlayerDelegate {
    let identifier = "TeamVoicePlayerPlugin"
    let jsName = "TeamVoicePlayer"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise)
    ]

    private var player: AVAudioPlayer?
    private var progressTimer: Timer?
    private var currentId = ""
    private var currentFileURL: URL?
    private var activeDownload: URLSessionDownloadTask?

    @objc func play(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let remoteURL = URL(string: urlString) else {
            call.reject("Missing voice URL")
            return
        }
        let id = call.getString("id") ?? urlString

        if id == currentId, let player = player {
            do {
                try prepareAudioSession()
                player.play()
                startProgressTimer()
                notifyState("playing")
                call.resolve(statePayload("playing"))
            } catch {
                call.reject("Unable to resume voice", nil, error)
            }
            return
        }

        stopCurrent(notify: true)
        currentId = id

        activeDownload?.cancel()
        let task = URLSession.shared.downloadTask(with: remoteURL) { [weak self] tempURL, response, error in
            guard let self else { return }
            if let error {
                self.rejectOnMain(call, message: "Unable to download voice", error: error)
                return
            }
            guard let tempURL else {
                self.rejectOnMain(call, message: "Voice download returned no file", error: nil)
                return
            }

            do {
                let fileURL = try self.copyVoiceTempFile(from: tempURL, response: response)
                DispatchQueue.main.async {
                    do {
                        try self.prepareAudioSession()
                        let player = try AVAudioPlayer(contentsOf: fileURL)
                        player.delegate = self
                        player.prepareToPlay()
                        self.player = player
                        self.currentFileURL = fileURL
                        player.play()
                        self.startProgressTimer()
                        self.notifyState("playing")
                        call.resolve(self.statePayload("playing"))
                    } catch {
                        self.rejectOnMain(call, message: "Unable to play voice", error: error)
                    }
                }
            } catch {
                self.rejectOnMain(call, message: "Unable to prepare voice", error: error)
            }
        }
        activeDownload = task
        task.resume()
    }

    @objc func pause(_ call: CAPPluginCall) {
        player?.pause()
        stopProgressTimer()
        notifyState("paused")
        call.resolve(statePayload("paused"))
    }

    @objc func stop(_ call: CAPPluginCall) {
        let requestedId = call.getString("id")
        if requestedId == nil || requestedId == currentId {
            stopCurrent(notify: true)
        }
        call.resolve(statePayload("stopped"))
    }

    @objc func getState(_ call: CAPPluginCall) {
        let status = player?.isPlaying == true ? "playing" : "paused"
        call.resolve(statePayload(status))
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        stopProgressTimer()
        player.currentTime = 0
        notifyState("ended", position: 0)
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        stopProgressTimer()
        notifyState("error", errorMessage: error?.localizedDescription ?? "Voice decode error")
    }

    private func prepareAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try session.setActive(true)
    }

    private func copyVoiceTempFile(from tempURL: URL, response: URLResponse?) throws -> URL {
        let ext = preferredExtension(response: response)
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("team_voice_\(UUID().uuidString)")
            .appendingPathExtension(ext)
        try? FileManager.default.removeItem(at: fileURL)
        try FileManager.default.copyItem(at: tempURL, to: fileURL)
        return fileURL
    }

    private func preferredExtension(response: URLResponse?) -> String {
        guard let mime = response?.mimeType?.lowercased() else { return "m4a" }
        if mime.contains("wav") { return "wav" }
        if mime.contains("mpeg") || mime.contains("mp3") { return "mp3" }
        if mime.contains("aac") || mime.contains("mp4") || mime.contains("m4a") { return "m4a" }
        return "m4a"
    }

    private func startProgressTimer() {
        stopProgressTimer()
        progressTimer = Timer.scheduledTimer(withTimeInterval: 0.12, repeats: true) { [weak self] _ in
            self?.notifyState("progress")
        }
        if let progressTimer {
            RunLoop.main.add(progressTimer, forMode: .common)
        }
    }

    private func stopProgressTimer() {
        progressTimer?.invalidate()
        progressTimer = nil
    }

    private func stopCurrent(notify: Bool) {
        activeDownload?.cancel()
        activeDownload = nil
        stopProgressTimer()
        player?.stop()
        player = nil
        if let currentFileURL {
            try? FileManager.default.removeItem(at: currentFileURL)
        }
        currentFileURL = nil
        if notify, !currentId.isEmpty {
            notifyState("stopped", position: 0)
        }
    }

    private func notifyState(_ status: String, position: Double? = nil, errorMessage: String? = nil) {
        notifyListeners("state", data: statePayload(status, position: position, errorMessage: errorMessage))
    }

    private func statePayload(_ status: String, position: Double? = nil, errorMessage: String? = nil) -> [String: Any] {
        let duration = player?.duration ?? 0
        let current = position ?? player?.currentTime ?? 0
        var data: [String: Any] = [
            "id": currentId,
            "status": status,
            "currentTime": current,
            "duration": duration,
            "position": duration > 0 ? min(max(current / duration, 0), 1) : 0
        ]
        if let errorMessage {
            data["error"] = errorMessage
        }
        return data
    }

    private func rejectOnMain(_ call: CAPPluginCall, message: String, error: Error?) {
        DispatchQueue.main.async {
            self.notifyState("error", errorMessage: error?.localizedDescription ?? message)
            call.reject(message, nil, error)
        }
    }
}
