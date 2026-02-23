#!/usr/bin/env node
// End-to-end CRUD test for Jarvis chatAPI (two-phase: intent → execute → summarize)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chatAPI } = require('../src/claude-runner.js');

const CCM_URL = process.env.CCM_URL || 'http://43.138.129.193:3000';

async function cleanup(ids) {
  for (const id of ids) {
    try {
      await fetch(`${CCM_URL}/api/projects/${id}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) });
    } catch {}
  }
}

async function test(name, prompt, check) {
  process.stdout.write(`  ${name}... `);
  try {
    const result = await chatAPI(prompt);
    console.log(`OK\n    Response: ${result.slice(0, 200)}`);
    if (check && !check(result)) {
      console.log(`    ⚠ Check failed but got response`);
      return { ok: false, result };
    }
    return { ok: true, result };
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function main() {
  console.log('=== Jarvis chatAPI CRUD Tests ===\n');
  const results = [];

  // 1. List projects
  results.push(await test(
    'List projects',
    '列出 CCM 上所有项目',
    (r) => r.includes('claude-code-manager') || r.includes('项目')
  ));

  // 2. Create project
  results.push(await test(
    'Create project',
    '在 CCM 上创建一个新项目，名字叫 jarvis-crud-test，路径是 /opt/test-repo',
    (r) => r.includes('jarvis-crud-test') || r.includes('创建') || r.includes('成功')
  ));

  // 3. List tasks
  results.push(await test(
    'List tasks',
    '看看 CCM 上有哪些任务',
    (r) => r.length > 10
  ));

  // 4. Create task
  results.push(await test(
    'Create task',
    '在 jarvis-crud-test 项目下创建一个任务，标题是 test-crud-task，分支 feature/crud-test',
    (r) => r.includes('test-crud-task') || r.includes('创建') || r.includes('任务')
  ));

  // 5. Chat (non-CCM)
  results.push(await test(
    'General chat',
    '你好，今天天气怎么样',
    (r) => r.length > 5
  ));

  // Summary
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== Results: ${passed}/${results.length} passed ===`);

  // Cleanup
  console.log('\nCleaning up...');
  try {
    const res = await fetch(`${CCM_URL}/api/projects`, { signal: AbortSignal.timeout(5000) });
    const projects = await res.json();
    const testProjects = projects.filter((p) =>
      ['jarvis-crud-test', 'crud-test-project', 'test-jarvis', 'test-by-jarvis-3'].includes(p.name)
    );
    await cleanup(testProjects.map((p) => p.id));
    console.log(`Cleaned ${testProjects.length} test projects`);
  } catch (err) {
    console.log(`Cleanup failed: ${err.message}`);
  }

  process.exit(passed === results.length ? 0 : 1);
}

main();
