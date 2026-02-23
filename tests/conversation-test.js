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
      console.log(`\u2705\n    \u300c${result.slice(0, 150)}\u300d`);
    } else {
      failed++;
      console.log(`\u274c expected one of [${checks.join(', ')}]\n    \u300c${result.slice(0, 200)}\u300d`);
    }
    return result;
  } catch (err) {
    failed++;
    console.log(`\ud83d\udca5 ${err.message}`);
    return '';
  }
}

function clearHistory() {
  history.length = 0;
  console.log('  --- \u6e05\u7a7a\u4e0a\u4e0b\u6587 ---');
}

async function main() {
  console.log('=== Jarvis \u591a\u8f6e\u5bf9\u8bdd\u538b\u529b\u6d4b\u8bd5 ===\n');

  // --- Round 1: Basic CRUD flow ---
  console.log('\ud83d\udccb Round 1: \u57fa\u672c CRUD \u6d41\u7a0b');
  await say('\u4f60\u597d', ['\u4f60\u597d', '\u55e8', 'Hi', 'hello', '\u5e2e'], 'Greeting');
  await say('CCM \u4e0a\u6709\u54ea\u4e9b\u9879\u76ee\uff1f', ['\u9879\u76ee', 'claude-code-manager'], 'List projects');
  await say('\u521b\u5efa\u4e00\u4e2a\u9879\u76ee\u53eb stress-test-proj\uff0c\u8def\u5f84 /opt/stress-test', ['stress-test-proj', '\u521b\u5efa', '\u6210\u529f'], 'Create project');
  await say('\u7ed9\u5b83\u521b\u5efa\u4e00\u4e2a\u4efb\u52a1\u53eb implement-auth\uff0c\u5206\u652f feat/auth', ['implement-auth', '\u521b\u5efa', '\u4efb\u52a1'], 'Create task with pronoun');
  await say('\u73b0\u5728\u6709\u54ea\u4e9b\u4efb\u52a1\uff1f', ['implement-auth', '\u4efb\u52a1'], 'List tasks after create');

  // --- Round 2: Context & pronouns ---
  console.log('\n\ud83d\udccb Round 2: \u4e0a\u4e0b\u6587\u548c\u4ee3\u8bcd\u7406\u89e3');
  await say('\u521a\u624d\u90a3\u4e2a\u9879\u76ee\u53eb\u4ec0\u4e48\uff1f', ['stress-test-proj'], 'Recall project name');
  await say('\u4efb\u52a1\u7684\u5206\u652f\u662f\u4ec0\u4e48\uff1f', ['feat/auth', 'auth'], 'Recall task branch');

  // --- Round 2.5: DELETE operations ---
  console.log('\n\ud83d\udccb Round 2.5: \u5220\u9664\u64cd\u4f5c');
  await say('\u5220\u6389 implement-auth \u8fd9\u4e2a\u4efb\u52a1', ['\u5220\u9664', '\u6210\u529f', '\u5df2\u5220', 'implement-auth'], 'Delete task by name');
  await say('\u73b0\u5728\u8fd8\u6709\u4efb\u52a1\u5417\uff1f', ['\u6ca1\u6709', '0', '\u65e0', '\u7a7a', '\u4efb\u52a1'], 'Verify task deleted');
  await say('\u5220\u6389 stress-test-proj \u8fd9\u4e2a\u9879\u76ee', ['\u5220\u9664', '\u6210\u529f', '\u5df2\u5220', 'stress-test-proj'], 'Delete project by name');
  await say('\u770b\u770b\u6709\u54ea\u4e9b\u9879\u76ee', ['\u9879\u76ee'], 'List after delete');

  // --- Round 3: Clear context ---
  console.log('\n\ud83d\udccb Round 3: \u6e05\u7a7a\u4e0a\u4e0b\u6587');
  await say('\u6e05\u7a7a\u804a\u5929\u8bb0\u5f55', ['__CLEAR_CONTEXT__', '\u6e05\u7a7a', '\u5df2\u6e05'], 'Natural clear context');
  clearHistory();
  await say('\u521a\u624d\u90a3\u4e2a\u9879\u76ee\u53eb\u4ec0\u4e48\uff1f', ['\u4e0d', '\u6ca1\u6709', '\u4ec0\u4e48', '\u54ea\u4e2a', '\u4e0a\u4e0b\u6587'], 'After clear - no context');

  // --- Round 4: Edge cases ---
  console.log('\n\ud83d\udccb Round 4: \u8fb9\u754c\u60c5\u51b5');
  await say('\u5e2e\u6211\u770b\u770c CCM \u72b6\u6001', ['\u9879\u76ee', '\u4efb\u52a1', 'CCM'], 'Ambiguous request');
  await say('\u521b\u5efa\u9879\u76ee', ['\u540d', '\u4ec0\u4e48', '\u9700\u8981', '\u54ea'], 'Incomplete create - missing params');
  await say('\u505c\u6b62\u4efb\u52a1 nonexistent-id-12345', ['\u9519\u8bef', '\u5931\u8d25', '\u627e\u4e0d\u5230', '\u4e0d\u5b58\u5728', 'error', '404', '500'], 'Stop nonexistent task');

  // --- Round 5: Full CRUD cycle with delete ---
  console.log('\n\ud83d\udccb Round 5: \u5b8c\u6574 CRUD \u5faa\u73af');
  clearHistory();
  await say('\u521b\u5efa\u9879\u76ee\u53eb delete-test-proj\uff0c\u8def\u5f84 /tmp/delete-test', ['delete-test-proj', '\u521b\u5efa', '\u6210\u529f'], 'Create project for delete test');
  await say('\u7ed9 delete-test-proj \u52a0\u4e2a\u4efb\u52a1\u53eb task-a\uff0c\u5206\u652f feat/a', ['task-a', '\u521b\u5efa', '\u4efb\u52a1'], 'Create task-a');
  await say('\u518d\u52a0\u4e00\u4e2a\u53eb task-b\uff0c\u5206\u652f feat/b', ['task-b', '\u521b\u5efa', '\u4efb\u52a1'], 'Create task-b');
  await say('\u5220\u6389 task-a', ['\u5220\u9664', '\u6210\u529f', '\u5df2\u5220', 'task-a'], 'Delete task-a');
  await say('\u73b0\u5728\u8fd8\u6709\u51e0\u4e2a\u4efb\u52a1\uff1f', ['1', 'task-b', '\u4efb\u52a1'], 'Verify only task-b remains');
  await say('\u628a delete-test-proj \u6574\u4e2a\u9879\u76ee\u5220\u4e86', ['\u5220\u9664', '\u6210\u529f', '\u5df2\u5220', 'delete-test-proj'], 'Delete entire project');

  // Summary
  console.log(`\n${'='.repeat(40)}`);
  console.log(`\u7ed3\u679c: ${passed} \u901a\u8fc7 / ${failed} \u5931\u8d25 / ${passed + failed} \u603b\u8ba1`);
  console.log(`\u901a\u8fc7\u7387: ${((passed / (passed + failed)) * 100).toFixed(0)}%`);
  process.exit(failed > 3 ? 1 : 0);
}

main();
