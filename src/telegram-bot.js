const os = require('os');
const { execSync } = require('child_process');
const TelegramBot = require('node-telegram-bot-api');
const { runClaude, chatAPI, chunkMessage } = require('./claude-runner.js');
const { init: initNotifier } = require('./notifier.js');

const CCM_URL = process.env.CCM_URL || 'http://43.138.129.193:3000';

const SYSTEM_PROMPT_BASE = `你是 Jarvis，用户的私人智能助手和开发调度中心。
你可以通过工具查看 CCM（Claude Code Manager）上的项目和任务状态，也可以创建、启动、停止任务。
用户可能会用很随意的方式跟你说话，你要理解意图并主动行动。
比如用户说"看看 CCM 怎么样了"，你就调用工具查项目和任务状态。
比如用户说"给 ccm 开个任务修 bug"，你就创建并启动任务。
简洁、自然地回复，像一个靠谱的助手。`;

function createBot(token, chatId, db) {
  const numericChatId = Number(chatId);
  const bot = new TelegramBot(token, { polling: true });
  initNotifier(bot, numericChatId);

  const state = {
    currentProject: null,
    waitingForSelection: false,
    projectList: [],
    chatHistory: [], // Recent conversation for context (max 20 messages)
  };

  function auth(msg) {
    return msg.chat.id === numericChatId;
  }

  bot.onText(/\/clear/, (msg) => {
    if (!auth(msg)) return;
    state.chatHistory = [];
    state.currentProject = null;
    bot.sendMessage(numericChatId, '已清空对话记录和上下文。');
  });

  bot.onText(/\/projects/, (msg) => {
    if (!auth(msg)) return;
    const projects = db.getProjects();
    if (!projects.length) {
      bot.sendMessage(numericChatId, '没有已注册的项目。用 POST /api/register 添加。');
      return;
    }
    state.projectList = projects;
    state.waitingForSelection = true;
    const lines = projects.map((p, i) => `${i + 1}. ${p.name} — ${p.path}`);
    bot.sendMessage(numericChatId, '选择项目:\n' + lines.join('\n'));
  });

  bot.onText(/\/status/, async (msg) => {
    if (!auth(msg)) return;
    const cpus = os.cpus().length;
    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);

    let disk = 'N/A';
    try {
      disk = execSync("df -h / | tail -1 | awk '{print $3\"/\"$2\" (\"$5\" used)\"}'", { encoding: 'utf8' }).trim();
    } catch {}

    let pm2 = 'N/A';
    try {
      const list = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
      pm2 = list.map((p) => `${p.name}: ${p.pm2_env?.status}`).join(', ') || '无服务';
    } catch {}

    let ccmStatus = '❌ 不可达';
    try {
      const r = await fetch(`${CCM_URL}/api/projects`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const projects = await r.json();
        ccmStatus = `✅ 运行中 (${projects.length} 项目)`;
      } else {
        ccmStatus = `⚠️ HTTP ${r.status}`;
      }
    } catch {}

    const proj = state.currentProject ? state.currentProject.name : '未选择';

    const text = [
      '📡 Jarvis (新加坡)',
      `  CPU: ${cpus} cores | 内存: ${freeMem}/${totalMem} GB`,
      `  磁盘: ${disk} | PM2: ${pm2}`,
      '',
      '🖥 CCM (国内)',
      `  ${ccmStatus}`,
      '',
      `当前项目: ${proj}`,
    ].join('\n');

    bot.sendMessage(numericChatId, text);
  });

  bot.onText(/\/inventory/, (msg) => {
    if (!auth(msg)) return;
    const assets = db.getAssets();
    if (!assets.length) {
      bot.sendMessage(numericChatId, '暂无资产记录。');
      return;
    }
    const grouped = {};
    for (const a of assets) {
      if (!grouped[a.type]) grouped[a.type] = [];
      grouped[a.type].push(a.path);
    }
    const lines = Object.entries(grouped).map(
      ([type, paths]) => `[${type}]\n` + paths.map((p) => `  ${p}`).join('\n')
    );
    const text = lines.join('\n\n');
    const chunks = chunkMessage(text, 4000);
    for (const chunk of chunks) {
      bot.sendMessage(numericChatId, chunk);
    }
  });

  bot.onText(/\/run (.+)/, async (msg, match) => {
    if (!auth(msg)) return;
    const prompt = match[1];
    const cwd = state.currentProject ? state.currentProject.path : '/root';
    try {
      bot.sendMessage(numericChatId, `🔧 执行中... (${state.currentProject?.name || 'default'})`);
      const output = await runClaude(prompt, cwd);
      const chunks = chunkMessage(output || '(empty)', 4000);
      for (const chunk of chunks) {
        await bot.sendMessage(numericChatId, chunk);
      }
    } catch (err) {
      bot.sendMessage(numericChatId, `错误: ${err.message}`);
    }
  });

  // General message handler
  bot.on('message', async (msg) => {
    if (!auth(msg)) return;
    if (msg.text && msg.text.startsWith('/')) return;

    const text = msg.text || '';

    if (state.waitingForSelection) {
      const num = parseInt(text, 10);
      if (num >= 1 && num <= state.projectList.length) {
        state.currentProject = state.projectList[num - 1];
        state.waitingForSelection = false;
        bot.sendMessage(numericChatId, `已选择: ${state.currentProject.name}\n${state.currentProject.path}`);
      } else {
        bot.sendMessage(numericChatId, `请输入 1-${state.projectList.length} 的数字`);
      }
      return;
    }

    try {
      bot.sendMessage(numericChatId, '🤖 思考中...');
      const sys = state.currentProject
        ? `${SYSTEM_PROMPT_BASE}\n当前项目: ${state.currentProject.name} (${state.currentProject.path})`
        : SYSTEM_PROMPT_BASE;

      // Pass conversation history for context
      const output = await chatAPI(text, sys, state.chatHistory);

      // Handle clear context
      if (output === '__CLEAR_CONTEXT__') {
        state.chatHistory = [];
        state.currentProject = null;
        bot.sendMessage(numericChatId, '好的，已清空对话记录和上下文。');
        return;
      }

      // Store in history (keep last 20 messages)
      state.chatHistory.push({ role: 'user', content: text });
      state.chatHistory.push({ role: 'assistant', content: output });
      if (state.chatHistory.length > 20) {
        state.chatHistory = state.chatHistory.slice(-20);
      }

      const chunks = chunkMessage(output || '(empty)', 4000);
      for (const chunk of chunks) {
        await bot.sendMessage(numericChatId, chunk);
      }
    } catch (err) {
      bot.sendMessage(numericChatId, `错误: ${err.message}`);
    }
  });

  return bot;
}

module.exports = { createBot };
