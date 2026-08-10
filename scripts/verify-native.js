'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('www/index.html', 'utf8');

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.trim());

for (const [index, source] of inlineScripts.entries()) {
  try {
    new Function(source);
  } catch (error) {
    throw new Error(`Inline script ${index + 1} does not parse: ${error.message}`);
  }
}

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }
}

const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();
const routed = [];
let bundleUser = null;

const windowObject = {
  __ME_SAAS_CTX: { ns: 'test', api: 'https://api.example.test' },
  __meGo: (screen) => routed.push(screen),
  __meMode: () => {},
  __meRefresh: () => {},
};

const context = {
  window: windowObject,
  localStorage,
  sessionStorage,
  console,
  fetch: () => Promise.reject(new Error('network disabled in unit test')),
  meSaasCurrentBundle: () => (bundleUser ? { token: 'token', user: bundleUser } : null),
  meSaasCurrentRole: () => 'tenant_owner',
  meSaasIsManagerRole: () => true,
  meSaasIsBusinessRole: () => true,
  meSaasIsClientWorkspace: () => false,
  meSaasStoreUser: (user) => {
    bundleUser = user;
    return { token: 'token', user };
  },
  meSaasHasStaffProfile: (user) => !!(user && user.staff_profile && user.staff_profile.linked),
  meSaasApplyIdentity: () => true,
  meSaasSetWorkspace: () => {},
  meSaasClearWorkspace: () => {},
  meSaasClearChatSurface: () => {},
  meSaasRememberChatSurface: () => {},
  meSaasBusinessEntryScreen: () => 'staff-home',
  meWidgetAf: () => Promise.reject(new Error('not used')),
};
windowObject.window = windowObject;

const accessStart = html.indexOf('// ── Server-owned native app modes');
const accessEnd = html.indexOf('// Maya OS 3A:', accessStart);
assert.ok(accessStart >= 0 && accessEnd > accessStart, 'app_access implementation block is present');
vm.createContext(context);
vm.runInContext(html.slice(accessStart, accessEnd), context);

function mode(modeName, access = 'granted', linked = true) {
  return {
    mode: modeName,
    access,
    tenant_id: 'tenant-1',
    role: 'tenant_owner',
    profile_linked: linked,
  };
}

function userWith(modes, extra = {}) {
  return Object.assign({
    id: 'user-1',
    role: 'tenant_owner',
    tenant: { id: 'tenant-1', slug: 'test' },
    staff_profile: { linked: true, external_staff_id: 'staff-1' },
    app_access: {
      schema_version: 1,
      default_mode: modes.length ? modes[0].mode : null,
      available_modes: modes,
      can_switch_mode: modes.length > 1,
      chooser_required: modes.length > 1,
    },
  }, extra);
}

const multiModeUser = userWith([
  mode('owner'),
  mode('staff'),
  mode('client', 'preview', false),
]);

assert.equal(context.meAppAccessNormalize(multiModeUser.app_access).available_modes.length, 3);
assert.equal(context.meAppAccessNormalize({
  schema_version: 1,
  default_mode: 'owner',
  available_modes: [{ mode: 'owner' }],
}), null, 'missing access level is rejected');
assert.equal(context.meAppAccessNormalize({
  schema_version: 1,
  default_mode: 'owner',
  available_modes: [mode('owner'), mode('owner')],
}), null, 'duplicate modes are rejected');
assert.equal(context.meAppAccessNormalize({
  schema_version: 1,
  default_mode: 'owner',
  available_modes: [mode('owner', 'preview')],
}), null, 'preview cannot grant a business mode');

let resolved = context.meAppAccessResolveFromMe(multiModeUser, {});
assert.equal(resolved.chooser, true, 'first multi-mode login requires a chooser');
assert.equal(windowObject.__meAppMode, null, 'no mode is active before the chooser selection');

localStorage.setItem('me_app_mode_v1:tenant-1:user-1', 'staff');
resolved = context.meAppAccessResolveFromMe(multiModeUser, {});
assert.equal(resolved.mode, 'staff');
assert.equal(resolved.chooser, false, 'restart restores a still-authorized mode');

