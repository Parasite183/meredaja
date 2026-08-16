// ─────────────────────────────────────────────────────────────────────
// Account routes.
//   DELETE /api/me  — "delete everything": the user's documents (files
//                     + rows + attachments), checklists, reports, OTP
//                     codes and sessions are all removed. The users row
//                     is soft-deleted (deleted_at) so report history
//                     that references the account keeps referential
//                     integrity, and the phone can be re-registered.
// ─────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { db } from '../db.js';
import { wrap, ok } from '../http.js';
import { authMiddleware } from '../auth.js';
import { nowIso } from '../crypto.js';
import { deleteUploadedFile } from '../uploads.js';

const router = Router();
router.use(authMiddleware);

router.delete('/me', wrap(async (req, res) => {
  const userId = req.user.id;

  // Collect the encrypted files first (they are removed from disk).
  const docs = await db.all('SELECT file_path FROM documents WHERE user_id = ?', [userId]);

  await db.tx(async () => {
    // Checklists + their per-step statuses and attachments.
    const checklistIds = await db.all('SELECT id FROM user_checklists WHERE user_id = ?', [userId]);
    for (const c of checklistIds) {
      await db.run('DELETE FROM document_attachments WHERE user_checklist_id = ?', [c.id]);
      await db.run('DELETE FROM checklist_step_status WHERE user_checklist_id = ?', [c.id]);
    }
    await db.run('DELETE FROM user_checklists WHERE user_id = ?', [userId]);

    // Documents (rows) and their remaining attachments.
    await db.run('DELETE FROM document_attachments WHERE document_id IN (SELECT id FROM documents WHERE user_id = ?)', [userId]);
    await db.run('DELETE FROM documents WHERE user_id = ?', [userId]);

    // The user's own step reports (community data they authored).
    await db.run('DELETE FROM step_reports WHERE user_id = ?', [userId]);

    // OTP codes + sessions + soft-delete the account.
    await db.run('DELETE FROM otp_codes WHERE phone = ?', [req.user.phone]);
    await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    await db.run('UPDATE users SET deleted_at = ?, phone = ? WHERE id = ?', [nowIso(), `${req.user.phone}#del`, userId]);
  });

  for (const d of docs) await deleteUploadedFile(d.file_path);
  ok(res, { deleted: true });
}));

export default router;
