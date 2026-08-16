// ─────────────────────────────────────────────────────────────────────
// Personal progress tracker routes.
//   POST   /api/checklists                     — start a checklist
//   GET    /api/checklists                     — my checklists (dashboard)
//   GET    /api/checklists/:id                 — detail incl. resolved
//                                               steps, statuses, docs
//   PATCH  /api/checklists/:id/steps/:stepKey  — set status / note
//   POST   /api/checklists/:id/attachments     — attach vault document to a step
//   DELETE /api/checklists/:id/attachments/:docId — detach
//   DELETE /api/checklists/:id                 — abandon a checklist
// ─────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { db } from '../db.js';
import { wrap, ok, badRequest, notFound, conflict } from '../http.js';
import { authMiddleware } from '../auth.js';
import { nowIso } from '../crypto.js';
import { resolveProcess, getProcessRow, isValidRegion } from '../processes.js';

const router = Router();
router.use(authMiddleware);

async function loadChecklist(id, userId) {
  const cl = await db.get('SELECT * FROM user_checklists WHERE id = ? AND user_id = ?', [id, userId]);
  if (!cl) throw notFound('Checklist not found');
  return cl;
}

/** Attach vault documents → per-step map for a checklist. */
async function attachmentsFor(checklistId) {
  const rows = await db.all(
    `SELECT a.step_key, a.document_id, d.type, d.file_name, d.file_path, d.mime_type, d.file_size
     FROM document_attachments a
     JOIN documents d ON d.id = a.document_id
     WHERE a.user_checklist_id = ?
     ORDER BY a.id`,
    [checklistId]
  );
  const map = {};
  for (const r of rows) {
    (map[r.step_key] ||= []).push(r);
  }
  return map;
}

async function statusesFor(checklistId) {
  return db.all('SELECT step_key, status, note, updated_at FROM checklist_step_status WHERE user_checklist_id = ?', [checklistId]);
}

async function computeCompleted(cl, totalSteps) {
  const statuses = await statusesFor(cl.id);
  const done = statuses.filter((s) => s.status === 'done').length;
  return {
    doneCount: done,
    totalSteps,
    completed: totalSteps > 0 && done === totalSteps,
  };
}

/** Start a new checklist instance. Region is validated against the catalog. */
router.post('/', wrap(async (req, res) => {
  const slug = String(req.body?.process_slug || '').trim();
  const region = String(req.body?.region || '').trim();
  if (!slug) throw badRequest('process_slug is required', 'missing_fields');
  if (!isValidRegion(region)) throw badRequest('Unknown region', 'region_unknown');

  const row = await getProcessRow(slug);
  const process = resolveProcess(row, { region, locale: 'en' });

  // One in-progress checklist per (user, process, region).
  const existing = await db.get(
    'SELECT id FROM user_checklists WHERE user_id = ? AND process_slug = ? AND region = ? AND completed_at IS NULL',
    [req.user.id, slug, region]
  );
  if (existing) throw conflict('You already have this checklist in progress');

  const { lastId } = await db.run(
    'INSERT INTO user_checklists (user_id, process_slug, region, process_version, started_at) VALUES (?, ?, ?, ?, ?)',
    [req.user.id, slug, region, row.version, nowIso()]
  );
  // Pre-seed step status rows so the UI has a stable row per step.
  for (const step of process.steps) {
    await db.run(
      'INSERT INTO checklist_step_status (user_checklist_id, step_key, status, note, updated_at) VALUES (?, ?, ?, ?, ?)',
      [lastId, step.key, 'todo', '', nowIso()]
    );
  }
  ok(res, { checklist: { id: lastId } }, 201);
}));

/** Dashboard: all my checklists with progress. */
router.get('/', wrap(async (req, res) => {
  const rows = await db.all(
    'SELECT * FROM user_checklists WHERE user_id = ? ORDER BY started_at DESC',
    [req.user.id]
  );
  const out = [];
  for (const cl of rows) {
    const row = await getProcessRow(cl.process_slug);
    const process = resolveProcess(row, { region: cl.region, locale: req.query.locale === 'am' ? 'am' : 'en' });
    const { doneCount, totalSteps, completed } = await computeCompleted(cl, process.steps.length);
    out.push({
      id: cl.id,
      process_slug: cl.process_slug,
      process_name: process.name,
      region: cl.region,
      started_at: cl.started_at,
      completed_at: cl.completed_at,
      completed,
      doneCount,
      totalSteps,
    });
  }
  ok(res, { checklists: out });
}));

