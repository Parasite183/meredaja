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

## Live deployment

| What | URL |
|------|-----|
| Web app | **https://meredaja.pages.dev** |
| API worker | **https://meredaja-api.183georgedaniel.workers.dev** |
| Repository | **https://github.com/Parasite183/meredaja** |

The live backend runs on **Cloudflare Workers** (D1 for storage, R2 for
encrypted documents) with real SMS via **Africa's Talking** (sandbox
credentials). **Every push to `main` auto-deploys** — GitHub Actions runs the
tests, deploys the API worker, builds + deploys the web app to Pages, and
syncs the process library to D1 (see `.github/workflows/deploy.yml`).

Repo secrets (set once via `gh secret set`): `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. Worker secrets (`JWT_SECRET`, `MEREDAJA_ENC_KEY`,
`AFRICASTALKING_*`) are set via `wrangler secret put` and persist across
deploys.

> **Sandbox SMS note:** the live OTP codes are sent to the Africa's Talking
> sandbox (they appear in your AT dashboard, not on a real phone). To read
> a code during development, the demo user's latest code is in the `otp_codes`
> table — `npx wrangler d1 execute meredaja-db --remote --command "SELECT code
> FROM otp_codes ORDER BY id DESC LIMIT 1;"`. Switch to live AT credentials
> (and real sender ID) when ready for real delivery.

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

## Source confidence & auto-promotion

Every step carries a `confidence` level that the UI shows as a badge:

| Level | Meaning |
|-------|---------|
| `verified` | Field-verified against an actual office |
| `official` | Matches an official publication or legal requirement |
| `community` | Corroborated by multiple community reports |
| `best_effort` | Written from general knowledge — verify at the office |

Static levels live in the process JSON (`steps[].confidence`). On top of
that, the API applies live levels with this precedence:

1. **`verified`** — a moderator marked the step field-verified
   (`step_verifications` row; outranks everything)
2. **`community`** — auto-promoted: a `best_effort` step with **3 approved
   community reports** for its (process, region, step) —
   `PROMOTION_THRESHOLD` in `server/src/processes.js`
3. the static tag from the JSON

This is how the reality-check layer upgrades content without anyone editing
JSON: the badge becomes live evidence instead of a static tag. Promotion is
upward-only (`official`/`verified` are never downgraded), counts only
`approved` reports (flagged/hidden don't count), and is region-scoped.

Moderators drive the final step from the **Moderation page**: a "Verified
steps" section lists every community-promoted step, and a moderator who
confirms it on the ground clicks **Mark verified** (or **Undo verification**
for a mistake). The loop is complete: best-effort → community (earned via
reports) → verified (confirmed by a human).

## What's real vs. seeded placeholder data

**Real (working, not placeholder):**
- The entire app: auth, checklists, vault with magic-byte verification +
  encryption at rest, reports + moderation, rate limiting, region resolution,
  i18n.
- Process content structure: steps, required documents, offices, timelines,
  rejection reasons, region variants — all functional and editable.
- The demo user's checklist state, sample reports and sample vault document
  are real rows exercising the real flows (the sample PNG is a generated
  1×1 image, encrypted on disk like any upload). The seeded reports on the
  trade-license `prepare-lease` step cross the promotion threshold, so the
  demo visibly shows a `best_effort` step auto-promoted to `community`.

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
- SMS is a console stub in dev (`SMS_PROVIDER=console`); production uses
  Africa's Talking (sandbox credentials at the moment) and refuses to boot
  with the console stub or with missing provider credentials.

## Tests

```
npm test                # server unit tests (18)
node scripts/browser-smoke.mjs   # full UI flow, needs dev servers + Chrome
```
