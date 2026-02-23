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

// --- Tool definitions for Claude API ---
const TOOLS = [
  {
    name: 'ccm_projects',
    description: '获取 CCM 上的所有项目��表',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ccm_tasks',
    description: '获取 CCM 上的任务列表，可按项目筛选',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '项目 ID（可选）' },
      },
    },
  },
  {
    name: 'ccm_create_task',
    description: '在 CCM 上创建新任务',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题' },
        projectId: { type: 'string', description: '项目 ID' },
        branch: { type: 'string', description: 'Git 分支名' },
      },
      required: ['title', 'projectId', 'branch'],
    },
  },
  {
    name: 'ccm_start_task',
    description: '启动 CCM 上的一个任务（会创建 Claude Code 会话）',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        worktreePath: { type: 'string', description: '工作目录路径' },
        branch: { type: 'string', description: 'Git 分支' },
        model: { type: 'string', description: '模型名，默认 claude-sonnet-4-5' },
      },
      required: ['taskId', 'worktreePath', 'branch'],
    },
  },
  {
    name: 'ccm_stop_task',
    description: '停止 CCM 上正在运行的任务',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
      },
      required: ['taskId'],
    },
  },
];

// --- Tool execution ---
async function executeTool(name, input) {
  try {
    switch (name) {
      case 'ccm_projects': {
        const r = await fetch(`${CCM_URL}/api/projects`, { signal: AbortSignal.timeout(8000) });
        return await r.json();
      }
      case 'ccm_tasks': {
        const q = input.projectId ? `?projectId=${input.projectId}` : '';
        const r = await fetch(`${CCM_URL}/api/tasks${q}`, { signal: AbortSignal.timeout(8000) });
        return await r.json();
      }
      case 'ccm_create_task': {
        const r = await fetch(`${CCM_URL}/api/tasks`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(8000),
        });
        return await r.json();
      }
      case 'ccm_start_task': {
        const r = await fetch(`${CCM_URL}/api/tasks/${input.taskId}/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(8000),
        });
        return await r.json();
      }
      case 'ccm_stop_task': {
        const r = await fetch(`${CCM_URL}/api/tasks/${input.taskId}/stop`, {
          method: 'POST',
          signal: AbortSignal.timeout(8000),
        });
        return await r.json();
      }
      default:
        return { error: `unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err.message };
  }
}

// Chat with tool use loop
async function chatAPI(prompt, systemPrompt) {
  const messages = [{ role: 'user', content: prompt }];

  for (let i = 0; i < 5; i++) {
    const body = {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      tools: TOOLS,
      messages,
    };
    if (systemPrompt) body.system = systemPrompt;

    const res = await fetch(`${API_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': API_TOKEN,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API ${res.status}: ${err}`);
    }

    const data = await res.json();
    const toolUses = data.content.filter((b) => b.type === 'tool_use');

    if (toolUses.length === 0 || data.stop_reason === 'end_turn') {
      return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    }

    // Execute tools and continue
    messages.push({ role: 'assistant', content: data.content });
    const toolResults = [];
    for (const tu of toolUses) {
      const result = await executeTool(tu.name, tu.input);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return '(达到工具调用上限)';
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
