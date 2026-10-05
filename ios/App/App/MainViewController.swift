import Capacitor
import Foundation
import SafariServices
import UIKit
import WebKit

@objc(MayaRuntimePlugin)
class MayaRuntimePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "MayaRuntimePlugin"
    let jsName = "MayaRuntime"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPreviewAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkTipsAvailability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openTipsURL", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadRemoteImage", returnType: CAPPluginReturnPromise)
    ]

    @objc func getPreviewAccess(_ call: CAPPluginCall) {
#if DEBUG
        let apiBase = Self.resolvedPreviewApiBase()
        call.resolve(["enabled": true, "apiBase": apiBase, "build": "rc-debug-15"])
#else
        call.resolve(["enabled": false, "apiBase": "", "build": "release"])
#endif
    }

    @objc func checkTipsAvailability(_ call: CAPPluginCall) {
        var targets: [String: URL] = [
            "yookassa": URL(string: "https://yookassa.ru/checkout-widget/v1/checkout-widget.js")!,
            "yoomoney": URL(string: "https://yoomoney.ru/checkout/checkout-ui")!
        ]
        if let rawURL = call.getString("url"),
           let tipsURL = URL(string: rawURL),
           tipsURL.scheme == "https",
           tipsURL.host == "yclients.com" {
            targets["yclients"] = tipsURL
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 7
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let session = URLSession(configuration: configuration)
        let group = DispatchGroup()
        let lock = NSLock()
        var checks: [String: Bool] = [:]

        for (name, url) in targets {
            group.enter()
            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.setValue("bytes=0-0", forHTTPHeaderField: "Range")
            request.setValue("MAYA-iOS", forHTTPHeaderField: "User-Agent")
            session.dataTask(with: request) { _, response, error in
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let reachable = error == nil && status >= 200 && status < 500
                lock.lock()
                checks[name] = reachable
                lock.unlock()
                group.leave()
            }.resume()
        }

        group.notify(queue: .main) {
            session.finishTasksAndInvalidate()
            let yclients = checks["yclients"] ?? true
            let yookassa = checks["yookassa"] == true
            let yoomoney = checks["yoomoney"] == true
            call.resolve([
                "available": yclients && yookassa && yoomoney,
                "yclients": yclients,
                "yookassa": yookassa,
                "yoomoney": yoomoney
            ])
        }
    }

    @objc func openTipsURL(_ call: CAPPluginCall) {
        guard let rawURL = call.getString("url"),
              let url = URL(string: rawURL),
              url.scheme == "https",
              let host = url.host?.lowercased(),
              host == "yclients.com" || host.hasSuffix(".yclients.com") else {
            call.reject("Invalid YClients tips URL")
            return
        }

        DispatchQueue.main.async {
            // A system handoff is more reliable than loading the payment page in WKWebView:
            // YClients/YooKassa can redirect through hosts that reject embedded browsers.
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve(["opened": true])
                    return
                }
                guard var presenter = self.bridge?.viewController else {
                    call.reject("MAYA cannot open the tips page")
                    return
                }
                while let presented = presenter.presentedViewController {
                    presenter = presented
                }
                let safari = SFSafariViewController(url: url)
                safari.modalPresentationStyle = .fullScreen
                safari.dismissButtonStyle = .done
                presenter.present(safari, animated: true) {
                    call.resolve(["opened": true])
                }
            }
        }
    }

    @objc func loadRemoteImage(_ call: CAPPluginCall) {
        guard let rawURL = call.getString("url"),
              let url = URL(string: rawURL),
              url.scheme == "https",
              let host = url.host?.lowercased(),
              Self.isAllowedAvatarHost(host) else {
            call.reject("Invalid avatar URL")
            return
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 10
        configuration.requestCachePolicy = .reloadRevalidatingCacheData
        let session = URLSession(configuration: configuration)
        var request = URLRequest(url: url)
        request.setValue("MAYA-iOS", forHTTPHeaderField: "User-Agent")
        session.dataTask(with: request) { data, response, error in
            defer { session.finishTasksAndInvalidate() }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let mimeType = String(response?.mimeType ?? "").lowercased()
            let responseHost = response?.url?.host?.lowercased() ?? ""
            guard error == nil,
                  status >= 200 && status < 300,
                  Self.isAllowedAvatarHost(responseHost),
                  mimeType.hasPrefix("image/"),
                  let data,
                  !data.isEmpty,
                  data.count <= 2_000_000 else {
                DispatchQueue.main.async { call.reject("Avatar image is unavailable") }
                return
            }
            let dataURL = "data:\(mimeType);base64,\(data.base64EncodedString())"
            DispatchQueue.main.async { call.resolve(["dataURL": dataURL]) }
        }.resume()
    }

    private static func isAllowedAvatarHost(_ host: String) -> Bool {
        host == "t.me" || host.hasSuffix(".t.me") ||
        host == "telesco.pe" || host.hasSuffix(".telesco.pe") ||
        host == "telegram.org" || host.hasSuffix(".telegram.org") ||
        host == "telegram-cdn.org" || host.hasSuffix(".telegram-cdn.org")
    }

#if DEBUG
    /// Пустой $(MAYA_OS_PREVIEW_API_BASE) раньше оставлял API пустым → JS падал на
    /// Capacitor-origin `https://malesthetic.pro/api` → чат «не связаться», AuditLog пуст.
    fileprivate static func resolvedPreviewApiBase() -> String {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "MayaOSPreviewAPIBase") as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        if raw.isEmpty { return "https://mayaos.ru/api" }
        if raw.hasPrefix("http://localhost") || raw.hasPrefix("http://127.0.0.1") {
            return "https://mayaos.ru/api"
        }
        return raw
    }
