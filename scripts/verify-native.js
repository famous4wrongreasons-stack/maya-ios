'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('www/index.html', 'utf8');
const mainViewController = fs.readFileSync('ios/App/App/MainViewController.swift', 'utf8');

assert.ok(html.includes('2026-09-02-native-telegram-auth1'),
  'native bundle carries the current typewriter build marker');

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
assert.equal(routed.at(-1), 'home', 'client mode always opens the home screen, never the cabinet');

routed.length = 0;
context.meAppAccessRouteAfterMe(grantedClient, { coldStart: true, skipChooser: true });
assert.equal(routed.at(-1), 'home', 'cold launch opens the client home without clearing the session');

routed.length = 0;
context.meAppAccessRouteAfterMe({ id: 'user-1', tenant: { id: 'tenant-1' } }, {});
assert.equal(routed.at(-1), 'access-compat', 'missing contract always routes fail-closed');

const authRouteStart = html.indexOf('function meAuthRoute(');
const authRouteEnd = html.indexOf('window.__meHasSession = hasSession;', authRouteStart);
const authRoute = html.slice(authRouteStart, authRouteEnd);
assert.ok(!authRoute.includes('meSaasApplyIdentity('), 'boot router does not apply cached legacy role');
assert.ok(!authRoute.includes('meSaasIsBusinessRole('), 'boot router does not infer mode from legacy role');
assert.ok(html.includes('meAuthRoute({ coldStart: true })'), 'full app boot is distinguished from foreground resume');

const tipsResolverStart = html.indexOf('function meTipsResolveIndex(');
const tipsResolverEnd = html.indexOf('function ATips()', tipsResolverStart);
assert.ok(tipsResolverStart >= 0 && tipsResolverEnd > tipsResolverStart, 'tips selection resolver is present');
vm.runInContext(html.slice(tipsResolverStart, tipsResolverEnd), context);
assert.equal(context.meTipsResolveIndex(['10', '20'], '20', 0), 1, 'tips select the master by stable CRM id');
assert.equal(context.meTipsResolveIndex(['10', '20'], 'missing', 9), 0, 'stale tips selection is safely clamped');
assert.equal(context.meTipsResolveIndex([], '20', 4), 0, 'empty staff list does not crash the tips screen');
assert.equal(context.meTipsPaymentStaffId('503759', '3282766'), '3278920',
  'Alexander historical booking id maps only to his current tips staff card');
assert.equal(context.meTipsPaymentURL('503759', '1461615'),
  'https://yclients.com/companies/503759/staff/1461615/tips/pay/?master_tips_source=payed_from_pos_qr',
  'tips use the public YClients payment form rather than the receiver setup page');

const externalOpenStart = html.indexOf('window.__meExt = function (u) {');
const externalOpenEnd = html.indexOf('\n    try {\n      if (window.__meRestoreTelegramAvatar)', externalOpenStart);
const externalOpenSource = html.slice(externalOpenStart, externalOpenEnd);
assert.ok(externalOpenStart >= 0 && externalOpenEnd > externalOpenStart, 'external URL opener is present');
assert.ok(externalOpenSource.includes('plugins && plugins.AppLauncher'),
  'native external URLs use AppLauncher instead of a WKWebView popup');
assert.ok(externalOpenSource.indexOf("launcher.openUrl({ url: u })") < externalOpenSource.indexOf("window.open(u, '_blank')"),
  'native AppLauncher runs before the browser popup fallback');
assert.ok(externalOpenSource.indexOf('runtime.openTipsURL({ url: u })') < externalOpenSource.indexOf('launcher.openUrl({ url: u })'),
  'YClients tips prefer the dedicated native Safari bridge');

const tipsSendStart = html.indexOf('window.__tipsSend = function (idx, amount, note, preferredStaffId) {');
const tipsSendEnd = html.indexOf('\n  };', tipsSendStart);
const tipsSendSource = html.slice(tipsSendStart, tipsSendEnd);
assert.ok(tipsSendStart >= 0 && tipsSendEnd > tipsSendStart, 'tips payment dispatcher is present');
assert.ok(tipsSendSource.includes('return openTipsLink(url).then'), 'tips open the official YClients payment page directly');
assert.ok(tipsSendSource.includes('preferredStaffId'), 'tips payment is bound to a stable CRM staff id');
assert.ok(tipsSendSource.includes('meTipsPaymentURL(companyId, sid)'), 'tips URL is built by the verified payment-link resolver');
assert.ok(!tipsSendSource.includes('/tips/external/'), 'tips never open the private receiver setup page');
assert.ok(html.includes('__tipsSend(safeSel, amt, undefined, TIPS_IDS[safeSel])'),
  'full tips screen passes the selected CRM staff id to payment');
