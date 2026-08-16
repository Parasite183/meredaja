// ─────────────────────────────────────────────────────────────────────
// Community reality-check layer.
//   POST /api/reports                  — submit a report for a step
//   GET  /api/processes/:slug/signals?region= — aggregated per-step signal
//   POST /api/reports/:id/flag         — flag a report as abuse/misleading
//   GET  /api/moderation/reports?status=flagged|approved  — moderator only
//   POST /api/moderation/reports/:id   — { action: 'approve' | 'hide' }
//
// Moderation model (MVP, honest about its limits):
//   • Reports are visible immediately as 'approved'.
//   • Anyone can flag a report → it becomes 'flagged' and drops out of
//     the aggregated signal until a moderator acts.
//   • Moderators approve (restore) or hide (remove) flagged reports.
//   • Per-account-per-process + per-IP submission limits (rate-limit.js).
// ─────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { db } from '../db.js';
import { wrap, ok, badRequest, notFound } from '../http.js';
import { authMiddleware, requireModerator } from '../auth.js';
import { nowIso } from '../crypto.js';
import { REPORT_LIMITS } from '../rate-limit.js';
import { resolveProcess, getProcessRow, isValidRegion } from '../processes.js';

const router = Router();

/** Aggregate a step's approved reports into a small visible signal. */
function aggregate(reports) {
  const waits = reports.map((r) => r.actual_wait_estimate).filter((n) => Number.isFinite(n));
  const avgWait = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null;
  const buckets = { '<1 week': 0, '1–2 weeks': 0, '2–4 weeks': 0, '>1 month': 0 };
  for (const w of waits) {
    if (w < 7) buckets['<1 week'] += 1;
    else if (w < 14) buckets['1–2 weeks'] += 1;
    else if (w < 30) buckets['2–4 weeks'] += 1;
    else buckets['>1 month'] += 1;
  }
  return {
    count: reports.length,
    avgWaitDays: avgWait,
    buckets,
    waivers: reports.filter((r) => r.requirement_waived).length,
  };
}

// ── submit a report ──────────────────────────────────────────────────
router.post('/reports', authMiddleware, REPORT_LIMITS.reportUser, REPORT_LIMITS.reportIp, wrap(async (req, res) => {
  const processSlug = String(req.body?.process_slug || '').trim();
  const region = String(req.body?.region || '').trim();
  const stepKey = String(req.body?.step_key || '').trim();
  if (!processSlug || !region || !stepKey) throw badRequest('process_slug, region and step_key are required', 'missing_fields');
  if (!isValidRegion(region)) throw badRequest('Unknown region', 'region_unknown');

  // Validate the step actually exists for this process+region.
  const row = await getProcessRow(processSlug);
  const process = resolveProcess(row, { region, locale: 'en' });
  if (!process.steps.some((s) => s.key === stepKey)) throw badRequest('Unknown step for this process', 'step_unknown');

  const waitRaw = req.body?.actual_wait_estimate;
  let wait = null;
  if (waitRaw !== undefined && waitRaw !== null && waitRaw !== '') {
    wait = Math.round(Number(waitRaw));
    if (!Number.isFinite(wait) || wait < 0 || wait > 3650) throw badRequest('actual_wait_estimate must be a positive number of days', 'wait_invalid');
  }

  const note = String(req.body?.note || '').slice(0, 1000);
  if (!note && wait === null) throw badRequest('Tell us something — a wait estimate or a note', 'empty_report');

  const { lastId } = await db.run(
    `INSERT INTO step_reports
       (process_slug, region, step_key, user_id, actual_wait_estimate, office_location, requirement_waived, note, moderation_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)`,
    [
      processSlug, region, stepKey, req.user.id,
      wait,
      String(req.body?.office_location || '').slice(0, 200),
      req.body?.requirement_waived ? 1 : 0,
      note,
      nowIso(),
    ]
  );
  ok(res, { report: { id: lastId, moderation_status: 'approved' } }, 201);
}));

// ── aggregated per-step signal (public, no auth — powers the library) ─
router.get('/processes/:slug/signals', wrap(async (req, res) => {
  const region = String(req.query.region || '').trim();
  if (!isValidRegion(region)) throw badRequest('Unknown region', 'region_unknown');
  const rows = await db.all(
    `SELECT step_key, actual_wait_estimate, requirement_waived
     FROM step_reports
     WHERE process_slug = ? AND region = ? AND moderation_status = 'approved'`,
    [req.params.slug, region]
  );
  const byStep = {};
  for (const r of rows) {
    (byStep[r.step_key] ||= []).push(r);
  }
  const signals = {};
  for (const [key, list] of Object.entries(byStep)) {
    signals[key] = aggregate(list);
  }
  ok(res, { signals });
}));

// ── flagging ─────────────────────────────────────────────────────────
router.post('/reports/:id/flag', authMiddleware, REPORT_LIMITS.flagUser, wrap(async (req, res) => {
  const report = await db.get('SELECT * FROM step_reports WHERE id = ?', [req.params.id]);
  if (!report) throw notFound('Report not found');
  if (report.user_id === req.user.id) throw badRequest('You cannot flag your own report', 'self_flag');
  await db.run(
    "UPDATE step_reports SET moderation_status = 'flagged', flagged_by = ? WHERE id = ? AND moderation_status IN ('approved', 'flagged')",
    [req.user.id, report.id]
  );
  ok(res, { flagged: true });
}));

// ── moderation queue (moderators only) ───────────────────────────────
router.get('/moderation/reports', authMiddleware, requireModerator, wrap(async (req, res) => {
  const status = req.query.status === 'flagged' ? 'flagged' : 'approved';
  const rows = await db.all(
    `SELECT r.*, u.phone AS reporter_phone
     FROM step_reports r LEFT JOIN users u ON u.id = r.user_id
     WHERE r.moderation_status = ?
     ORDER BY r.created_at DESC LIMIT 100`,
    [status]
  );
  ok(res, { reports: rows.map((r) => ({ ...r, requirement_waived: !!r.requirement_waived })) });
}));

router.post('/moderation/reports/:id', authMiddleware, requireModerator, wrap(async (req, res) => {
  const action = req.body?.action;
  if (!['approve', 'hide'].includes(action)) throw badRequest('action must be approve or hide', 'bad_action');
  const report = await db.get('SELECT * FROM step_reports WHERE id = ?', [req.params.id]);
  if (!report) throw notFound('Report not found');
  const nextStatus = action === 'hide' ? 'hidden' : 'approved';
  await db.run('UPDATE step_reports SET moderation_status = ? WHERE id = ?', [nextStatus, report.id]);
  ok(res, { id: report.id, moderation_status: nextStatus });
}));

export default router;
