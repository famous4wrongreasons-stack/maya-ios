#!/usr/bin/env node
/**
 * Visual QA harness for PR #9 mode surfaces.
 * Serves www/, drives iPhone-sized Chromium, injects server-owned app_access
 * presentation state only (no role inference), captures screenshots.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const OUT = path.join(ROOT, 'output', 'pr9-visual-qa');
const PORT = 8765;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function ensureOut() {
  fs.mkdirSync(OUT, { recursive: true });
}

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let filePath = path.join(WWW, urlPath === '/' ? 'index.html' : urlPath);
    if (!filePath.startsWith(WWW)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const MODES_MULTI = {
  schema_version: 1,
  default_mode: 'owner',
  available_modes: [
    { mode: 'owner', access: 'granted', tenant_id: 't1', role: 'tenant_owner', profile_linked: true },
    { mode: 'staff', access: 'granted', tenant_id: 't1', role: 'tenant_owner', profile_linked: true },
    { mode: 'client', access: 'preview', tenant_id: 't1', role: 'tenant_owner', profile_linked: false }
  ],
  can_switch_mode: true,
  chooser_required: true
};

async function withPlaywright(fn) {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    const install = spawnSync('npm', ['install', '--no-save', 'playwright@1.55.0'], {
      cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32'
    });
    if (install.status !== 0) throw new Error('playwright install failed');
    const browsers = spawnSync('npx', ['playwright', 'install', 'chromium'], {
      cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32'
    });
    if (browsers.status !== 0) throw new Error('chromium install failed');
    playwright = require('playwright');
  }
  return fn(playwright);
}

async function shot(page, name) {
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function prepareApp(page, access, mode) {
  await page.goto('http://127.0.0.1:' + PORT + '/?booking_backend=saas-local&booking_api_base=https://mayaos.ru/api&booking_tenant=maya-os&onboarded=1', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  await page.waitForTimeout(800);
  await page.evaluate(({ access, mode }) => {
    window.__ME_SAAS_CTX = window.__ME_SAAS_CTX || {
      api: 'https://mayaos.ru/api',
      slug: 'maya-os',
      ns: 'https://mayaos.ru/api|maya-os'
    };
    window.__SAAS_TENANT = Object.assign({}, window.__SAAS_TENANT || {}, {
      name: 'MAYA OS',
      slug: 'maya-os',
      status: 'active'
    });
    window.APP_DATA = Object.assign({}, window.APP_DATA || {}, {
      brand: { name: 'MAYA OS', city: 'Ставрополь' }
    });
    const user = {
      id: 'user-visual-qa',
      name: 'Стас',
      role: 'tenant_owner',
      tenant: { id: 't1', slug: 'maya-os', name: 'MAYA OS' },
      staff_profile: { linked: true, source: 'crm', title: 'Мастер', external_staff_id: '1461615' },
      app_access: access
    };
    const bundle = {
      token: 'visual-qa-token',
      refresh_token: 'visual-qa-refresh',
      user: user,
      tenant_slug: 'maya-os',
      api_base: 'https://mayaos.ru/api'
    };
    try {
      localStorage.setItem('me_saas_auth_v2:' + window.__ME_SAAS_CTX.ns, JSON.stringify(bundle));
    } catch (e) {}
    window.__meAppAccess = access;
    window.__meAppMode = mode || null;
    window.__meAppModeAccess = null;
    window.__meClientPreview = false;
    if (mode && access) {
      const desc = (access.available_modes || []).find((m) => m.mode === mode);
      window.__meAppModeAccess = desc && desc.access;
      window.__meClientPreview = mode === 'client' && desc && desc.access === 'preview';
    }
    if (typeof meAppAccessApplyOwnerPresentation === 'function' && mode === 'owner') meAppAccessApplyOwnerPresentation(user);
    if (typeof meAppAccessApplyStaffPresentation === 'function' && mode === 'staff') meAppAccessApplyStaffPresentation(user);
    if (typeof meAppAccessApplyClientPresentation === 'function' && mode === 'client') {
      meAppAccessApplyClientPresentation(user, window.__meAppModeAccess);
    }
  }, { access, mode });
}

async function go(page, screen) {
  await page.evaluate((screen) => {
    if (window.__meGo) window.__meGo(screen);
    if (window.__meRefresh) window.__meRefresh();
  }, screen);
  await page.waitForTimeout(700);
}

async function main() {
  ensureOut();
  const server = await startServer();
  try {
    await withPlaywright(async (playwright) => {
      const browser = await playwright.chromium.launch({ headless: true });
      const narrow = await browser.newContext({
        viewport: { width: 375, height: 812 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true
      });
      const large = await browser.newContext({
        viewport: { width: 430, height: 932 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true
      });

      const pageN = await narrow.newPage();
      await prepareApp(pageN, MODES_MULTI, null);
      await go(pageN, 'choose');
      await shot(pageN, '01-chooser-narrow-375');

      await prepareApp(pageN, MODES_MULTI, 'owner');
      await go(pageN, 'staff-home');
      await shot(pageN, '02-owner-staff-home-narrow');

      await prepareApp(pageN, MODES_MULTI, 'staff');
      await go(pageN, 'staff-home');
      await shot(pageN, '03-staff-home-narrow');

      await prepareApp(pageN, {
        ...MODES_MULTI,
        available_modes: [
          { mode: 'client', access: 'granted', tenant_id: 't1', role: 'customer', profile_linked: true }
        ],
        can_switch_mode: false,
        chooser_required: false,
        default_mode: 'client'
      }, 'client');
      await pageN.evaluate(() => { window.__meClientPreview = false; window.__meAppModeAccess = 'granted'; });
      await go(pageN, 'cabinet');
      await shot(pageN, '04-client-granted-cabinet-narrow');

      await prepareApp(pageN, MODES_MULTI, 'client');
      await go(pageN, 'home');
      await shot(pageN, '05-client-preview-home-narrow');
      await go(pageN, 'cabinet');
      await shot(pageN, '06-client-preview-cabinet-narrow');

      await pageN.evaluate(() => {
        window.__meAppAccess = null;
        window.__meAppAccessCompatError = 'Сервер не вернул контракт app_access. Обновите backend MAYA OS — локально права не повышаются.';
      });
      await go(pageN, 'access-compat');
      await shot(pageN, '07-access-compat-narrow');

      const pageL = await large.newPage();
      await prepareApp(pageL, MODES_MULTI, null);
      await go(pageL, 'choose');
      await shot(pageL, '08-chooser-large-430');

      await prepareApp(pageL, MODES_MULTI, 'owner');
      await go(pageL, 'staff-home');
      await shot(pageL, '09-owner-with-switch-large');

      await browser.close();
    });

    const notes = [
      '# PR #9 native visual QA',
      '',
      '- Device used for install: iPhone Mo (`FF6F8003-99D2-5AED-A4CA-05BAE3877929`).',
      '- Screenshots below are the same www bundle at iPhone viewports (375×812 and 430×932).',
      '- Presentation-only fixes: scrollable/compact mode chooser, safe-area compat screen,',
      '  preview explanation banner, switch control clearance above bottom nav (no chat overlap).',
      '- No changes to app_access resolve/route, auth, logout, or preview data gates.',
      '',
      '## Screenshots',
      ...fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort().map((f) => `- ${f}`),
      ''
    ].join('\n');
    fs.writeFileSync(path.join(OUT, 'NOTES.md'), notes);
    console.log('visual qa screenshots ->', OUT);
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