assert.ok(!tipsSendSource.includes('checkTipsAvailability(url).then'), 'a slow third-party host probe cannot block tips before Safari opens');
assert.ok(html.includes("runtime.openTipsURL({ url: target }).then"),
  'native tips use the dedicated system Safari bridge');
assert.ok(html.includes("launcher.openUrl({ url: target }).then"), 'tips await the native Safari launcher instead of assuming it opened');
assert.ok(tipsSendSource.includes('copyTipsLink(url).then'), 'tips preserve a copy-link fallback if Safari cannot open');
assert.ok(!html.includes('patch({ busy: false, sent: true })'), 'tips never claim success before payment confirmation');
assert.ok(mainViewController.includes('CAPPluginMethod(name: "checkTipsAvailability"'), 'native runtime exposes the tips availability probe');
assert.ok(mainViewController.includes('CAPPluginMethod(name: "openTipsURL"'), 'native runtime exposes the system tips opener');
assert.ok(mainViewController.includes('SFSafariViewController(url: url)'), 'tips leave WKWebView through an in-app Safari controller');
assert.ok(mainViewController.includes('safari.modalPresentationStyle = .fullScreen'), 'tips Safari controller is presented full-screen');
assert.ok(mainViewController.includes('UIApplication.shared.open(url, options: [:])'), 'tips prefer the reliable system URL handoff');
assert.ok(mainViewController.includes('CAPPluginMethod(name: "loadRemoteImage"'), 'native runtime exposes the avatar image loader');
assert.ok(mainViewController.includes('data.base64EncodedString()'), 'Telegram avatars are converted to a durable local data URL');
assert.ok(mainViewController.includes('host == "telesco.pe" || host.hasSuffix(".telesco.pe")'),
  'native avatar loader accepts Telegram official telesco.pe redirect CDN');

assert.ok(html.includes("key: 'menu-dismiss-actions'"), 'long-press menu exposes persistent top-right controls');
assert.ok(!html.includes("title: 'Удалить всю переписку'"),
  'retired server-side history deletion is absent from the native menu');
assert.ok(html.includes("title: 'Закрыть'"), 'long-press mode has an explicit close button');

const logoThemeStart = html.indexOf('function meBrandLogoThemeStyle(');
const logoThemeEnd = html.indexOf('function meUsesAdaptiveMonochromeBrandLogo(', logoThemeStart);
assert.ok(logoThemeStart >= 0 && logoThemeEnd > logoThemeStart, 'adaptive brand logo theme helper is present');
vm.runInContext(html.slice(logoThemeStart, logoThemeEnd), context);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.meBrandLogoThemeStyle('crm-logo.png', false, true, 'bundled.svg'))),
  { filter: 'invert(1)', backgroundColor: '#ffffff' },
  'CRM logo becomes black-on-white in light mode'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.meBrandLogoThemeStyle('crm-logo.png', true, true, 'bundled.svg'))),
  { filter: 'none', backgroundColor: '#000000' },
  'CRM logo stays white-on-black in dark mode'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.meBrandLogoThemeStyle('other-logo.png', true, false, 'bundled.svg'))),
  { filter: 'none', backgroundColor: 'transparent' },
  'other tenant logos keep their original colors'
);

assert.ok(fs.existsSync('www/assets/malesthetic-logo.svg'), 'bundled salon logo fallback exists');
assert.ok(html.includes('logoProbe.onload = function'), 'remote CRM logo is applied only after a successful preload');
assert.ok(html.includes('window.__ME_LOGO = fallbackLogo;'), 'failed CRM logo load keeps the bundled salon logo');
assert.ok(html.includes('onError: meBrandLogoFallback'), 'rendered salon logos have an image-level fallback');
assert.ok(!html.includes('window.__SAAS_BRAND = b;\n      window.__ME_LOGO_UPLOADED = false;'),
  'background config refresh never clears a previously loaded logo unconditionally');
