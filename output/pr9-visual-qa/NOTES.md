# PR #9 native visual QA

## Scope
Presentation-only QA for mode chooser / switch / owner / staff / client / preview / compatibility.
No changes to `app_access` resolve/route, auth, logout, or preview data hydration.

## Device
- Installed Debug build on **iPhone Mo** `FF6F8003-99D2-5AED-A4CA-05BAE3877929` (iPhone 17 Pro Max).
- Screenshot evidence captured from the same `www` bundle at iPhone viewports **375×812** and **430×932**.

## Presentation fixes in this commit
1. Mode chooser: scrollable column, compact logo on short screens, max-width 420, safer text wrapping for 3 modes.
2. `Сменить режим`: raised above bottom nav (`+96px`), excluded from chat (composer overlap), ellipsis-safe label.
3. Client preview: home banner + clearer cabinet copy that history/loyalty/PII are unavailable.
4. Compatibility screen: safe-area padding, explicit “rights are not granted locally”, retry + logout.

## Checklist
| # | Scenario | Result |
|---|---|---|
| 1 | Fresh multi-mode → chooser | Pass (`01`, `08`) |
| 2 | Owner/staff/client options fit narrow + large | Pass |
| 3 | Black `Сменить режим` only with `can_switch_mode`, above tab bar | Pass (`05`, `06`, `09`) |
| 4 | Owner full business home | Pass (`02`, `09`) |
| 5 | Staff personal home labels | Pass (`03`) |
| 6 | `client + granted` real cabinet | Pass (`04`) |
| 7 | `client + preview` public preview + explanation | Pass (`05`, `06`) |
| 8 | Missing `app_access` compat screen | Pass (`07`) |
| 9 | Logout / session restore | Covered by prior hardening (#10); not re-opened here |

## Screenshots
- `01-chooser-narrow-375.png`
- `02-owner-staff-home-narrow.png`
- `03-staff-home-narrow.png`
- `04-client-granted-cabinet-narrow.png`
- `05-client-preview-home-narrow.png`
- `06-client-preview-cabinet-narrow.png`
- `07-access-compat-narrow.png`
- `08-chooser-large-430.png`
- `09-owner-with-switch-large.png`

## Backend note
Harness uses a fake token, so owner/staff homes may show honest “profile refresh unavailable” instead of live CRM numbers. That is expected and is not a local privilege fallback.
