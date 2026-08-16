import { initDb, db } from './db.js';
import { initSchema } from './schema.js';
import { buildApp } from './app.js';
import { config, assertValidConfig } from './config.js';
import { syncProcessLibrary } from './processes.js';

async function main() {
  try {
    assertValidConfig();
  } catch (err) {
    console.error('\n' + err.message);
    process.exit(1);
  }

  await initDb();
  await initSchema();
  const { processes, changed } = await syncProcessLibrary();
  console.log(`  Process library: ${processes} processes on disk, ${changed} updated`);

  const app = buildApp();
  const server = app.listen(config.port, () => {
    console.log(`\n  መሬዳጃ Meredaja API running on http://localhost:${config.port}`);
    console.log(`  Storage: ${config.databaseUrl ? 'PostgreSQL' : `SQLite (${config.dbFile})`}`);
    console.log(`  Dev mode: ${config.devMode ? 'on (OTP peek endpoint enabled)' : 'off'}\n`);
  });

  const shutdown = async () => {
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start Meredaja:', err);
  process.exit(1);
});
