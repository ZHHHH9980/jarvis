const os = require('os');
const { execSync } = require('child_process');
const TelegramBot = require('node-telegram-bot-api');
const { runClaude, chatAPI, chunkMessage } = require('./claude-runner.js');
const { init: initNotifier } = require('./notifier.js');

const CCM_URL = process.env.CCM_URL || 'http://43.138.129.193:3000';

const SYSTEM_PROMPT_BASE = `你是 Jarvis，一个轻量级智能助手和服务器管理调度中心。
你的能力：聊天、回答问题、提供建议。
你不能：执行命令、读写文件、检查服务状态。
如果用户需要执行操作，告诉他们用 /run <指令>。
如果用户需要查看服务状态，告诉他们用 /status。
简洁回复，不要承诺你做不到的事。`;

function createBot(token, chatId, db) {
  const numericChatId = Number(chatId);
  const bot = new TelegramBot(token, { polling: true });
  initNotifier(bot, numericChatId);

  const state = {
    currentProject: null,
    waitingForSelection: false,
    projectList: [],
  };

  function auth(msg) {
    return msg.chat.id === numericChatId;
  }

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
      const output = await chatAPI(text, sys);
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
