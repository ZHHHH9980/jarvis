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
