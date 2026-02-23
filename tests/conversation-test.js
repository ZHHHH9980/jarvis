#!/usr/bin/env node
// Multi-turn conversation test - simulates a real user chatting with Jarvis
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chatAPI } = require('../src/claude-runner.js');

const history = [];
let passed = 0;
let failed = 0;

async function say(msg, expectContains, desc) {
  const label = desc || msg.slice(0, 40);
  process.stdout.write(`  [${passed + failed + 1}] ${label}... `);
  try {
    const result = await chatAPI(msg, null, history);
    history.push({ role: 'user', content: msg });
    history.push({ role: 'assistant', content: result });
    if (history.length > 20) history.splice(0, history.length - 20);

    const checks = Array.isArray(expectContains) ? expectContains : [expectContains];
    const ok = checks.some((c) => result.includes(c));
    if (ok) {
      passed++;
      console.log(`✅\n    「${result.slice(0, 150)}」`);
    } else {
      failed++;
      console.log(`❌ expected one of [${checks.join(', ')}]\n    「${result.slice(0, 200)}」`);
    }
    return result;
  } catch (err) {
    failed++;
    console.log(`💥 ${err.message}`);
    return '';
  }
}

function clearHistory() {
  history.length = 0;
  console.log('  --- 清空上下文 ---');
}

async function main() {
  console.log('=== Jarvis 多轮对话压力测试 ===\n');

  // --- Round 1: Basic CRUD flow ---
  console.log('📋 Round 1: 基本 CRUD 流程');
  await say('你好', ['你好', '嗨', 'Hi', 'hello', '帮'], 'Greeting');
  await say('CCM 上有哪些项目？', ['项目', 'claude-code-manager'], 'List projects');
  await say('创建一个项目叫 stress-test-proj，路径 /opt/stress-test', ['stress-test-proj', '创建', '成功'], 'Create project');
  await say('给它创建一个任务叫 implement-auth，分支 feat/auth', ['implement-auth', '创建', '任务'], 'Create task with pronoun');
  await say('现在有哪些任务？', ['implement-auth', '任务'], 'List tasks after create');

  // --- Round 2: Context & pronouns ---
  console.log('\n📋 Round 2: 上下文和代词理解');
  await say('刚才那个项目叫什么？', ['stress-test-proj'], 'Recall project name');
  await say('任务的分支是什么？', ['feat/auth', 'auth'], 'Recall task branch');
  await say('��掉那个项目', ['不支持', '删除', 'stress-test-proj'], 'Delete with pronoun');

  // --- Round 3: Clear context ---
  console.log('\n📋 Round 3: 清空上下文');
  await say('清空聊天记录', ['__CLEAR_CONTEXT__', '清空', '已清'], 'Natural clear context');
  // After clear, manually reset history to simulate what bot does
  clearHistory();
  await say('刚才那个项目叫什么？', ['不', '没有', '什么', '哪个', '上下文'], 'After clear - no context');

  // --- Round 4: Edge cases ---
  console.log('\n📋 Round 4: 边界情况');
  await say('帮我看看 CCM 状态', ['项目', '任务', 'CCM'], 'Ambiguous request');
  await say('创建项目', ['名', '什么', '需要', '哪'], 'Incomplete create - missing params');
  await say('停止任务 nonexistent-id-12345', ['错误', '失败', '找不到', '不存在', 'error', '404', '500'], 'Stop nonexistent task');

  // --- Round 5: Multi-step conversation ---
  console.log('\n📋 Round 5: 连续多步操作');
  clearHistory();
  await say('看看有什么项目', ['项目'], 'Fresh start - list projects');
  await say('给 stress-test-proj 加个任务叫 fix-css，分支 fix/css-layout', ['fix-css', '创建', '任务'], 'Create another task');
  await say('再加一个叫 add-tests，分支 test/unit', ['add-tests', '创建', '任务'], 'Create yet another task');
  await say('现在这个项目有几个任务？', ['任务', '2', '3', 'fix-css', 'add-tests', 'implement-auth'], 'Count tasks');

  // Summary
  console.log(`\n${'='.repeat(40)}`);
  console.log(`结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
  console.log(`通过率: ${((passed / (passed + failed)) * 100).toFixed(0)}%`);
  process.exit(failed > 3 ? 1 : 0); // Allow up to 3 failures for edge cases
}

main();
