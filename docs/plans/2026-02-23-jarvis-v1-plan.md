# Jarvis V1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Telegram Bot that wraps Claude Code CLI for mobile 24h coding, with data asset awareness and one-click server revival.

**Architecture:** Express server hosts a Telegram Bot that receives messages, dispatches them to Claude Code CLI (`claude --print`), and streams results back. An inventory module scans the server for data assets (repos, databases, configs, services) and accepts registrations from projects. A notifier pushes alerts to Telegram on task completion or server issues.

**Tech Stack:** Node.js, node-telegram-bot-api, better-sqlite3, Express, child_process.spawn, pm2

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/index.js` (placeholder)

**Step 1: Initialize package.json**

```bash
cd ~/Documents/jarvis
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install express better-sqlite3 node-telegram-bot-api dotenv cors
npm install --save-dev vitest
```

**Step 3: Create .env.example**

```
TG_BOT_TOKEN=
TG_CHAT_ID=
ANTHROPIC_API_KEY=
API_BASE_URL=https://api.anthropic.com
NOTION_TOKEN=
PORT=3001
SCAN_DIR=~/projects
SCAN_INTERVAL_MS=3600000
```

**Step 4: Create .gitignore**

```
node_modules/
.env
*.db
data/
```

**Step 5: Create src/index.js placeholder**

```js
console.log('Jarvis starting...');
```

**Step 6: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore src/index.js
git commit -m "feat: project scaffolding"
```

---

### Task 2: SQLite Database (db.js)

**Files:**
- Create: `src/db.js`
- Create: `tests/db.test.js`

**Step 1: Write the failing test**

```js
// tests/db.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../src/db.js';

describe('db', () => {
  let db;
  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('creates projects table and inserts a project', () => {
    const p = db.createProject({ name: 'test', path: '/tmp/test', remote: 'https://github.com/x/test' });
    expect(p.name).toBe('test');
    expect(p.id).toBeDefined();
  });

  it('lists projects', () => {
    db.createProject({ name: 'a', path: '/a', remote: '' });
    db.createProject({ name: 'b', path: '/b', remote: '' });
    expect(db.getProjects()).toHaveLength(2);
  });

  it('creates manifest entries', () => {
    db.upsertAsset({ path: '/data.db', type: 'database', source: 'scan', meta: {} });
    db.upsertAsset({ path: '/app/.env', type: 'config', source: 'scan', meta: {} });
    const assets = db.getAssets();
    expect(assets).toHaveLength(2);
  });

  it('upserts manifest by path', () => {
    db.upsertAsset({ path: '/data.db', type: 'database', source: 'scan', meta: {} });
    db.upsertAsset({ path: '/data.db', type: 'database', source: 'register', meta: { size: '2MB' } });
    const assets = db.getAssets();
    expect(assets).toHaveLength(1);
    expect(assets[0].source).toBe('register');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db.test.js`
Expected: FAIL — cannot find `../src/db.js`

**Step 3: Write implementation**

```js
// src/db.js
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
      const stmt = db.prepare('INSERT INTO projects (name, path, remote) VALUES (?, ?, ?)');
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
```

**Step 4: Add vitest config to package.json**

Add to `package.json` scripts:
```json
"scripts": { "test": "vitest run" }
```

Note: tests use ESM `import` syntax. Add `"type": "module"` to vitest config or use a `vitest.config.js`:
```js
// vitest.config.js
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true } });
```

Since src uses `require` (CJS), tests should also use CJS or configure vitest to handle both. Simplest: make tests use `require` too:

Replace test file imports with:
```js
const { describe, it, expect, beforeEach } = require('vitest');
// ... vitest handles this automatically, just remove the import line
// vitest injects globals when globals: true
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/db.test.js`
Expected: PASS (4 tests)

**Step 6: Commit**

```bash
git add src/db.js tests/db.test.js vitest.config.js
git commit -m "feat: SQLite database with projects and assets tables"
```

---

### Task 3: Claude Runner (claude-runner.js)

**Files:**
- Create: `src/claude-runner.js`
- Create: `tests/claude-runner.test.js`

**Step 1: Write the failing test**

