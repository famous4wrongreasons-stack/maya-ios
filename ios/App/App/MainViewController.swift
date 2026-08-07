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
        let apiBase = Bundle.main.object(forInfoDictionaryKey: "MayaOSPreviewAPIBase") as? String ?? ""
        call.resolve(["enabled": true, "apiBase": apiBase, "build": "rc-debug-11"])
#else
        call.resolve(["enabled": false, "apiBase": "", "build": "release"])
#endif
    }
}

class MainViewController: CAPBridgeViewController {
#if DEBUG
    private func mayaPreviewBootstrap() -> String {
        let apiBase = Bundle.main.object(forInfoDictionaryKey: "MayaOSPreviewAPIBase") as? String ?? ""
        let apiBaseJSON: String
        if let data = try? JSONSerialization.data(withJSONObject: apiBase, options: [.fragmentsAllowed]),
           let value = String(data: data, encoding: .utf8) {
            apiBaseJSON = value
        } else {
            apiBaseJSON = "\"\""
        }

        return """
        window.__ME_MAYA_OS_PREVIEW = true;
        window.__ME_MAYA_OS_API_BASE = \(apiBaseJSON);
        window.__ME_MAYA_OS_TENANT_SLUG = 'muzhskaya-estetika';
        window.__ME_MAYA_OS_BUILD = 'rc-debug-11';
        window.__ME_MAYA_OS_BOOTSTRAP_VERSION = 'native-v7-platform-bootstrap';
        try {
            if (window.__ME_MAYA_OS_API_BASE) {
                var previousBootstrap = localStorage.getItem('me_native_bootstrap_version');
                if (previousBootstrap !== window.__ME_MAYA_OS_BOOTSTRAP_VERSION) {
                    // This intentionally resettable RC build must start onboarding
                    // without identities, tenants or workspace choices from older tests.
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
            print("MAYA RC preview access: \(enabled ? "enabled" : "failed")")
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