assert.ok(html.includes('if (alreadyLoaded) {\n          // Keep the current image atomically.'),
  'an unchanged loaded CRM logo survives background config refreshes');

const tenantIdentityStart = html.indexOf("window.__ME_LEGACY_TENANT_SLUGS = ['muzhskaya-estetika'");
const tenantIdentityEnd = html.indexOf('// Официальный знак', tenantIdentityStart);
assert.ok(tenantIdentityStart >= 0 && tenantIdentityEnd > tenantIdentityStart, 'salon identity resolver is present');
windowObject.__ME_SAAS_CTX = { slug: 'maya-os', ns: 'test', api: 'https://api.example.test' };
windowObject.__SAAS_TENANT = { slug: 'muzhskaya-estetika' };
windowObject.__SAAS_BRAND = { name: 'Мужская Эстетика' };
vm.runInContext(html.slice(tenantIdentityStart, tenantIdentityEnd), context);
assert.equal(context.window.meCurrentTenantSlug(), 'muzhskaya-estetika',
  'resolved server tenant takes priority over the native maya-os bootstrap');
assert.equal(context.window.meIsMeTenant(), true, 'resolved salon keeps the barbershop logo');
windowObject.__SAAS_TENANT = { slug: 'maya-os' };
windowObject.__SAAS_BRAND = { name: 'MAYA OS' };
assert.equal(context.window.meIsMeTenant(), false, 'neutral platform tenant keeps the MAYA logo');

const repeatStart = html.indexOf('function meBookingServiceKey(');
const repeatEnd = html.indexOf('// =====================================================================', repeatStart);
assert.ok(repeatStart >= 0 && repeatEnd > repeatStart, 'repeat-booking resolver block is present');
vm.runInContext(html.slice(repeatStart, repeatEnd), context);

let repeatResolved = context.meResolvePreferredBookingServices([
  { id: 'cut', name: 'Мужская стрижка' },
  { id: 'beard', name: 'Моделирование бороды' },
], ['Мужская стрижка', 'Моделирование бороды'], ['cut', 'beard']);
assert.equal(repeatResolved.complete, true, 'all habitual services resolve by stable CRM ids');
assert.deepEqual(Array.from(repeatResolved.selected, (item) => item.id), ['cut', 'beard']);

repeatResolved = context.meResolvePreferredBookingServices([
  { id: 'cut', name: 'Стрижка мужская' },
], ['Мужская стрижка'], []);
assert.equal(repeatResolved.complete, true, 'renamed service resolves by normalized word order');
assert.equal(repeatResolved.selected[0].id, 'cut');

repeatResolved = context.meResolvePreferredBookingServices([
  { id: 'cut', name: 'Мужская стрижка' },
], ['Мужская стрижка', 'Патчи'], []);
assert.equal(repeatResolved.complete, false, 'missing historical service never silently changes the usual set');

const usualBooking = context.meDeriveUsualBooking([
  { date: '2026-08-10T12:00:00Z', staff_id: 'master-a', master: 'Александр', staff_avatar_url: 'https://cdn.example/master-a.jpg', services: [{ id: 'cut', name: 'Мужская стрижка' }, { id: 'care', name: 'Уход' }], service_ids: ['cut', 'care'] },
  { date: '2026-07-10T12:00:00Z', master_id: 'master-a', master: 'Александр', services: ['Мужская стрижка'], service_ids: ['cut'] },
  { date: '2026-08-09T12:00:00Z', staff_id: 'master-b', master: 'Илья', services: ['Стрижка'], service_ids: ['other'] },
], []);
assert.equal(usualBooking.master_id, 'master-a', 'habitual master is the most frequent historical master');
assert.equal(usualBooking.master_avatar_url, 'https://cdn.example/master-a.jpg', 'habitual master keeps the CRM photo');
assert.deepEqual(Array.from(usualBooking.service_ids), ['cut', 'care'], 'latest full service set for that master is preserved');
assert.deepEqual(Array.from(usualBooking.service_names), ['Мужская стрижка', 'Уход']);