```js
// tests/claude-runner.test.js
const { describe, it, expect, vi } = require('vitest');

// We can't test actual claude CLI in unit tests, so test the output chunking logic
const { chunkMessage } = require('../src/claude-runner.js');

describe('claude-runner', () => {
  it('chunks long messages at 4000 chars', () => {
    const long = 'a'.repeat(10000);
    const chunks = chunkMessage(long, 4000);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(4000);
    expect(chunks[2]).toHaveLength(2000);
  });

  it('returns single chunk for short messages', () => {
    const chunks = chunkMessage('hello', 4000);
    expect(chunks).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/claude-runner.test.js`
Expected: FAIL

**Step 3: Write implementation**

```js
// src/claude-runner.js
const { spawn } = require('child_process');

function chunkMessage(text, maxLen = 4000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks.length ? chunks : [''];
}

function runClaude(prompt, cwd, onChunk) {
  return new Promise((resolve, reject) => {
    const args = ['--print', prompt];
    const proc = spawn('claude', args, {
      cwd,
      env: { ...process.env },
      shell: true,
    });

    let output = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      if (onChunk) onChunk(text);
    });

    proc.stderr.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`claude exited with code ${code}: ${output}`));
    });

    proc.on('error', (err) => reject(err));
  });
}

module.exports = { runClaude, chunkMessage };
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/claude-runner.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/claude-runner.js tests/claude-runner.test.js
git commit -m "feat: claude runner with output chunking"
```

---

### Task 4: Inventory Scanner (inventory.js)

**Files:**
- Create: `src/inventory.js`
- Create: `tests/inventory.test.js`

**Step 1: Write the failing test**

```js
// tests/inventory.test.js
const { describe, it, expect } = require('vitest');
const { scanDirectory } = require('../src/inventory.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('inventory', () => {
  it('finds .db files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-test-'));
    fs.writeFileSync(path.join(tmp, 'test.db'), '');
    fs.mkdirSync(path.join(tmp, 'sub'));
    fs.writeFileSync(path.join(tmp, 'sub', 'data.sqlite'), '');

    const results = scanDirectory(tmp);
    const dbs = results.filter(r => r.type === 'database');
    expect(dbs).toHaveLength(2);

    fs.rmSync(tmp, { recursive: true });
  });

  it('finds .env files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-test-'));
    fs.writeFileSync(path.join(tmp, '.env'), 'SECRET=x');
    fs.writeFileSync(path.join(tmp, '.env.local'), 'Y=z');

    const results = scanDirectory(tmp);
    const configs = results.filter(r => r.type === 'config');
    expect(configs).toHaveLength(2);

    fs.rmSync(tmp, { recursive: true });
  });

  it('finds git repos', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-test-'));
    const repo = path.join(tmp, 'myrepo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });

    const results = scanDirectory(tmp);
    const repos = results.filter(r => r.type === 'repo');
    expect(repos).toHaveLength(1);
    expect(repos[0].path).toBe(repo);

    fs.rmSync(tmp, { recursive: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/inventory.test.js`
Expected: FAIL

**Step 3: Write implementation**

```js
// src/inventory.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function scanDirectory(dir, maxDepth = 3) {
  const assets = [];
  walk(dir, 0, maxDepth, assets);
  return assets;
}

function walk(dir, depth, maxDepth, assets) {
  if (depth > maxDepth) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }

  const hasGit = entries.some(e => e.name === '.git' && e.isDirectory());
  if (hasGit) {
    const remote = getGitRemote(dir);
    assets.push({ path: dir, type: 'repo', source: 'scan', meta: { remote } });
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.git') continue;

    if (entry.isFile()) {
      if (/\.(db|sqlite|sqlite3)$/.test(entry.name)) {
        const size = fs.statSync(full).size;
        assets.push({ path: full, type: 'database', source: 'scan', meta: { size } });
      }
      if (/^\.env/.test(entry.name)) {
        assets.push({ path: full, type: 'config', source: 'scan', meta: { sensitive: true } });
      }
    }

    if (entry.isDirectory()) {
      walk(full, depth + 1, maxDepth, assets);
    }
  }
}

function getGitRemote(dir) {
  try {
    return execSync('git remote get-url origin', { cwd: dir, encoding: 'utf8' }).trim();
  } catch { return ''; }
}

function scanServices() {
  const services = [];
  try {
    const pm2Out = execSync('pm2 jlist', { encoding: 'utf8' });
    const list = JSON.parse(pm2Out);
    for (const proc of list) {
      services.push({
        path: proc.pm2_env?.pm_cwd || proc.name,
        type: 'service',
        source: 'scan',
        meta: { name: proc.name, status: proc.pm2_env?.status, pm_id: proc.pm_id },
      });
    }
  } catch {}
  return services;
}

module.exports = { scanDirectory, scanServices };
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/inventory.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/inventory.js tests/inventory.test.js
git commit -m "feat: inventory scanner for repos, databases, configs"
```

