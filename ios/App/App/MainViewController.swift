import Capacitor

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(TeamVoicePlayerPlugin())
#if MAYA_NFC_WRITER
        bridge?.registerPluginInstance(MayaNfcWriterPlugin())
#endif
    }
}
