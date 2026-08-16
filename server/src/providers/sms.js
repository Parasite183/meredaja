// ─────────────────────────────────────────────────────────────────────
// SMS provider — swappable, selected by SMS_PROVIDER env:
//   'console'  (default)  logs the code to the server console (dev only;
//              rejected in production by config.js validateConfig)
//   'twilio'   real delivery — set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN
//              / TWILIO_FROM
//   'africastalking' real delivery with strong Ethiopia reach — set
//              AFRICASTALKING_API_KEY / AFRICASTALKING_USERNAME
//
// Every provider implements: sendOtp(phone, code).
// ─────────────────────────────────────────────────────────────────────
import { config } from '../config.js';

const consoleProvider = {
  name: 'console',
  async sendOtp(phone, code) {
    console.log('\n──────────────────────────────────────────────────');
    console.log(`  [SMS-STUB] 📱 Meredaja OTP for ${phone}: ${code}`);
    console.log('  (Set SMS_PROVIDER=twilio or africastalking + credentials to send real SMS.)');
    console.log('──────────────────────────────────────────────────\n');
    return { provider: 'console', messageId: `stub-${Date.now()}` };
  },
};

const twilioProvider = {
  name: 'twilio',
  async sendOtp(phone, code) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || !from) throw new Error('Twilio credentials missing — refusing to send');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: phone, From: from, Body: `Meredaja verification code: ${code}` }),
    });
    if (!res.ok) throw new Error(`Twilio send failed (${res.status})`);
    const d = await res.json();
    return { provider: 'twilio', messageId: d.sid };
  },
};

const africastalkingProvider = {
  name: 'africastalking',
  async sendOtp(phone, code) {
    const apiKey = process.env.AFRICASTALKING_API_KEY;
    const username = process.env.AFRICASTALKING_USERNAME;
    if (!apiKey || !username) throw new Error("Africa's Talking credentials missing — refusing to send");
    const base = String(username).trim().toLowerCase() === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
    // Only set `from` when a registered sender ID is configured — an
    // unregistered ID makes AT reject the whole request. Without it AT
    // falls back to its default sender.
    const body = new URLSearchParams({ username, to: phone, message: `Meredaja verification code: ${code}` });
    const from = process.env.AFRICASTALKING_FROM;
    if (from) body.set('from', from);
    const res = await fetch(`${base}/version1/messaging`, {
      method: 'POST',
      headers: { apiKey, 'content-type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`Africa's Talking send failed (${res.status})`);
    return { provider: 'africastalking', messageId: String(Date.now()) };
  },
};

const PROVIDERS = { console: consoleProvider, twilio: twilioProvider, africastalking: africastalkingProvider };
const provider = PROVIDERS[config.smsProvider];
if (!provider) throw new Error(`Unknown SMS_PROVIDER "${config.smsProvider}" (expected console, twilio or africastalking) — refusing to boot.`);

export default provider;
