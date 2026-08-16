// Deep-dive content checks on the live site: renders text sanity,
// Amharic toggle, region picker, checklist, vault, moderation; takes
// screenshots for visual review.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require2 = createRequire('C:/Users/HP/zemen/');
const puppeteer = require2('puppeteer-core');

const BASE = 'https://meredaja.pages.dev';
const SHOTS = 'C:/Users/HP/meredaja/live-shots';
mkdirSync(SHOTS, { recursive: true });

async function liveOtp() {
  await fetch('https://meredaja-api.183georgedaniel.workers.dev/api/auth/request-otp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '+251911000001' }),
  });
  await new Promise((r) => setTimeout(r, 2000));
  const out = execSync(
    `cd /c/Users/HP/meredaja && node node_modules/wrangler/bin/wrangler.js d1 execute meredaja-db --remote --command "SELECT code FROM otp_codes WHERE phone='+251911000001' ORDER BY id DESC LIMIT 1;" --json 2>/dev/null`,
    { shell: 'C:/Program Files/Git/bin/bash.exe' }
  ).toString();
  return JSON.parse(out)[0].results[0].code;
}

async function clickText(page, re) {
  const hs = await page.$$('button');
  for (const h of hs) {
    const txt = await h.evaluate((el) => el.innerText);
    if (re.test(txt)) { await h.click(); return true; }
  }
  return false;
}

// Find a button by regex source (regex can't cross the page boundary).
async function findButton(page, reSource) {
  return page.$$eval('button', (bs, src) => {
    const re = new RegExp(src);
    const b = bs.find((x) => re.test(x.innerText));
    return b ? bs.indexOf(b) : -1;
  }, reSource);
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });

  // login with retry
  let loggedIn = false;
  for (let attempt = 0; attempt < 3 && !loggedIn; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 500));
    await page.type('input', '+251911000001');
    await new Promise((r) => setTimeout(r, 300));
    await clickText(page, /send code/i);
    await new Promise((r) => setTimeout(r, 1500));
    const otp = await liveOtp();
    const ins = await page.$$('input');
    await ins[ins.length - 1].type(otp);
    await new Promise((r) => setTimeout(r, 300));
    await clickText(page, /verify/i);
    await new Promise((r) => setTimeout(r, 3000));
    loggedIn = page.url().includes('/login') === false;
    console.log(`login attempt ${attempt + 1}: ${loggedIn ? 'OK' : 'failed'}`);
  }
  if (!loggedIn) { console.log('FATAL: could not log in'); process.exit(1); }

  // ── Dashboard ──────────────────────────────────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  let body = await page.evaluate(() => document.body.innerText);
  console.log('dash has checklists:', /trade license|business name/i.test(body));
  console.log('dash shows progress:', /\d\/\d steps/.test(body));
  await page.screenshot({ path: `${SHOTS}/1-dashboard.png` });

  // ── Library ────────────────────────────────────────────────────────
  await page.goto(`${BASE}/processes`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  body = await page.evaluate(() => document.body.innerText);
  const procs = ['Trade License', 'TIN', 'Business Name', 'Construction', 'Import / Export'];
  console.log('library has 5 processes:', procs.every((p) => body.includes(p)));
  console.log('library shows step counts:', /\d+ steps/.test(body));
  await page.screenshot({ path: `${SHOTS}/2-library.png` });

  // ── Process detail ─────────────────────────────────────────────────
  await page.goto(`${BASE}/processes/trade-license`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  body = await page.evaluate(() => document.body.innerText);
  console.log('detail has confidence legend:', /Source confidence/.test(body));
  console.log('detail has badges:', /Official source|Best effort|Community-backed/.test(body));
  console.log('detail shows prepare-lease step:', /Secure premises/.test(body));
  await page.screenshot({ path: `${SHOTS}/3-process-detail.png` });

  // ── Region switch to Bahir Dar ─────────────────────────────────────
  const bIdx = await findButton(page, 'Bahir Dar');
  if (bIdx >= 0) {
    const bs = await page.$$('button');
    await bs[bIdx].click();
    await new Promise((r) => setTimeout(r, 1500));
    body = await page.evaluate(() => document.body.innerText);
    console.log('region switch → Amhara office:', /Amhara Region Trade Bureau/.test(body));
    await page.screenshot({ path: `${SHOTS}/3b-region-bahir.png` });
  } else {
    console.log('region switch → Bahir Dar chip NOT FOUND');
  }

  // ── Amharic toggle ─────────────────────────────────────────────────
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  const amIdx = await findButton(page, 'አማርኛ');
  if (amIdx >= 0) {
    const bs = await page.$$('button');
    await bs[amIdx].click();
    await new Promise((r) => setTimeout(r, 1000));
    await page.goto(`${BASE}/processes/trade-license`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1200));
    body = await page.evaluate(() => document.body.innerText);
    console.log('amharic detail renders:', /[\u1200-\u137F]/.test(body));
    await page.screenshot({ path: `${SHOTS}/4-process-amharic.png` });
  } else {
    console.log('Amharic button NOT FOUND');
  }

  // ── Checklist ──────────────────────────────────────────────────────
  await page.goto(`${BASE}/checklists/1`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  body = await page.evaluate(() => document.body.innerText);
  console.log('checklist shows progress:', /\d\/\d steps/.test(body));
  console.log('checklist has note field:', /Note for this step/.test(body));
  await page.screenshot({ path: `${SHOTS}/5-checklist.png` });

  // ── Vault ──────────────────────────────────────────────────────────
  await page.goto(`${BASE}/vault`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  body = await page.evaluate(() => document.body.innerText);
  console.log('vault shows document:', /sample-address-proof|address proof/i.test(body));
  console.log('vault shows encrypted tag:', /Encrypted at rest/.test(body));
  await page.screenshot({ path: `${SHOTS}/6-vault.png` });

  // ── Moderation ─────────────────────────────────────────────────────
  await page.goto(`${BASE}/moderation`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  body = await page.evaluate(() => document.body.innerText);
  console.log('moderation shows verified steps:', /Verified steps/.test(body));
  console.log('moderation shows history:', /Verification history/.test(body));
  await page.screenshot({ path: `${SHOTS}/7-moderation.png` });

  console.log('\nscreenshots saved to', SHOTS);
} finally {
  await browser.close();
}