/** Detail: resolved process + statuses + attachments. */
router.get('/:id', wrap(async (req, res) => {
  const cl = await loadChecklist(req.params.id, req.user.id);
  const row = await getProcessRow(cl.process_slug);
  const process = resolveProcess(row, { region: cl.region, locale: req.query.locale === 'am' ? 'am' : 'en' });
  const [statuses, attachments, reports] = await Promise.all([
    statusesFor(cl.id),
    attachmentsFor(cl.id),
    db.all(
      `SELECT id, step_key, actual_wait_estimate, office_location, requirement_waived, note, created_at
       FROM step_reports
       WHERE process_slug = ? AND region = ? AND moderation_status = 'approved'
       ORDER BY created_at DESC LIMIT 200`,
      [cl.process_slug, cl.region]
    ),
  ]);
  const statusMap = Object.fromEntries(statuses.map((s) => [s.step_key, s]));
  const { doneCount, totalSteps, completed } = await computeCompleted(cl, process.steps.length);

  ok(res, {
    checklist: {
      id: cl.id,
      process_slug: cl.process_slug,
      region: cl.region,
      started_at: cl.started_at,
      completed_at: cl.completed_at,
      completed,
      doneCount,
      totalSteps,
      process,
      steps: process.steps.map((s) => ({
        ...s,
        status: statusMap[s.key]?.status || 'todo',
        note: statusMap[s.key]?.note || '',
        attachments: attachments[s.key] || [],
      })),
      reports: reports.map((r) => ({ ...r, requirement_waived: !!r.requirement_waived })),
    },
  });
}));

/** Update a step's status and/or note. */
router.patch('/:id/steps/:stepKey', wrap(async (req, res) => {
  const cl = await loadChecklist(req.params.id, req.user.id);
  const row = await getProcessRow(cl.process_slug);
  const process = resolveProcess(row, { region: cl.region, locale: 'en' });
  const step = process.steps.find((s) => s.key === req.params.stepKey);
  if (!step) throw badRequest('Unknown step for this process', 'step_unknown');

  const status = req.body?.status === 'done' ? 'done' : 'todo';
  const note = String(req.body?.note ?? '').slice(0, 2000);
  await db.run(
    `INSERT INTO checklist_step_status (user_checklist_id, step_key, status, note, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_checklist_id, step_key) DO UPDATE SET
       status = excluded.status, note = excluded.note, updated_at = excluded.updated_at`,
    [cl.id, step.key, status, note, nowIso()]
  );

  // Maintain completed_at: all steps done → completed; any undone → reopen.
  const { doneCount, totalSteps, completed } = await computeCompleted(cl, process.steps.length);
  await db.run(
    'UPDATE user_checklists SET completed_at = ? WHERE id = ?',
    [completed ? nowIso() : null, cl.id]
  );
  ok(res, { step: { key: step.key, status, note }, completed, doneCount, totalSteps });
}));

/** Attach a vault document to a specific step of this checklist. */
router.post('/:id/attachments', wrap(async (req, res) => {
  const cl = await loadChecklist(req.params.id, req.user.id);
  const docId = Number(req.body?.document_id);
  if (!docId) throw badRequest('document_id is required', 'missing_fields');
  const doc = await db.get('SELECT id, user_id FROM documents WHERE id = ?', [docId]);
  if (!doc || doc.user_id !== req.user.id) throw notFound('Document not found');

  const stepKey = String(req.body?.step_key || '');
  const row = await getProcessRow(cl.process_slug);
  const process = resolveProcess(row, { region: cl.region, locale: 'en' });
  if (!process.steps.some((s) => s.key === stepKey)) throw badRequest('Unknown step', 'step_unknown');

  await db.run(
    `INSERT OR IGNORE INTO document_attachments (document_id, user_checklist_id, step_key, created_at)
     VALUES (?, ?, ?, ?)`,
    [doc.id, cl.id, stepKey, nowIso()]
  );
  const attachments = await attachmentsFor(cl.id);
  ok(res, { attachments: attachments[stepKey] || [] });
}));

/** Detach a document from a step. */
router.delete('/:id/attachments/:docId', wrap(async (req, res) => {
  const cl = await loadChecklist(req.params.id, req.user.id);
  const stepKey = String(req.body?.step_key || req.query.step_key || '');
  await db.run(
    'DELETE FROM document_attachments WHERE user_checklist_id = ? AND document_id = ? AND step_key = ?',
    [cl.id, req.params.docId, stepKey]
  );
  ok(res, { detached: true });
}));

/** Abandon a checklist (deletes statuses + attachments, keeps nothing). */
router.delete('/:id', wrap(async (req, res) => {
  const cl = await loadChecklist(req.params.id, req.user.id);
  await db.tx(async () => {
    await db.run('DELETE FROM document_attachments WHERE user_checklist_id = ?', [cl.id]);
    await db.run('DELETE FROM checklist_step_status WHERE user_checklist_id = ?', [cl.id]);
    await db.run('DELETE FROM user_checklists WHERE id = ?', [cl.id]);
  });
  ok(res, { deleted: true });
}));

export default router;