#endif
}

class MainViewController: CAPBridgeViewController {
#if DEBUG
    private func mayaPreviewBootstrap() -> String {
        let apiBase = MayaRuntimePlugin.resolvedPreviewApiBase()
        let apiBaseJSON: String
        if let data = try? JSONSerialization.data(withJSONObject: apiBase, options: [.fragmentsAllowed]),
           let value = String(data: data, encoding: .utf8) {
            apiBaseJSON = value
        } else {
            apiBaseJSON = "\"https://mayaos.ru/api\""
        }

        return """
        window.__ME_MAYA_OS_PREVIEW = true;
        window.__ME_MAYA_OS_API_BASE = \(apiBaseJSON);
        window.__ME_MAYA_OS_TENANT_SLUG = 'muzhskaya-estetika-3';
        window.__ME_MAYA_OS_BUILD = 'rc-debug-16-owner-login';
        window.__ME_MAYA_OS_BOOTSTRAP_VERSION = 'native-v10-owner-canonical-oauth';
        try {
            if (window.__ME_MAYA_OS_API_BASE) {
                var previousBootstrap = localStorage.getItem('me_native_bootstrap_version');
                if (previousBootstrap !== window.__ME_MAYA_OS_BOOTSTRAP_VERSION) {
                    // RC: сброс stale localhost / чужого api base при смене bootstrap.
                    localStorage.clear();
                    sessionStorage.clear();
                }
                localStorage.setItem('me_booking_backend', 'saas-local');
                localStorage.setItem('me_booking_api_base', window.__ME_MAYA_OS_API_BASE);
                var savedTenant = String(localStorage.getItem('me_booking_tenant_slug') || '').toLowerCase();
                if (!savedTenant || savedTenant === 'maya-os') {
                    localStorage.setItem('me_booking_tenant_slug', window.__ME_MAYA_OS_TENANT_SLUG);
                }
                localStorage.setItem('me_native_bootstrap_version', window.__ME_MAYA_OS_BOOTSTRAP_VERSION);
            }
        } catch (error) {}
        true;
        """
    }
#endif

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
#if DEBUG
        configuration.userContentController.addUserScript(
            WKUserScript(source: mayaPreviewBootstrap(), injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
#endif
        return super.webView(with: frame, configuration: configuration)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
#if DEBUG
        webView?.evaluateJavaScript(mayaPreviewBootstrap()) { result, error in
            let enabled = (result as? Bool) == true && error == nil
            print("MAYA RC preview access: \(enabled ? "enabled" : "failed") api=\(MayaRuntimePlugin.resolvedPreviewApiBase())")
        }
#endif
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MayaRuntimePlugin())
        bridge?.registerPluginInstance(TeamVoicePlayerPlugin())
        bridge?.registerPluginInstance(MayaVoiceRecorderPlugin())
#if MAYA_NFC_WRITER
        bridge?.registerPluginInstance(MayaNfcWriterPlugin())
#endif
    }
}
