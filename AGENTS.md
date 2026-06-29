# AGENTS.md — maya-ios

Instructions for the Capacitor iOS wrapper of MAYA / Мужская Эстетика.

## Scope

- Repo: `/Users/stanislavmosin/Desktop/maya-ios`
- Web source: `www/index.html`
- Native project: `ios/App/App.xcodeproj`
- Generated iOS public copy: `ios/App/App/public/index.html`
- Bundle id: `pro.malesthetic.app`
- Connected iPhone device id used in this workspace: `FF6F8003-99D2-5AED-A4CA-05BAE3877929`

## Source Of Truth

- Keep UI behavior aligned with platform PWA file:
  `/Users/stanislavmosin/Desktop/сайт и приложение/сайт и приложение/app.html`
- The detailed product/style/AI/backend guide lives in:
  `/Users/stanislavmosin/Desktop/сайт и приложение/AGENTS.md`
- When changing shared PWA UI, edit both `app.html` and `www/index.html`.

## Current Staff Chat Bubble

- Uses `MessageBubble({ side, children, tight })` inside `ATeamChat()`.
- Bubble body is a compact rounded rect; only the lower-corner tail is SVG.
- Incoming fill: `#e9e9eb`.
- Outgoing fill: `#34c759`, text white.
- Tail path: `M0.6 0C2.8 7.8 9.2 13.2 21.4 14.5C15.1 18.8 6.3 18.3 2 11.4C0.3 8.5-0.3 3.7 0.6 0Z`.
- Tail SVG viewBox: `0 0 22 18`, mirrored for incoming bubbles.
- Compact sizing: `minHeight: 35`, `borderRadius: 18.5`, `padding: 7px 15px 8px`.
- Message font stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif`.

## Build / Install

```bash
cd /Users/stanislavmosin/Desktop/maya-ios
npx cap sync ios
cmp -s www/index.html ios/App/App/public/index.html && echo 'www and iOS public match'
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'id=FF6F8003-99D2-5AED-A4CA-05BAE3877929' -derivedDataPath build/DerivedData -allowProvisioningUpdates build
xcrun devicectl device install app --device FF6F8003-99D2-5AED-A4CA-05BAE3877929 build/DerivedData/Build/Products/Debug-iphoneos/App.app
xcrun devicectl device process launch --device FF6F8003-99D2-5AED-A4CA-05BAE3877929 --terminate-existing pro.malesthetic.app
```

## Rules

- Do not edit generated `ios/App/App/public/index.html` directly; sync from `www`.
- Do not commit `build/DerivedData`.
- Verify inline JS syntax before build.
- Avoid changing Capacitor/native settings unless the task requires it.