const enrichedUsualBooking = context.meEnrichUsualBooking({
  repeat_booking: true,
  master_id: '3282766',
  master_name: '',
  master_avatar_url: '',
  service_ids: ['cut'],
  service_names: ['Мужская стрижка'],
}, [{
  id: 'staff-uuid-1',
  external_id: '3282766',
  name: 'Александр Киянский',
  avatar_url: 'https://cdn.example/alexander.jpg',
}]);
assert.equal(enrichedUsualBooking.master_id, '3282766', 'usual booking keeps the stable external CRM master id');
assert.equal(enrichedUsualBooking.master_name, 'Александр Киянский', 'usual booking is enriched with the loaded CRM master');
assert.equal(enrichedUsualBooking.master_avatar_url, 'https://cdn.example/alexander.jpg', 'usual booking is enriched with the loaded CRM photo');

const mergedUsualMaster = context.meMergeUsualMaster({
  id: '3282766',
  external_id: '3282766',
  name: 'Александр Киянский',
  avatar_url: 'alexander-photo.jpg',
}, {
  id: 'staff-uuid-1',
  external_id: '3282766',
  name: 'Александр Киянский',
  avatar_url: '',
});
assert.equal(mergedUsualMaster.id, 'staff-uuid-1', 'usual booking uses the available booking staff id');
assert.equal(mergedUsualMaster.external_id, '3282766', 'usual booking preserves the CRM identity used by photos and tips');
assert.equal(mergedUsualMaster.avatar_url, 'alexander-photo.jpg', 'an incomplete staff response cannot erase the cached master photo');

assert.ok(html.includes('loadServices(usualMaster, usualSetTitles, usualSetIds, true)'), 'main usual-booking action requests automatic service/date prefill');
assert.ok(html.includes('loadDates(m, resolved.selected)'), 'complete usual service set advances directly to available dates');
assert.ok(html.includes('meResolvePreferredBookingServices(sv, prefill.service_names, prefill.service_ids)'), 'chat booking widget uses the same full-set resolver');
assert.ok(html.includes("typeof s === 'object' ? (s.name || s.title || '') : s"), 'customer portal preserves string service names');
assert.ok(html.includes('service_ids: serviceIds'), 'customer portal preserves CRM service ids');
assert.ok(html.includes("master_avatar_url: staffPhotoOf(visit)"), 'customer history carries the habitual master photo into booking');
assert.ok(html.includes("avatar_url: m && (m.avatar_url || m.photo_url || m.image_url) || ''"), 'booking staff normalization preserves CRM photos');
assert.ok(html.includes('var _repeat = meEnrichUsualBooking('), 'cabinet hydration cannot overwrite the enriched habitual master photo');
assert.ok(html.includes("localStorage.removeItem('me_usual_service_ids')"), 'identity reset clears cached habitual service ids');

assert.ok(html.includes("var __meTelegramAvatarStoreKey = 'me_tg_avatar_v1'"), 'Telegram avatar has a session-scoped native cache');
assert.ok(html.includes('function meCurrentAvatar()'), 'every native profile surface resolves the active-session avatar synchronously');
assert.ok(html.includes('runtime.loadRemoteImage({ url: photo })'), 'remote Telegram photos are promoted through the native image loader');
assert.ok(html.includes('var photo = _ph && (_ph.photo || _ph.photo_url || _ph.avatar_url)'), 'Telegram profile accepts every supported avatar field');
assert.ok(html.includes('__meRememberTelegramAvatar(photo, sessionMarker)'), 'Telegram profile response is persisted for the active session');
assert.ok(html.includes('__meCompleteAppLogin(p.token, p.photo || p.photo_url || p.avatar_url)'),
  'native Telegram login carries a callback avatar into the new session');
const nativeLoginStart = html.indexOf('function __meCompleteAppLogin(token, photo)');
const nativeLoginEnd = html.indexOf('function __mePollAppLoginOnce(', nativeLoginStart);
const nativeLoginSource = html.slice(nativeLoginStart, nativeLoginEnd);
assert.ok(nativeLoginStart >= 0 && nativeLoginSource.includes('__meRefreshTelegramAvatar(avatarReq, 0, avatarMarker)'),
  'native Telegram login refreshes the profile photo immediately instead of waiting for a later screen');
assert.ok(nativeLoginSource.includes("localStorage.removeItem('tg_auth_data')"),
  'native Telegram login cannot inherit a stale avatar identity');
