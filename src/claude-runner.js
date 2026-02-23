const { spawn } = require('child_process');

const SSH_HOST = process.env.SSH_HOST || '';
const SSH_USER = process.env.SSH_USER || 'root';
const API_BASE = process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com';
const API_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || '';
const CCM_URL = process.env.CCM_URL || 'http://43.138.129.193:3000';

function stripAnsi(str) {
  return str.replace(/\x1B\[[^@-~]*[@-~]|\x1B\][^\x07]*\x07|\x1B[^[\]].|[\r]/g, '');
}

function chunkMessage(text, maxLen = 4000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks.length ? chunks : [''];
}

// --- Intent classification prompt ---
const INTENT_PROMPT = `分析这句话的意图，只返回一个 JSON 对象，不要其他文字。
可能的 intent: chat, list_projects, list_tasks, create_project, create_task, start_task, stop_task, delete_project, delete_task。
如果有参数也提取出来（name, repo_path, title, projectId, projectName, branch, taskId, taskName）。
如果用户提到项目名而不是 ID，用 projectName 字段。如果提到任务名而不是 ID，用 taskName 字段。
如果用户用代词（它、这个、那个）指代之前提到的东西，根据对话上下文推断具体指什么。

`;

// --- CCM API execution ---
async function executeCCM(intent, params) {
  console.log(`[ccm] ${intent}`, JSON.stringify(params));
  try {
    let r;
    switch (intent) {
      case 'list_projects':
        r = await fetch(`${CCM_URL}/api/projects`, { signal: AbortSignal.timeout(8000) });
        break;
      case 'list_tasks': {
        const q = params.projectId ? `?projectId=${params.projectId}` : '';
        r = await fetch(`${CCM_URL}/api/tasks${q}`, { signal: AbortSignal.timeout(8000) });
        break;
      }
      case 'create_project':
        r = await fetch(`${CCM_URL}/api/projects`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: params.name || params.projectName, repo_path: params.repo_path || params.path || '' }),
          signal: AbortSignal.timeout(8000),
        });
        break;
      case 'create_task':
        r = await fetch(`${CCM_URL}/api/tasks`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: params.title, projectId: params.projectId, branch: params.branch }),
          signal: AbortSignal.timeout(8000),
        });
        break;
      case 'start_task':
        r = await fetch(`${CCM_URL}/api/tasks/${params.taskId}/start`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params), signal: AbortSignal.timeout(8000),
        });
        break;
      case 'stop_task':
        r = await fetch(`${CCM_URL}/api/tasks/${params.taskId}/stop`, {
          method: 'POST', signal: AbortSignal.timeout(8000),
        });
        break;
      default:
        return null;
    }
    const text = await r.text();
    console.log(`[ccm] ${intent} -> ${r.status}: ${text.slice(0, 200)}`);
    try { return JSON.parse(text); } catch { return { raw: text, status: r.status }; }
  } catch (err) {
    return { error: err.message };
  }
}

// Resolve projectName → projectId by looking up projects
async function resolveProjectName(name) {
  try {
    const r = await fetch(`${CCM_URL}/api/projects`, { signal: AbortSignal.timeout(5000) });
    const projects = await r.json();
    const match = projects.find((p) => p.name === name || p.name.includes(name));
    return match || null;
  } catch { return null; }
}

// Resolve taskName → taskId by looking up tasks
async function resolveTaskName(name, projectId) {
  try {
    const q = projectId ? `?projectId=${projectId}` : '';
    const r = await fetch(`${CCM_URL}/api/tasks${q}`, { signal: AbortSignal.timeout(5000) });
    const tasks = await r.json();
    const match = tasks.find((t) => t.title === name || t.title.includes(name));
    return match || null;
  } catch { return null; }
}

// Call relay API for text generation
async function callLLM(messages) {
  const res = await fetch(`${API_BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': API_TOKEN,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4096, messages }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// Two-phase chat: intent classification → execute → summarize
async function chatAPI(prompt, systemPrompt, history = []) {
  // Build context from recent history for intent classification
  const recentHistory = history.slice(-6); // last 3 exchanges
  let contextBlock = '';
  if (recentHistory.length > 0) {
    contextBlock = '对话上下文：\n' + recentHistory.map((m) =>
      `${m.role === 'user' ? '用户' : 'Jarvis'}：${m.content.slice(0, 200)}`
    ).join('\n') + '\n\n';
  }

  // Phase 1: Classify intent
  const intentText = await callLLM([{ role: 'user', content: INTENT_PROMPT + contextBlock + '用户说：' + prompt }]);
  console.log(`[intent] raw: ${intentText}`);

  let parsed;
  try {
    const jsonMatch = intentText.match(/```json\s*([\s\S]*?)```/) || intentText.match(/(\{[\s\S]*\})/);
    parsed = JSON.parse(jsonMatch[1].trim());
  } catch {
    parsed = { intent: 'chat' };
  }

  const { intent, params: _p, ...rest } = parsed;
  const params = { ..._p, ...rest };
  console.log(`[intent] ${intent}`, JSON.stringify(params));

  // For plain chat, respond with history context
  if (intent === 'chat') {
    const msgs = [...recentHistory, { role: 'user', content: prompt }];
    return callLLM(msgs);
  }

  // Delete operations - CCM doesn't support DELETE yet
  if (intent === 'delete_project' || intent === 'delete_task') {
    const what = intent === 'delete_project' ? '项目' : '任务';
    const name = params.projectName || params.name || params.taskName || params.taskId || '未知';
    return `抱歉，CCM 目前不支持删除${what}。你提到的「${name}」需要在 CCM 后台手动删除，或者等 CCM 加上删除接口。`;
  }

  // Resolve names to IDs if needed
  if (params.projectName && !params.projectId) {
    const proj = await resolveProjectName(params.projectName);
    if (proj) params.projectId = proj.id;
  }
  if (params.taskName && !params.taskId) {
    const task = await resolveTaskName(params.taskName, params.projectId);
    if (task) params.taskId = task.id;
  }

  // Phase 2: Execute CCM operation
  const result = await executeCCM(intent, params);

  // Phase 3: Summarize results with conversation context
  const summaryMsgs = [
    ...recentHistory,
    { role: 'user', content: prompt },
    { role: 'assistant', content: `我查询了 CCM，结果如下：\n${JSON.stringify(result, null, 2)}` },
    { role: 'user', content: '请用简洁自然的中文总结上面的结果给我' },
  ];
  const summary = await callLLM(summaryMsgs);

  return summary;
}

// CLI via SSH (fallback for heavy code work)
function runClaude(prompt, cwd, onChunk) {
  return new Promise((resolve, reject) => {
    let proc;
    if (SSH_HOST) {
      const escaped = prompt.replace(/'/g, "'\\''");
      const tools = 'Bash Read Write Edit Glob Grep';
      const cmd = `source ~/.bashrc 2>/dev/null; cd '${cwd}' && claude --print '${escaped}' --allowedTools ${tools}`;
      proc = spawn('ssh', ['-tt', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10', `${SSH_USER}@${SSH_HOST}`, cmd]);
    } else {
      proc = spawn('claude', ['--print', prompt], { cwd, env: { ...process.env }, shell: true });
    }
    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); if (onChunk) onChunk(d.toString()); });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('close', (code) => {
      const clean = SSH_HOST ? stripAnsi(output).trim() : output;
      if (code === 0) resolve(clean); else reject(new Error(`claude exited ${code}: ${clean}`));
    });
    proc.on('error', (err) => reject(err));
  });
}

module.exports = { runClaude, chatAPI, chunkMessage };
