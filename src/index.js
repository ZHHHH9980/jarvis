require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { createDb } = require('./db.js');
const { createBot } = require('./telegram-bot.js');
const { scanDirectory, scanServices } = require('./inventory.js');
const { init: initNotifier } = require('./notifier.js');

const PORT = process.env.PORT || 3001;
const SCAN_DIR = (process.env.SCAN_DIR || '~/projects').replace('~', process.env.HOME);
const SCAN_INTERVAL = parseInt(process.env.SCAN_INTERVAL_MS) || 3600000;

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = createDb(path.join(dataDir, 'jarvis.db'));

// Express
const app = express();
app.use(express.json());

// POST /api/register — register a project
app.post('/api/register', (req, res) => {
  const { name, path: projPath, remote } = req.body;
  if (!name || !projPath) return res.status(400).json({ error: 'name and path required' });
  try {
    const project = db.createProject({ name, path: projPath, remote: remote || '' });
    db.upsertAsset({ path: projPath, type: 'repo', source: 'register', meta: { remote } });
    res.json(project);
  } catch (err) {
    db.upsertAsset({ path: projPath, type: 'repo', source: 'register', meta: { remote } });
    res.json({ ok: true, message: 'already registered' });
  }
});

// GET /api/assets
app.get('/api/assets', (req, res) => {
  res.json(db.getAssets(req.query.type));
});

// GET /api/projects
app.get('/api/projects', (req, res) => {
  res.json(db.getProjects());
});

app.listen(PORT, () => console.log(`Jarvis API on http://localhost:${PORT}`));

// Start Telegram bot if configured
if (process.env.TG_BOT_TOKEN && process.env.TG_CHAT_ID) {
  createBot(process.env.TG_BOT_TOKEN, process.env.TG_CHAT_ID, db);
  console.log('Telegram bot started');
} else {
  console.warn('TG_BOT_TOKEN or TG_CHAT_ID not set, bot disabled');
}

// Periodic inventory scan
function runScan() {
  console.log('Running inventory scan...');
  const assets = scanDirectory(SCAN_DIR);
  const services = scanServices();
  for (const asset of [...assets, ...services]) {
    db.upsertAsset(asset);
  }
  console.log(`Scan complete: ${assets.length + services.length} assets`);
}

runScan();
setInterval(runScan, SCAN_INTERVAL);
