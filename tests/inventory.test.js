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
