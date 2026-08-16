// Full live-site walkthrough against https://meredaja.pages.dev.
// Signs in with the demo user (OTP read from remote D1), visits every
// page, captures console errors + failed API calls + broken images.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require2 = createRequire('C:/Users/HP/zemen/');
const puppeteer = require2('puppeteer-core');

const BASE = 'https://meredaja.pages.dev';

async function liveOtp() {
  await fetch('https://meredaja-api.183georgedaniel.workers.dev/api/auth/request-otp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '+251911000001' }),
  });
  await new Promise((r) => setTimeout(r, 1500));
  const out = execSync(
    `cd /c/Users/HP/meredaja && node node_modules/wrangler/bin/wrangler.js d1 execute meredaja-db --remote --command "SELECT code FROM otp_codes WHERE phone='+251911000001' ORDER BY id DESC LIMIT 1;" --json 2>/dev/null`,
    { cwd: 'C:/Users/HP/meredaja', shell: 'C:/Program Files/Git/bin/bash.exe' }
  ).toString();
  const j = JSON.parse(out);
  return j[0].results[0].code;
}

async function clickText(page, re) {
  const hs = await page.$$('button');
  for (const h of hs) {
    const txt = await h.evaluate((el) => el.innerText);
    if (re.test(txt)) {
      await h.click();
      return true;
    }
  }
  return false;
}

const report = { pages: [], consoleErrors: [], failedRequests: [], brokenImages: [] };

async function visit(page, label, url, { waitFor } = {}) {
  const errs = [];
  const fail = [];
  const broken = [];
  const onErr = (e) => errs.push(e.message);
  const onReqFail = (r) => { if (r.status() >= 400) fail.push(`${r.status()} ${r.url().replace(BASE, '')}`); };
  const onImgErr = (el) => broken.push(el.src.replace(BASE, ''));
  page.on('pageerror', onErr);
  page.on('response', onReqFail);
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|download the React DevTools/.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => fail.push('REQFAIL ' + r.url().replace(BASE, '')));

  try {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    // scan imgs for naturalWidth 0
    const imgs = await page.$$('img');
    for (const img of imgs) {
      const ok = await img.evaluate((el) => el.complete && el.naturalWidth > 0);
      if (!ok) broken.push(await img.evaluate((el) => el.src.replace(BASE, '')));
    }
  } catch (e) {
    errs.push('NAV: ' + e.message);
  }
  page.off('pageerror', onErr);
  page.off('response', onReqFail);
  page.off('console', onErr);
  page.off('requestfailed', onReqFail);

  report.pages.push({ label, url: url.replace(BASE, ''), errors: errs, failedRequests: fail, brokenImages: broken });
  console.log(`[${label}] errors:${errs.length} failedReq:${fail.length} brokenImg:${broken.length}`);
  if (errs.length) errs.slice(0, 3).forEach((e) => console.log('   ✗ ' + e));
  if (fail.length) fail.slice(0, 3).forEach((f) => console.log('   ✗ ' + f));
  if (broken.length) broken.slice(0, 3).forEach((b) => console.log('   ✗ img ' + b));
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });

  // ── login ──────────────────────────────────────────────────────────
  await visit(page, 'login', `${BASE}/login`);
  await page.type('input', '+251911000001');
  await new Promise((r) => setTimeout(r, 300));
  await clickText(page, /send code/i);
  await new Promise((r) => setTimeout(r, 1200));
  const otp = await liveOtp();
  const ins = await page.$$('input');
  await ins[ins.length - 1].type(otp);
  await new Promise((r) => setTimeout(r, 300));
  await clickText(page, /verify/i);
  await new Promise((r) => setTimeout(r, 2500));
  console.log('login landed on:', page.url());

  // ── dashboard ──────────────────────────────────────────────────────
  await visit(page, 'dashboard', `${BASE}/`);

  // ── library ────────────────────────────────────────────────────────
  await visit(page, 'library', `${BASE}/processes`);

  // ── process detail (each process) ──────────────────────────────────
  for (const slug of ['trade-license', 'tin-registration', 'business-name', 'construction-permit', 'import-export-license']) {
    await visit(page, `process:${slug}`, `${BASE}/processes/${slug}`, { waitFor: '.card' });
  }

  // ── process detail with region variant ─────────────────────────────
  await visit(page, 'process:region', `${BASE}/processes/trade-license?region=bahir_dar`, { waitFor: '.card' });

  // ── checklist (demo user has 2) ────────────────────────────────────
  await visit(page, 'checklist:1', `${BASE}/checklists/1`, { waitFor: '.card' });
  await visit(page, 'checklist:2', `${BASE}/checklists/2`, { waitFor: '.card' });

  // ── vault ──────────────────────────────────────────────────────────
  await visit(page, 'vault', `${BASE}/vault`, { waitFor: '.card' });

  // ── settings ───────────────────────────────────────────────────────
  await visit(page, 'settings', `${BASE}/settings`, { waitFor: '.card' });

  // ── moderation (demo user is moderator) ────────────────────────────
  await visit(page, 'moderation', `${BASE}/moderation`, { waitFor: '.card' });

  console.log('\n=== SUMMARY ===');
  for (const p of report.pages) {
    const flag = p.errors.length || p.failedRequests.length || p.brokenImages.length ? '⚠️' : '✅';
    console.log(`${flag} ${p.label}: err=${p.errors.length} req=${p.failedRequests.length} img=${p.brokenImages.length}`);
  }
} finally {
  await browser.close();
}
