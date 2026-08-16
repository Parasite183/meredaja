// Headless sanity check: moderation page shows the verified-steps
// section. Needs local API (:3001) + web (:5173) up. Demo user is a
// moderator, so the section should render with the promoted step.
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
  await clickByText(page, /send code/i);
  await new Promise((r) => setTimeout(r, 800));
  const otp = await getOtp();
  const ins = await page.$$('input');
  await ins[ins.length - 1].type(otp);
  await new Promise((r) => setTimeout(r, 300));
  await clickByText(page, /verify/i);
  await new Promise((r) => setTimeout(r, 2000));

  await page.goto('http://localhost:5173/moderation', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500));
  const body = await page.evaluate(() => document.body.innerText);
  console.log('has Verified steps section:', body.includes('Verified steps'));
  console.log('has Mark verified button:', body.includes('Mark verified'));
  console.log('shows promoted step (prepare-lease):', /prepare-lease/.test(body));
  console.log('shows Community badge:', body.includes('Community-backed'));
  console.log('page errors:', errors.length ? errors : 'none');
} finally {
  await browser.close();
}