assert.ok(nativeLoginSource.includes("'X-Session-Token': String(token || '')"),
  'native Telegram avatar refresh is explicitly bound to the new session token');
assert.ok(html.includes('try { meRememberSocialAvatar(bundle.user); } catch (eAvatar) {}'),
  'tenant OAuth persists the social avatar together with the session bundle');
const avatarMarkerStart = html.indexOf('function __meTelegramAvatarSessionMarker()');
const avatarMarkerEnd = html.indexOf('function __meRememberTelegramAvatar(', avatarMarkerStart);
const avatarMarkerSource = html.slice(avatarMarkerStart, avatarMarkerEnd);
assert.ok(avatarMarkerSource.indexOf('meSaasCurrentBundle') < avatarMarkerSource.indexOf("localStorage.getItem('tg_auth_data')"),
  'SaaS user identity wins over stale legacy Telegram cache when restoring an avatar');
assert.ok(avatarMarkerSource.indexOf('meSaasCurrentBundle') < avatarMarkerSource.indexOf('var token = getTok()'),
  'the active tenant identity wins over a stale legacy web token');

const masterPhotoStart = html.indexOf('window.__meMasterPhoto = function (id, name)');
const masterPhotoEnd = html.indexOf('if (window.__meHydrate)', masterPhotoStart);
const masterPhotoSource = html.slice(masterPhotoStart, masterPhotoEnd);
assert.ok(masterPhotoStart >= 0 && masterPhotoSource.indexOf('var known =') < masterPhotoSource.indexOf('var dynamic ='),
  'known bundled master photos win over expiring CRM image URLs');
assert.ok(html.includes('window.__meMasterPhoto(meMasterExternalId(usualMaster) || usualMaster.id, usualMaster.name)'),
  'the usual-booking card resolves its master photo by both id and name');
assert.ok(html.includes("localStorage.getItem('me_usual_master')"), 'usual booking restores its CRM master from cold-start storage');
assert.ok(html.includes("3282766: 'Александр Киянский'"), 'the known CRM master keeps a stable display identity before staff hydration');

const previewGuard = html.indexOf('// Preview may render public booking data only.');
const personalPortal = html.indexOf("af('/customer-portal')", previewGuard);
const previewReturn = html.indexOf('\n          return;\n', previewGuard);
assert.ok(previewGuard >= 0 && previewReturn > previewGuard && personalPortal > previewReturn,
  'client preview returns before personal CRM endpoints');

assert.ok(html.includes("meSaasLogoutCurrentSession('logout')"), 'logout clears the tenant session');

const earlySessionStart = html.indexOf('function hasSession()', html.indexOf('(function () {', html.indexOf('window.__meHydrate')));
const earlySessionEnd = html.indexOf('/* feature floor:', earlySessionStart);
const earlySessionSource = html.slice(earlySessionStart, earlySessionEnd);
assert.ok(earlySessionStart >= 0 && earlySessionSource.includes('meSaasCurrentBundle'),
  'early client navigation recognizes the current tenant JWT');
assert.ok(earlySessionSource.includes('window.__meHasSession = hasSession'),
  'early tenant-aware session checker replaces a stale legacy checker');

const saasSessionStart = html.indexOf('function saasHasSession()');
const saasSessionEnd = html.indexOf('function applySaasCabinetPortal', saasSessionStart);
const saasSessionSource = html.slice(saasSessionStart, saasSessionEnd);
assert.ok(saasSessionStart >= 0 && saasSessionSource.indexOf('meSaasCurrentBundle') < saasSessionSource.indexOf('window.__meHasSession'),
  'cabinet hydration checks the tenant bundle before legacy auth channels');
assert.ok(!saasSessionSource.includes('return !!window.__meHasSession()'),
  'a false legacy session result cannot bypass the tenant JWT fallback');

const finalSessionStart = html.indexOf('function hasSession(){', avatarMarkerEnd);
const finalSessionEnd = html.indexOf('// 🔴 Сброс КЭША личности', finalSessionStart);
const finalSessionSource = html.slice(finalSessionStart, finalSessionEnd);
assert.ok(finalSessionSource.includes('__meRestoreTelegramAvatar()'),
  'tenant JWT relaunch restores the avatar before rendering the shell');

