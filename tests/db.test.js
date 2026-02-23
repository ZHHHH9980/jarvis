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