---

### Task 5: Notifier (notifier.js)

**Files:**
- Create: `src/notifier.js`

**Step 1: Write implementation**

No unit test needed — this is a thin wrapper around the Telegram Bot `sendMessage` API. Integration tested in Task 7.

```js
// src/notifier.js
let botInstance = null;
let chatId = null;

function init(bot, targetChatId) {
  botInstance = bot;
  chatId = targetChatId;
}

async function notify(message) {
  if (!botInstance || !chatId) return;
  const { chunkMessage } = require('./claude-runner.js');
  const chunks = chunkMessage(message, 4000);
  for (const chunk of chunks) {
    await botInstance.sendMessage(chatId, chunk);
  }
}

module.exports = { init, notify };
```

**Step 2: Commit**

```bash
git add src/notifier.js
git commit -m "feat: notifier module for Telegram push"
```

---

### Task 6: Telegram Bot (telegram-bot.js)

**Files:**
- Create: `src/telegram-bot.js`

**Step 1: Write implementation**

```js
// src/telegram-bot.js
const TelegramBot = require('node-telegram-bot-api');
const { runClaude, chunkMessage } = require('./claude-runner.js');
const { scanDirectory, scanServices } = require('./inventory.js');
const notifier = require('./notifier.js');
const os = require('os');
const { execSync } = require('child_process');

let currentProject = null; // { id, name, path }

function createBot(token, chatId, db) {
  const bot = new TelegramBot(token, { polling: true });
  notifier.init(bot, chatId);

  // /projects command
  bot.onText(/\/projects/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    const projects = db.getProjects();
    if (!projects.length) {
      bot.sendMessage(chatId, '没有项目。用 /register 或等待自动扫描。');
      return;
    }
    const list = projects.map((p, i) => `${i + 1}. ${p.name} (${p.path})`).join('\n');
    bot.sendMessage(chatId, `📂 项目列表\n${list}\n\n发数字选择项目`);
    bot._waitingProjectSelect = true;
  });

  // /status command
  bot.onText(/\/status/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    const cpuCount = os.cpus().length;
    const memFree = Math.round(os.freemem() / 1024 / 1024);
    const memTotal = Math.round(os.totalmem() / 1024 / 1024);
    let diskInfo = '';
    try { diskInfo = execSync("df -h / | tail -1 | awk '{print $5}'", { encoding: 'utf8' }).trim(); }
    catch { diskInfo = 'N/A'; }

    const services = scanServices();
    const svcList = services.map(s => `  ${s.meta.name}: ${s.meta.status}`).join('\n') || '  无';

    bot.sendMessage(chatId,
      `📊 服务器状态\nCPU: ${cpuCount} cores | 内存: ${memFree}MB free / ${memTotal}MB\n磁盘: ${diskInfo}\n\n服务:\n${svcList}\n\n当前项目: ${currentProject ? currentProject.name : '未选择'}`
    );
  });

  // /inventory command
  bot.onText(/\/inventory/, async (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    const assets = db.getAssets();
    if (!assets.length) {
      bot.sendMessage(chatId, '资产清单为空。等待扫描或项目注册。');
      return;
    }
    const grouped = {};
    for (const a of assets) {
      if (!grouped[a.type]) grouped[a.type] = [];
      grouped[a.type].push(a.path);
    }
    let text = '📋 数据资产清单\n';
    for (const [type, paths] of Object.entries(grouped)) {
      text += `\n${type} (${paths.length}):\n`;
      for (const p of paths) text += `  ${p}\n`;
    }
    bot.sendMessage(chatId, text);
  });

  // /backup command
  bot.onText(/\/backup/, async (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    bot.sendMessage(chatId, '🔄 备份功能在 V2 实现。当前请手动 rsync。');
  });

  // /migrate command
  bot.onText(/\/migrate/, async (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    bot.sendMessage(chatId, '🔄 迁移功能在 V2 实现。当前请手动操作。');
  });

  // General message handler
  bot.on('message', async (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    if (msg.text?.startsWith('/')) return; // skip commands

    const text = msg.text?.trim();
    if (!text) return;

    // Project selection
    if (bot._waitingProjectSelect && /^\d+$/.test(text)) {
      const projects = db.getProjects();
      const idx = parseInt(text) - 1;
      if (idx >= 0 && idx < projects.length) {
        currentProject = projects[idx];
        bot.sendMessage(chatId, `已切换到 ${currentProject.name}，说吧`);
      } else {
        bot.sendMessage(chatId, '无效选择');
      }
      bot._waitingProjectSelect = false;
      return;
    }
    bot._waitingProjectSelect = false;

    // Chat mode — send to Claude Code
    if (!currentProject) {
      bot.sendMessage(chatId, '先用 /projects 选一个项目');
      return;
    }

    bot.sendMessage(chatId, `⏳ 执行中...`);
    try {
      const output = await runClaude(text, currentProject.path);
      const chunks = chunkMessage(output, 4000);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk);
      }
    } catch (err) {
      bot.sendMessage(chatId, `❌ 错误: ${err.message}`);
    }
  });

  return bot;
}

module.exports = { createBot };
```

