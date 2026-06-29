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
- Outgoing fill: `#2fcc59`, text white.
- Tail path from Figma iMessage reference: `M10.0206 12.9416C9.78651 11.7287 9.66391 10.4761 9.66391 9.19488V0.402926H29.3165V28.8475C24.5575 28.8475 20.1936 27.1559 16.7932 24.3413C13.4008 26.6012 7.96114 28.7495 1.38911 27.5546C3.19922 26.7788 10.1811 22.1243 9.92249 12.8151C9.95387 12.8583 9.9866 12.9004 10.0206 12.9416Z`.
- Tail SVG viewBox: `0 0 29.7195 29.2504`, mirrored for outgoing bubbles.
- Keep `fillRule: 'evenodd'` and `clipRule: 'evenodd'` on the tail path to avoid artifacts near the tail join.
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
