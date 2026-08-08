import Capacitor
import WebKit

@objc(MayaRuntimePlugin)
class MayaRuntimePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "MayaRuntimePlugin"
    let jsName = "MayaRuntime"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPreviewAccess", returnType: CAPPluginReturnPromise)
    ]

    @objc func getPreviewAccess(_ call: CAPPluginCall) {
#if DEBUG
        let apiBase = Self.resolvedPreviewApiBase()
        call.resolve(["enabled": true, "apiBase": apiBase, "build": "rc-debug-12"])
#else
        call.resolve(["enabled": false, "apiBase": "", "build": "release"])
#endif
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
        window.__ME_MAYA_OS_TENANT_SLUG = 'muzhskaya-estetika';
        window.__ME_MAYA_OS_BUILD = 'rc-debug-12';
        window.__ME_MAYA_OS_BOOTSTRAP_VERSION = 'native-v8-chat-api-fix';
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
