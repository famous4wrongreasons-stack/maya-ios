import Capacitor
import CoreNFC

// Enable MAYA_NFC_WRITER and the NFC entitlement after moving to a paid Apple Developer team.
@objc(MayaNfcWriterPlugin)
class MayaNfcWriterPlugin: CAPPlugin, CAPBridgedPlugin, NFCNDEFReaderSessionDelegate {
    let identifier = "MayaNfcWriterPlugin"
    let jsName = "MayaNfcWriter"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "writeUrl", returnType: CAPPluginReturnPromise)
    ]

    private var session: NFCNDEFReaderSession?
    private var pendingCall: CAPPluginCall?
    private var pendingURL: URL?

    @objc func writeUrl(_ call: CAPPluginCall) {
        guard pendingCall == nil else {
            call.reject("NFC write is already in progress", "nfc_busy")
            return
        }
        guard NFCNDEFReaderSession.readingAvailable else {
            call.reject("NFC is not available on this iPhone", "nfc_unavailable")
            return
        }
        guard
            let rawURL = call.getString("url"),
            let url = URL(string: rawURL),
            let scheme = url.scheme?.lowercased(),
            scheme == "https" || scheme == "http"
        else {
            call.reject("A valid HTTPS link is required", "nfc_invalid_url")
            return
        }

        pendingCall = call
        pendingURL = url

        DispatchQueue.main.async {
            let session = NFCNDEFReaderSession(
                delegate: self,
                queue: nil,
                invalidateAfterFirstRead: false
            )
            session.alertMessage = "Поднесите NFC-метку к верхней части iPhone."
            self.session = session
            session.begin()
        }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        guard pendingCall != nil else { return }
        let nsError = error as NSError
        let cancelled =
            nsError.code == NFCReaderError.readerSessionInvalidationErrorUserCanceled.rawValue
        finishWithError(
            cancelled ? "NFC write was cancelled" : "NFC session ended before the tag was written",
            code: cancelled ? "nfc_cancelled" : "nfc_session_failed",
            error: error
        )
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        // Tag writing is handled by readerSession(_:didDetect:) on iOS 13+.
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard tags.count == 1 else {
            session.alertMessage = "Оставьте рядом с iPhone только одну NFC-метку."
            session.restartPolling()
            return
        }
        guard let url = pendingURL else {
            session.invalidate(errorMessage: "Ссылка бизнеса не найдена.")
            finishWithError("Business link is missing", code: "nfc_invalid_url")
            return
        }

        let tag = tags[0]
        session.connect(to: tag) { [weak self] error in
            guard let self else { return }
            if let error {
                session.invalidate(errorMessage: "Не удалось прочитать метку. Попробуйте ещё раз.")
                self.finishWithError("Unable to connect to NFC tag", code: "nfc_connect_failed", error: error)
                return
            }

            tag.queryNDEFStatus { status, capacity, error in
                if let error {
                    session.invalidate(errorMessage: "Не удалось проверить метку.")
                    self.finishWithError("Unable to inspect NFC tag", code: "nfc_status_failed", error: error)
                    return
                }
                guard status == .readWrite else {
                    let message = status == .readOnly
                        ? "Эта NFC-метка защищена от записи."
                        : "Эта метка не поддерживает формат NDEF."
                    session.invalidate(errorMessage: message)
                    self.finishWithError(message, code: status == .readOnly ? "nfc_read_only" : "nfc_not_supported")
                    return
                }
                guard let payload = NFCNDEFPayload.wellKnownTypeURIPayload(url: url) else {
                    session.invalidate(errorMessage: "Не удалось подготовить ссылку.")
                    self.finishWithError("Unable to create NFC URL payload", code: "nfc_payload_failed")
                    return
                }

                let message = NFCNDEFMessage(records: [payload])
                guard message.length <= capacity else {
                    session.invalidate(errorMessage: "Для этой ссылки нужна NFC-метка большего объёма.")
                    self.finishWithError("NFC tag capacity is too small", code: "nfc_capacity_too_small")
                    return
                }

                tag.writeNDEF(message) { error in
                    if let error {
                        session.invalidate(errorMessage: "Не удалось записать метку. Попробуйте другую.")
                        self.finishWithError("Unable to write NFC tag", code: "nfc_write_failed", error: error)
                        return
                    }
                    session.alertMessage = "Готово. Метка откроет приложение вашего бизнеса."
                    self.finishSuccessfully(url: url)
                    session.invalidate()
                }
            }
        }
    }

    private func finishSuccessfully(url: URL) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        pendingURL = nil
        session = nil
        DispatchQueue.main.async {
            call.resolve(["ok": true, "url": url.absoluteString])
        }
    }

    private func finishWithError(_ message: String, code: String, error: Error? = nil) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        pendingURL = nil
        session = nil
        DispatchQueue.main.async {
            call.reject(message, code, error)
        }
    }
}
