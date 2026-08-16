// Verify the demo vault document is live: log in as the demo user and
// confirm the vault lists the sample doc, its badge, and that the
// thumbnail actually loads (decrypt + serve works end to end).
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

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });

  const failed = [];
  page.on('requestfailed', (r) => failed.push(r.url()));

  let loggedIn = false;
  for (let attempt = 0; attempt < 3 && !loggedIn; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 500));
    await page.type('input', '+251911000001');
    await clickText(page, /send code/i);
    await new Promise((r) => setTimeout(r, 1500));
    const otp = await liveOtp();
    const ins = await page.$$('input');
    await ins[ins.length - 1].type(otp);
    await clickText(page, /verify/i);
    await new Promise((r) => setTimeout(r, 3000));
    loggedIn = !page.url().includes('/login');
  }
  if (!loggedIn) { console.log('FATAL: login failed'); process.exit(1); }

  // ── Vault ──────────────────────────────────────────────────────────
  await page.goto(`${BASE}/vault`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 2000));
  const body = await page.evaluate(() => document.body.innerText);
  console.log('vault lists sample doc:', /sample-address-proof\.png/.test(body));
  console.log('vault shows Address proof badge:', /Address proof/.test(body));
  console.log('vault shows attached-to count:', /Attached to 2/.test(body) || /2/.test(body.split('Attached')[1] || ''));
  console.log('vault shows encrypted footer:', /Encrypted at rest/.test(body));

  // Thumbnail img actually loaded (decrypt + serve worked)?
  const img = await page.$eval('img', (el) => ({ src: el.src, ok: el.complete && el.naturalWidth > 0 })).catch(() => null);
  console.log('thumbnail img:', img ? `ok=${img.ok}` : 'NO IMG FOUND');
  console.log('failed requests:', failed.length === 0 ? 'none' : failed.join(', '));

  // ── Checklist shows the attached doc ───────────────────────────────
  await page.goto(`${BASE}/checklists/1`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 2000));
  const clBody = await page.evaluate(() => document.body.innerText);
  console.log('\nchecklist 1 shows attachment:', /sample-address-proof/.test(clBody));
  const clImg = await page.$eval('img', (el) => ({ ok: el.complete && el.naturalWidth > 0 })).catch(() => null);
  console.log('checklist attachment thumb ok:', clImg ? clImg.ok : 'NO IMG');
} finally {
  await browser.close();
}
