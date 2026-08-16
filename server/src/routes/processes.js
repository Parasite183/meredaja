// ─────────────────────────────────────────────────────────────────────
// Process library routes (public).
//   GET /api/processes           — list (latest version per slug)
//   GET /api/processes/:slug     — resolved detail (region + locale)
//   GET /api/regions             — region catalog
// ─────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { wrap, ok } from '../http.js';
import { listProcesses, resolveProcessWithPromotion, getProcessRow, regionCatalog } from '../processes.js';

const router = Router();

router.get('/regions', wrap(async (_req, res) => {
  const cat = regionCatalog();
  ok(res, {
    regions: Object.entries(cat).map(([id, names]) => ({ id, ...names })),
  });
}));

router.get('/processes', wrap(async (req, res) => {
  const locale = req.query.locale === 'am' ? 'am' : 'en';
  ok(res, { processes: await listProcesses(locale) });
}));

router.get('/processes/:slug', wrap(async (req, res) => {
  const locale = req.query.locale === 'am' ? 'am' : 'en';
  const row = await getProcessRow(req.params.slug);
  // Community promotion: best_effort steps with enough approved
  // reports get upgraded to community based on live data.
  const process = await resolveProcessWithPromotion(row, { region: req.query.region, locale });
  ok(res, { process });
}));

export default router;