**Step 2: Commit**

```bash
git add src/telegram-bot.js
git commit -m "feat: Telegram bot with /projects, /status, /inventory, chat mode"
```

---

### Task 7: Express Server + Registration API (index.js)

**Files:**
- Modify: `src/index.js`

**Step 1: Write implementation**

```js
// src/index.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { createDb } = require('./db.js');
const { createBot } = require('./telegram-bot.js');
const { scanDirectory, scanServices } = require('./inventory.js');
const notifier = require('./notifier.js');

const PORT = process.env.PORT || 3001;
const SCAN_DIR = (process.env.SCAN_DIR || '~/projects').replace('~', process.env.HOME);
const SCAN_INTERVAL = parseInt(process.env.SCAN_INTERVAL_MS) || 3600000;

// Ensure data directory
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = createDb(path.join(dataDir, 'jarvis.db'));

// Express for registration API
const app = express();
app.use(express.json());

app.post('/api/register', (req, res) => {
  const { name, path: projPath, remote } = req.body;
  if (!name || !projPath) return res.status(400).json({ error: 'name and path required' });
  try {
    const project = db.createProject({ name, path: projPath, remote: remote || '' });
    db.upsertAsset({ path: projPath, type: 'repo', source: 'register', meta: { remote } });
    res.json(project);
  } catch (err) {
    // Duplicate path — just update last_seen
    db.upsertAsset({ path: projPath, type: 'repo', source: 'register', meta: { remote } });
    res.json({ ok: true, message: 'already registered' });
  }
});

app.get('/api/assets', (req, res) => {
  res.json(db.getAssets(req.query.type));
});

app.get('/api/projects', (req, res) => {
  res.json(db.getProjects());
});

app.listen(PORT, () => {
  console.log(`Jarvis API on http://localhost:${PORT}`);
});

// Telegram Bot
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

runScan(); // initial scan
setInterval(runScan, SCAN_INTERVAL);
```

**Step 2: Commit**

```bash
git add src/index.js
git commit -m "feat: Express server with registration API and periodic scan"
```

---

### Task 8: revive.sh

**Files:**
- Create: `revive.sh`

**Step 1: Write implementation**

```bash
#!/bin/bash
set -e

GREEN='\033[0;32m'
NC='\033[0m'
info() { echo -e "${GREEN}✓${NC} $1"; }

echo "=== Jarvis Revival ==="
echo ""

# 1. Install basics
if ! command -v node &>/dev/null; then
  info "Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! command -v git &>/dev/null; then
  apt-get install -y git
fi