resolved = context.meAppAccessResolveFromMe(multiModeUser, { forceChooser: true });
assert.equal(resolved.chooser, true, 'fresh login shows chooser even with a persisted mode');

const ownerOnly = userWith([mode('owner')]);
resolved = context.meAppAccessResolveFromMe(ownerOnly, {});
assert.equal(resolved.mode, 'owner', 'revoked persisted mode falls back to server default');
assert.equal(localStorage.getItem('me_app_mode_v1:tenant-1:user-1'), null);

windowObject.__meRole = 'owner';
windowObject.__meIsStaff = true;
resolved = context.meAppAccessResolveFromMe({ id: 'user-1', tenant: { id: 'tenant-1' } }, {});
assert.equal(resolved.ok, false);
assert.equal(windowObject.__meRole, null, 'missing contract clears stale privileged presentation');
assert.equal(windowObject.__meIsStaff, false);
assert.equal(context.meAppAccessViewManager(), false, 'SaaS mode never falls back to legacy role');

const previewUser = userWith([mode('client', 'preview', false)]);
routed.length = 0;
bundleUser = previewUser;
context.meAppAccessOpenMode('client', { user: previewUser });
assert.equal(routed.at(-1), 'home');
assert.equal(windowObject.__meClientPreview, true);

const grantedClient = userWith([mode('client', 'granted', true)]);
routed.length = 0;
bundleUser = grantedClient;
context.meAppAccessOpenMode('client', { user: grantedClient });
assert.equal(routed.at(-1), 'cabinet', 'granted client opens the personal cabinet');

routed.length = 0;
context.meAppAccessRouteAfterMe({ id: 'user-1', tenant: { id: 'tenant-1' } }, {});
assert.equal(routed.at(-1), 'access-compat', 'missing contract always routes fail-closed');

const authRouteStart = html.indexOf('function meAuthRoute()');
const authRouteEnd = html.indexOf('window.__meHasSession = hasSession;', authRouteStart);
const authRoute = html.slice(authRouteStart, authRouteEnd);
assert.ok(!authRoute.includes('meSaasApplyIdentity('), 'boot router does not apply cached legacy role');
assert.ok(!authRoute.includes('meSaasIsBusinessRole('), 'boot router does not infer mode from legacy role');

const previewGuard = html.indexOf('// Preview may render public booking data only.');
const personalPortal = html.indexOf("af('/customer-portal')", previewGuard);
const previewReturn = html.indexOf('\n          return;\n', previewGuard);
assert.ok(previewGuard >= 0 && previewReturn > previewGuard && personalPortal > previewReturn,
  'client preview returns before personal CRM endpoints');

assert.ok(html.includes("meSaasLogoutCurrentSession('logout')"), 'logout clears the tenant session');

const loginScrollStart = html.indexOf('const lgSmoothScrollTo = function');
const loginScrollEnd = html.indexOf('const lgRevealAuthStack = function', loginScrollStart);
const loginScroll = html.slice(loginScrollStart, loginScrollEnd);
assert.ok(loginScrollStart >= 0 && loginScrollEnd > loginScrollStart, 'login reveal implementation is present');
assert.ok(!loginScroll.includes("root.style.pointerEvents = 'none'"),
  'login reveal never blocks Telegram and Yandex button taps');
assert.ok(!loginScroll.includes("root.style.touchAction = 'none'"),
  'login reveal never blocks native tap gestures');
assert.ok(html.includes('const SocialBtn = ({') && html.includes('}) => /*#__PURE__*/React.createElement("button", {'),
  'social login controls use semantic buttons in WKWebView');
assert.ok(html.includes("lgSocialLogin('telegram')") && html.includes("lgSocialLogin('yandex')"),
  'native Telegram and Yandex buttons keep their login handlers');

console.log(`native verification passed (${inlineScripts.length} inline scripts)`);
