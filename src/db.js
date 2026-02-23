const Database = require('better-sqlite3');

function createDb(dbPath = './data/jarvis.db') {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT UNIQUE NOT NULL,
      remote TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      meta TEXT DEFAULT '{}',
      last_seen TEXT DEFAULT (datetime('now'))
    );
  `);

  return {
    createProject({ name, path, remote }) {
      const stmt = db.prepare(
        'INSERT INTO projects (name, path, remote) VALUES (?, ?, ?)'
      );
      const result = stmt.run(name, path, remote || '');
      return { id: result.lastInsertRowid, name, path, remote };
    },
    getProjects() {
      return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    },
    getProject(id) {
      return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    },
    upsertAsset({ path, type, source, meta }) {
      const stmt = db.prepare(`
        INSERT INTO assets (path, type, source, meta, last_seen)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(path) DO UPDATE SET
          type = excluded.type,
          source = excluded.source,
          meta = excluded.meta,
          last_seen = datetime('now')
      `);
      stmt.run(path, type, source, JSON.stringify(meta));
    },
    getAssets(type) {
      if (type) return db.prepare('SELECT * FROM assets WHERE type = ?').all(type);
      return db.prepare('SELECT * FROM assets ORDER BY last_seen DESC').all();
    },
    close() { db.close(); },
  };
}

module.exports = { createDb };