if ! command -v tmux &>/dev/null; then
  apt-get install -y tmux
fi

# 2. Clone Jarvis
JARVIS_DIR="$HOME/jarvis"
if [ -d "$JARVIS_DIR" ]; then
  info "Jarvis directory exists, pulling latest..."
  cd "$JARVIS_DIR" && git pull origin main
else
  info "Cloning Jarvis..."
  git clone https://github.com/ZHHHH9980/jarvis.git "$JARVIS_DIR"
fi
cd "$JARVIS_DIR"

# 3. Collect secrets
echo ""
echo "Enter your secrets (press Enter to skip optional ones):"
read -p "Telegram Bot Token: " TG_BOT_TOKEN
read -p "Telegram Chat ID: " TG_CHAT_ID
read -p "Anthropic API Key: " ANTHROPIC_API_KEY
read -p "API Base URL [https://api.anthropic.com]: " API_BASE_URL
API_BASE_URL=${API_BASE_URL:-https://api.anthropic.com}
read -p "Notion Token (optional): " NOTION_TOKEN

# 4. Generate .env
cat > .env << EOF
TG_BOT_TOKEN=$TG_BOT_TOKEN
TG_CHAT_ID=$TG_CHAT_ID
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
API_BASE_URL=$API_BASE_URL
NOTION_TOKEN=$NOTION_TOKEN
PORT=3001
SCAN_DIR=$HOME/projects
SCAN_INTERVAL_MS=3600000
EOF
info "Generated .env"

# 5. Install deps + start
npm install
npx pm2 start src/index.js --name jarvis
npx pm2 save
info "Jarvis started with pm2"

# 6. Install claude-workflow
WORKFLOW_DIR="$HOME/claude-workflow"
if [ ! -d "$WORKFLOW_DIR" ]; then
  git clone https://github.com/ZHHHH9980/claude-workflow.git "$WORKFLOW_DIR"
  "$WORKFLOW_DIR/install.sh"
  info "claude-workflow installed"
fi

echo ""
info "Jarvis is alive! 🤖"
echo "  API: http://localhost:3001"
echo "  Telegram: bot is listening"
echo ""
echo "  Next: install Claude Code CLI and run 'claude login'"
```

**Step 2: Make executable and commit**

```bash
chmod +x revive.sh
git add revive.sh
git commit -m "feat: one-click revival script"
```

---

### Task 9: Update claude-workflow registration hook

**Files:**
- Modify: `~/Documents/claude-workflow/hooks/session-start.sh`

**Step 1: Add registration curl to session-start.sh**

After the existing `git pull` and symlink logic, add:

```bash
# Register project with Jarvis (if running)
PROJECT_DIR=$(pwd)
PROJECT_NAME=$(basename "$PROJECT_DIR")
curl -s http://localhost:3001/api/register \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$PROJECT_NAME\",\"path\":\"$PROJECT_DIR\"}" \
  2>/dev/null || true
```

**Step 2: Commit in claude-workflow repo**

```bash
cd ~/Documents/claude-workflow
git add hooks/session-start.sh
git commit -m "feat: register project with Jarvis on session start"
git push origin main
```

---

### Task 10: Deploy + End-to-End Test

**Step 1: Create deploy.sh**

```bash
#!/bin/bash
set -e
SERVER="root@43.138.129.193"
REMOTE_DIR="/root/jarvis"

echo "Deploying Jarvis..."
rsync -avz --exclude node_modules --exclude .env --exclude data --exclude '*.db' \
  ~/Documents/jarvis/ $SERVER:$REMOTE_DIR/

ssh $SERVER "cd $REMOTE_DIR && npm install && npx pm2 restart jarvis || npx pm2 start src/index.js --name jarvis && npx pm2 save"

echo "✅ Deployed"
```

**Step 2: Deploy and test**

```bash
chmod +x deploy.sh
./deploy.sh
```

**Step 3: Test on Telegram**

1. Open Telegram, find your bot
2. Send `/projects` — should show project list (or empty)
3. Send `/status` — should show server stats
4. Send `/inventory` — should show scanned assets

**Step 4: Commit deploy script**

```bash
git add deploy.sh
git commit -m "feat: deploy script for Tencent Cloud"
git push origin main
```
