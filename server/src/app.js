// ─────────────────────────────────────────────────────────────────────
// Express app wiring.
// ─────────────────────────────────────────────────────────────────────
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { serverRoot, config, validateConfig } from './config.js';
import { initDb } from './db.js';
import { initSchema } from './schema.js';
import { syncProcessLibrary } from './processes.js';
import { authMiddleware } from './auth.js';
import { requireUploadAccess } from './uploads.js';
import authRoutes from './routes/auth.js';
import processRoutes from './routes/processes.js';
import checklistRoutes from './routes/checklists.js';
import documentRoutes, { serveDocument } from './routes/documents.js';
import reportRoutes from './routes/reports.js';
import meRoutes from './routes/me.js';

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.set('x-content-type-options', 'nosniff');
    res.set('referrer-policy', 'no-referrer');
    res.set('x-frame-options', 'DENY');
    next();
  });

  app.use(express.json({ limit: '256kb' }));

  // Cloudflare Workers only: workerd forbids async I/O (like D1
  // queries) in module global scope, so the DB + schema + process
  // library must be initialised lazily inside a request handler. Plain
  // Node inits at startup (server/src/index.js) and skips this.
  if (config.worker) {
    let dbInitPromise = null;
    const ensureDb = () => {
      dbInitPromise ??= (async () => {
        const problems = validateConfig();
        if (problems.length) {
          const err = new Error('Worker refused to start: production configuration is incomplete: ' + problems.map((p) => p.name).join(', '));
          err.status = 500;
          err.configProblems = problems;
          throw err;
        }
        await initDb();
        await initSchema();
        await syncProcessLibrary();
      })().catch((err) => {
        dbInitPromise = null; // allow a retry on the next request
        throw err;
      });
      return dbInitPromise;
    };
    app.use(async (req, res, next) => {
      try {
        await ensureDb();
        next();
      } catch (err) {
        if (err.configProblems) {
          return res.status(500).json({
            error: 'Server misconfigured — refusing to serve. Missing/invalid: ' + err.configProblems.map((p) => p.name).join(', '),
            code: 'config_invalid',
          });
        }
        next(err);
      }
    });
  }

  // Private uploads: access-gated (owner/moderator only), decrypted in
  // memory at request time. Backed by local disk on Node and R2 on
  // Workers (uploads.js switches automatically).
  app.use('/uploads', authMiddleware, requireUploadAccess(), (req, res, next) => {
    const match = req.path.match(/^\/documents\/([0-9]+)\.enc$/);
    if (!match) return next();
    req.params = { id: match[1] };
    return serveDocument(req, res).catch(next);
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'meredaja-api' }));

  app.use('/api/auth', authRoutes);
  app.use('/api', processRoutes);     // /api/processes, /api/regions
  app.use('/api', reportRoutes);      // /api/reports, /api/moderation, signals
  app.use('/api', meRoutes);          // /api/me
  app.use('/api/checklists', checklistRoutes);
  app.use('/api/documents', documentRoutes);

  // Serve the built frontend in production on plain Node (not on
  // Workers — Cloudflare Pages handles the static site there).
  if (config.nodeEnv === 'production' && !config.worker) {
    const dist = path.join(serverRoot, '..', 'web', 'dist');
    app.use(express.static(dist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message, code: 'upload_error' });
    console.error('[meredaja] unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  });

  return app;
}
