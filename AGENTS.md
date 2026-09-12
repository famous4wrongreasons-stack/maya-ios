# AGENTS.md — maya-ios (MAYA OS)

Instructions for the Capacitor native wrapper of **MAYA OS** (`mayaos.ru`).

## Scope

- Repo: `/Users/stanislavmosin/Desktop/maya-ios`
- Web source: `www/index.html`
- Native project: `ios/App/App.xcodeproj`
- Generated iOS public copy: `ios/App/App/public/index.html`
- Bundle id: `ru.mayaos.app`
- App display name: `MAYA OS`
- Capacitor hostname: `mayaos.ru`
- Deep links: `mayaos://` and `ru.mayaos.app://`
- Connected iPhone device id used in this workspace: `FF6F8003-99D2-5AED-A4CA-05BAE3877929`

## Source Of Truth

- Platform SaaS API: `https://mayaos.ru/api`
- Legacy salon PWA (Мужская Эстетика) remains separate:
  `/Users/stanislavmosin/Desktop/сайт и приложение/сайт и приложение/app.html`
- When changing shared UI that should also live in the salon PWA, edit both
  `app.html` and `www/index.html`.

## Apple Developer (required for first MAYA OS install)

1. Create App ID `ru.mayaos.app` with **Push Notifications** (and NFC if needed).
2. Create APNs Auth Key (`.p8`) → Nest env `APNS_KEY_ID` + `APNS_KEY_PATH` / `APNS_KEY_P8`.
3. Sign into Xcode → Accounts with team `YCL5U4L56W`.
4. Build installs as a **new app** next to old `pro.malesthetic.app` (different bundle).

## Build / install

```bash
cd /Users/stanislavmosin/Desktop/maya-ios
npx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'id=FF6F8003-99D2-5AED-A4CA-05BAE3877929' \
  -derivedDataPath build/DerivedData -allowProvisioningUpdates build
xcrun devicectl device install app --device FF6F8003-99D2-5AED-A4CA-05BAE3877929 \
  build/DerivedData/Build/Products/Debug-iphoneos/App.app
xcrun devicectl device process launch --device FF6F8003-99D2-5AED-A4CA-05BAE3877929 \
  --terminate-existing ru.mayaos.app
```

After sync confirm: `cmp -s www/index.html ios/App/App/public/index.html`