const loginStart = html.indexOf('const LOGIN_SCROLL_INERTIA');
const loginEnd = html.indexOf('// 2 \u00b7', loginStart);
const loginSource = html.slice(loginStart, loginEnd > loginStart ? loginEnd : html.indexOf('function AHome', loginStart));
assert.ok(loginStart >= 0 && loginSource.includes("translate3d(0,"), 'login uses the transform-based inertia engine');
assert.ok(loginSource.includes('dt / 16.67'), 'login inertia is normalized for 60 Hz and 120 Hz displays');
assert.ok(loginSource.includes('Math.sin(Math.PI * progress)'), 'login slowdown zone uses continuous sinusoidal viscosity');
assert.ok(loginSource.includes("container.addEventListener('wheel', onWheel, { passive: false })"), 'login wheel input is JS-owned');
assert.ok(loginSource.includes("field.focus({ preventScroll: true })"), 'login focus does not invoke native scroll reveal');
assert.ok(loginSource.includes("keyboard.setScroll({ isDisabled: true })"), 'login disables competing native WKWebView scrolling');
assert.ok(loginSource.includes("column.style.top = offset"), 'focused login fields use layout offset so the iOS caret remains attached');
assert.ok(loginSource.includes('container.clientHeight - pendingKeyboard'), 'login only reveals the focused field inside the keyboard-visible area');
assert.ok(!loginSource.includes('state.target + delta'), 'keyboard does not lift the login form by its full height');
assert.ok(loginSource.includes('Focus in the commit frame'), 'login opens the native keyboard without an artificial timeout');
assert.ok(!loginSource.includes('setLoginKeyboardResize'), 'login does not resize WKWebView while JS owns keyboard motion');
assert.ok(!loginSource.includes('scrollIntoView('), 'login does not compete with the inertia engine via scrollIntoView');
assert.ok(!loginSource.includes('scrollTo('), 'login does not compete with the inertia engine via scrollTo');

assert.ok(html.includes('function syncChatFooterClearance()'),
  'chat reserves space from the measured composer height');
assert.ok(html.includes("lane.style.paddingBottom = clearance + 'px'"),
  'chat content cannot remain hidden below the composer');
assert.ok(html.includes('chatResponsePinRef.current = true'),
  'chat pins the complete user-message-to-MAYA-reply cycle');
assert.ok(html.includes('contentObserver = new ResizeObserverCtor(onContentResize)'),
  'late widget and card height changes keep the newest content visible');
assert.ok(html.includes("lane.addEventListener('load', onAssetLoad, true)"),
  'late image loads keep the newest chat content above the composer');
assert.ok(html.includes('if (chatUserScrollRef.current && dy < -2) chatResponsePinRef.current = false'),
  'manual upward scrolling releases response pinning');
assert.ok(html.includes('function MayaTypewriterText(props)'),
  'native chat includes the MAYA typewriter renderer');
assert.ok(html.includes('charBudget += elapsed * charsPerSecond / 1000'),
  'typewriter timing remains smooth and consistent on ProMotion displays');
assert.ok(html.includes('streamLastMayaReply(acc);'),
  'legacy production chat streams every MAYA delta through the typewriter renderer');
assert.ok(html.includes('typewriter_complete: false'),
  'streaming MAYA replies keep the typewriter alive until the server finishes');
assert.ok(html.includes('complete: m.typewriter_complete !== false'),
  'the reply bubble distinguishes an active stream from a complete answer');
assert.ok(html.includes('onDone: function () { finishMayaTypewriter(m.typewriter_id); }'),
  'the typewriter hands the completed reply back to the normal message renderer');
assert.ok(html.includes('function MayaVolumeMark({'),
  'native bundle defines the static volume-wave mark');
assert.ok(html.includes('const levels = [0.58, 0.96, 0.4, 0.82, 0.62]'),
  'static audio mark uses the approved asymmetric volume frame');
assert.ok(html.includes("}, e(MayaVolumeMark, { size: 18, color: 'currentColor' }));"),
  'composer audio-record icon uses the static volume frame');
assert.ok(!html.includes("}, e(MayaMarkAnimated, { size: 18, color: 'currentColor', mode: 'listen' }));"),
  'composer audio-record icon does not animate');

console.log(`native verification passed (${inlineScripts.length} inline scripts)`);
