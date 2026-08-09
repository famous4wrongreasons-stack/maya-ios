# Cursor task: native visual QA for PR #9

## Context

- Repository: https://github.com/famous4wrongreasons-stack/maya-ios
- Main feature PR: https://github.com/famous4wrongreasons-stack/maya-ios/pull/9
- Scope: native iOS application only.
- Do not edit or deploy the PWA.

The server-owned `app_access` contract is already the only source of truth for
native modes (`owner`, `staff`, `client`, `platform`). Security hardening,
logout cleanup, preview isolation, dependency fixes, and native verification
tests are handled by Codex. Do not replace them with local role inference.

## Your task

Perform visual QA on a real iPhone and make only small presentation fixes if a
screen is visibly broken:

1. A fresh multi-mode login shows the mode chooser before opening a workspace.
2. Owner, staff, and client options fit narrow and large iPhone screens.
3. The persistent black `Сменить режим` control is visible only when
   `can_switch_mode` is true and does not cover bottom navigation.
4. Owner opens the full existing business interface.
5. Staff opens the personal staff interface.
6. `client + granted` opens the real client cabinet.
7. `client + preview` opens only the public preview and clearly explains that
   personal history and loyalty are unavailable.
8. The compatibility screen for missing `app_access` is readable and offers a
   safe retry/logout path; it must never open an owner or staff screen.
9. Logout returns to login, and reopening the app does not restore the previous
   tenant workspace.

Attach screenshots for the chooser, each available mode, preview, and the
compatibility screen. Report any missing server mode as a backend contract
problem instead of inventing a local fallback.

## Guardrails

- Do not modify `meAppAccessNormalize`, `meAppAccessResolveFromMe`,
  `meAppAccessRouteAfterMe`, `meAuthRoute`, tenant-session cleanup, onboarding
  owner verification, or preview data hydration.
- Do not infer access from `role`, Telegram ID, email, phone, cached workspace,
  or a YClients token.
- Do not expose `/customer-portal`, `/appointments/my`, `/loyalty/me`, or other
  personal CRM data in `client + preview`.
- Do not add localStorage flags that grant owner or staff access.
- Do not touch the platform/PWA repository.
- Keep MAYA's existing black-and-white native visual language.

## Required verification

```bash
npm ci
npm test
npm audit --audit-level=high
npx cap sync ios
cmp -s www/index.html ios/App/App/public/index.html
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

Return one commit containing only native visual fixes and screenshots/notes.
