// Headless sanity check: confidence badges + legend render on the
// process detail page. Needs the local API (:3001) + web (:5173) up.
import { createRequire } from 'node:module';
const require2 = createRequire('C:/Users/HP/zemen/');
const puppeteer = require2('puppeteer-core');

async function getOtp() {
  const res = await fetch('http://localhost:3001/api/auth/dev/otp?phone=%2B251911000001');
  const j = await res.json().catch(() => ({}));
  if (j.code) return j.code;
  await fetch('http://localhost:3001/api/auth/request-otp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '+251911000001' }),
  });
  await new Promise((r) => setTimeout(r, 500));
  const j2 = await (await fetch('http://localhost:3001/api/auth/dev/otp?phone=%2B251911000001')).json();
  return j2.code;
}

async function clickByText(page, regex) {
  const handles = await page.$$('button');
  for (const h of handles) {
    const txt = await h.evaluate((el) => el.innerText);
    if (regex.test(txt)) {
      await h.click();
      return true;
    }
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle0' });
  await page.type('input', '+251911000001');
  await new Promise((r) => setTimeout(r, 300));
  const sent = await clickByText(page, /send code/i);
  console.log('clicked send code:', sent);
  await new Promise((r) => setTimeout(r, 800));
  // Fetch the OTP AFTER sending — sending generates a fresh code.
  const otp = await getOtp();
  const ins = await page.$$('input');
  console.log('inputs after send:', ins.length, 'otp:', otp);
  await ins[ins.length - 1].type(otp);
  await new Promise((r) => setTimeout(r, 300));
  const verified = await clickByText(page, /verify/i);
  console.log('clicked verify:', verified);
  await new Promise((r) => setTimeout(r, 2500));
  console.log('after login URL:', page.url());
  const loginBody = await page.evaluate(() => document.body.innerText);
  console.log('login page shows error:', /didn.t work|didn’t work/i.test(loginBody));

  await page.goto('http://localhost:5173/processes/trade-license', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500));
  const body = await page.evaluate(() => document.body.innerText);
  console.log('has legend:', body.includes('Source confidence'));
  console.log('has Official source badge:', body.includes('Official source'));
  console.log('has Best effort badge:', body.includes('Best effort'));
  console.log('has Field-verified:', body.includes('Field-verified'));
  console.log('has Community-backed:', body.includes('Community-backed'));
  console.log('page errors:', errors.length ? errors : 'none');
} finally {
  await browser.close();
}
