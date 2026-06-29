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
- Background is inline SVG path from reference, not CSS triangle/pseudo-element tail.
- Incoming fill: `#E5E5E5`.
- Outgoing fill: `#DCF8C6`.
- SVG viewBox: `0 0 132 40`.
- Right bubble mirrors path with `translate(132 0) scale(-1 1)`.
- Compact sizing: `minHeight: 40`.
- Padding:
  - right: `9px 30px 10px 26px`
  - left: `9px 26px 10px 30px`
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

