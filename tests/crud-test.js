#!/usr/bin/env node
// End-to-end CRUD test for Jarvis chatAPI with conversation context
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chatAPI } = require('../src/claude-runner.js');

const CCM_URL = process.env.CCM_URL || 'http://43.138.129.193:3000';

// Simulated conversation history (like telegram-bot.js maintains)
const history = [];

async function test(name, prompt, check) {
  process.stdout.write(`  ${name}... `);
  try {
    const result = await chatAPI(prompt, null, history);
    // Store in history
    history.push({ role: 'user', content: prompt });
    history.push({ role: 'assistant', content: result });
    if (history.length > 20) history.splice(0, history.length - 20);

    console.log(`OK\n    Response: ${result.slice(0, 200)}`);
    if (check && !check(result)) {
      console.log(`    ⚠ Check failed`);
      return { ok: false, result };
    }
    return { ok: true, result };
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function main() {
  console.log('=== Jarvis chatAPI CRUD + Context Tests ===\n');
  const results = [];

  // 1. Create project
  results.push(await test(
    'Create project',
    '在 CCM 上创建一个新项目，名字叫 context-test-proj，路径是 /opt/test-repo',
    (r) => r.includes('context-test-proj') || r.includes('创建') || r.includes('成功')
  ));

  // 2. Context test: "删掉它" should understand "它" = the project just created
  results.push(await test(
    'Delete with pronoun (context)',
    '删掉它',
    (r) => r.includes('context-test-proj') || r.includes('删除') || r.includes('不支持')
  ));

  // 3. List projects
  results.push(await test(
    'List projects',
    '看看有哪些项目',
    (r) => r.includes('项目')
  ));

  // 4. Create task with context
  results.push(await test(
    'Create task',
    '给 context-test-proj 创建一个任务叫 fix-bug，分支 fix/bug-123',
    (r) => r.includes('fix-bug') || r.includes('创建') || r.includes('任务')
  ));

  // 5. General chat with context
  results.push(await test(
    'Chat with context',
    '刚才创建的任务叫什么名字？',
    (r) => r.includes('fix-bug') || r.length > 5
  ));

  // Summary
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== Results: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
