# መሬዳጃ Meredaja — your route through the paperwork

A bureaucracy navigator for Ethiopian government permit and registration
processes. Meredaja turns opaque, rediscovered-from-scratch processes into
step-by-step guided checklists, with a **document vault** (upload once, reuse
everywhere) and a **community reality-check layer** (people report the actual
wait times and waived requirements, so the tool is honest instead of a
re-typed government pamphlet).

**This is a working local prototype.** It does not touch any government
system — it's a guided checklist + document vault + community layer, exactly
as scoped. See [What's real vs. placeholder data](#whats-real-vs-seeded-placeholder-data).

```
npm install        # workspace install (server + web)
npm run seed       # process library + demo user data
npm run dev        # API on :3001 + web on :5173 together
```

Then open **http://localhost:5173** and sign in with the demo phone
`+251911000001` — the OTP is printed in the server console (or use the
"Dev: autofill code" button).

## Stack

| Layer    | Choice |
|----------|--------|
| Frontend | React 18 + Vite + Tailwind 4, mobile-first, bottom-nav layout |
| Backend  | Node.js / Express 4 |
| Storage  | SQLite (better-sqlite3) by default; PostgreSQL via `DATABASE_URL` |
| Auth     | Phone-number OTP (JWT + server-side sessions) |
| i18n     | English + Amharic from day one (`web/src/i18n/en.js`, `am.js`) |

The security patterns are lifted from the sibling **Zemen** project:
`auth.js`, `rate-limit.js` and `uploads.js` (magic-byte sniffing, private
upload access, fixed-window rate limiting) — adapted and extended with
**encryption at rest** for documents, which Zemen didn't have.

## Features (MVP scope)

1. **Process library** — curated checklists for 3 processes (trade license,
   TIN registration, business name registration), each with ordered steps,
   required documents per step, responsible office, official timeline,
   common rejection reasons, and region-specific variants.
2. **Personal progress tracker** — start a checklist, check steps off, keep
   a note per step, dashboard with progress bars.
3. **Document vault** — upload ID/lease/photos once (images + PDF only, 10 MB
   cap, **magic-byte verified**, **AES-256-GCM encrypted at rest**, owner-only
   access) and attach the same document to steps of any number of checklists.
   A "delete everything" control lives in Settings.
4. **Community reality-check layer** — short reports per step (actual wait,
   office/branch, requirement-waived flag, note), aggregated into a visible
   signal ("12 people reported this step took 2–4 weeks"), with flagging and
   a moderator queue. Submission is rate-limited per account per process and
   per IP.
5. **Regional variation** — a process definition carries per-region step
   overrides (office names, timelines, extra/removed steps). Addis Ababa is
   fully populated; other regions exist in the data model with regional
   notes and office overrides.

Out of scope for MVP (per spec): any government integration/API, automated
document verification/OCR, and payment processing.

## Project layout

```
meredaja/
  server/
    src/
      index.js        entrypoint
      app.js          express wiring
      config.js       env config + production validation
      db.js           SQLite / PostgreSQL access layer
      schema.js       tables (processes, checklists, documents, reports…)
      auth.js         phone OTP + JWT sessions
      rate-limit.js   fixed-window limiters (auth + reports)
      uploads.js      magic-byte sniffing + AES-256-GCM encryption
      processes.js    versioned process library loader + region resolution
      routes/         auth, processes, checklists, documents, reports, me
    data/
      regions.json    region catalog (en/am names)
      processes/      THE CONTENT: one versioned JSON per process
    uploads/documents/  encrypted blobs (gitignored)
    tests/            unit tests (magic bytes, encryption, region resolution)
  web/
    src/
      pages/          Login, Dashboard, Library, ProcessDetail, Checklist,
                      Vault, Settings, Moderation
      i18n/           en.js + am.js + provider
      api.js          fetch client + token handling + upload URL hook
  scripts/browser-smoke.mjs   end-to-end UI check (puppeteer-core + Chrome)
```

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/request-otp` · `/verify-otp` | phone OTP sign-in |
| GET  | `/api/processes` · `/api/processes/:slug?region=` · `/api/regions` | library |
| GET  | `/api/processes/:slug/signals?region=` | aggregated community signal |
| POST | `/api/checklists` | start a checklist |
| GET  | `/api/checklists` · `/api/checklists/:id` | dashboard + detail |
| PATCH| `/api/checklists/:id/steps/:stepKey` | set status / note |
| POST | `/api/checklists/:id/attachments` | attach vault doc to a step |
| POST | `/api/documents` (multipart) | upload (verified + encrypted) |
| GET  | `/api/documents` · DELETE `/api/documents/:id` | vault |
| GET  | `/uploads/documents/:id.enc` | decrypted bytes, owner-only |
| POST | `/api/reports` · `/api/reports/:id/flag` | community reports |
| GET  | `/api/moderation/reports` · POST `/api/moderation/reports/:id` | mod queue |
| DELETE | `/api/me` | delete everything |

## Editing process content (no redeploy)

Process definitions are versioned JSON in `server/data/processes/`. The
loader upserts each file keyed by `slug + version` — bump the `version` field
and re-seed (or restart) to publish an edit. Step identity is a stable string
key (`register-name`, `get-tin`), so existing checklists keep working when
content changes. This is the mechanism the product depends on: launch
content will be wrong, and fixing it must be cheap.

```jsonc
// server/data/processes/trade-license.json (excerpt)
{
  "slug": "trade-license",
  "version": 2,                 // ← bump to publish changes
  "name": { "en": "…", "am": "…" },
  "steps": [ { "key": "register-name", "order": 1, … } ],
  "regions": {
    "bahir_dar": {
      "notes": { "en": "…" },
      "step_overrides": { "register-name": { "responsible_office": { "en": "…" } } }
    }
  }
}
```

## What's real vs. seeded placeholder data

**Real (working, not placeholder):**
- The entire app: auth, checklists, vault with magic-byte verification +
  encryption at rest, reports + moderation, rate limiting, region resolution,
  i18n.
- Process content structure: steps, required documents, offices, timelines,
  rejection reasons, region variants — all functional and editable.
- The demo user's checklist state, sample reports and sample vault document
  are real rows exercising the real flows (the sample PNG is a generated
  1×1 image, encrypted on disk like any upload).

**Seeded placeholder / best-effort (flagged honestly):**
- **Process content is best-effort reference material**, written from public
  knowledge of Ethiopian processes, NOT verified against any office. Details
  (fees, exact office names, timelines, whether a document is really needed)
  will be wrong in places — that is the point of the product: the community
  reality-check layer exists to correct exactly this. Treat every step as
  "verify at the office".
- Non-Addis region variants (Bahir Dar, Hawassa, Mekelle, Dire Dawa…) are
  scaffolded with reasonable office names and notes — clearly not field-
  verified. Only Addis Ababa is treated as "fully populated".
- Demo user `+251911000001` ("Demo User (Abebe)", a moderator so the
  moderation queue is testable) and its 2 in-progress checklists are seed
  data. OTP is console-printed in dev — no real SMS is sent.
- `scripts/browser-smoke.mjs` is a dev harness (needs Chrome + the sibling
  `zemen` checkout for puppeteer-core); it is not part of the product.

## Notes & honest limitations

- Rate-limit counters are in-memory per process — fine for a local prototype,
  not a distributed DDoS defense.
- Document encryption uses a **dev-default key** in development
  (`MEREDAJA_ENC_KEY`); production refuses to boot without a real key.
- SQLite is the default; `DATABASE_URL=postgres://…` switches the same code
  to PostgreSQL (SQL stays in the common dialect).
- SMS is a console stub in dev (`SMS_PROVIDER=console`); Twilio and
  Africa's Talking providers exist but need credentials, and production
  rejects the console stub.

## Tests

```
npm test                # server unit tests (12)
node scripts/browser-smoke.mjs   # full UI flow, needs dev servers + Chrome
```
