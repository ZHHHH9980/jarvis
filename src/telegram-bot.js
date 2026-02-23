const os = require('os');
const { execSync } = require('child_process');
const TelegramBot = require('node-telegram-bot-api');
const { runClaude, chunkMessage } = require('./claude-runner.js');
const { init: initNotifier } = require('./notifier.js');

function createBot(token, chatId, db) {
  const numericChatId = Number(chatId);
  const bot = new TelegramBot(token, { polling: true });
  initNotifier(bot, numericChatId);

  // Per-chat state
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

  bot.onText(/\/status/, (msg) => {
    if (!auth(msg)) return;
    const cpus = os.cpus().length;
    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);

    let disk = 'N/A';
    try {
      disk = execSync("df -h / | tail -1 | awk '{print $3\"/\"$2\" (\"$5\" used)\"}'", {
        encoding: 'utf8',
      }).trim();
    } catch {}

    let pm2 = 'N/A';
    try {
      const list = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
      pm2 = list.map((p) => `${p.name}: ${p.pm2_env?.status}`).join(', ') || '无服务';
    } catch {}

    const proj = state.currentProject ? `${state.currentProject.name}` : '未选择';

    const text = [
      `CPU: ${cpus} cores`,
      `内存: ${freeMem}/${totalMem} GB free`,
      `磁盘: ${disk}`,
      `PM2: ${pm2}`,
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

  bot.onText(/\/backup/, (msg) => {
    if (!auth(msg)) return;
    bot.sendMessage(numericChatId, 'V2 功能，当前请手动操作');
  });

  bot.onText(/\/migrate/, (msg) => {
    if (!auth(msg)) return;
    bot.sendMessage(numericChatId, 'V2 功能，当前请手动操作');
  });

  // General message handler
  bot.on('message', async (msg) => {
    if (!auth(msg)) return;
    if (msg.text && msg.text.startsWith('/')) return; // skip commands

    const text = msg.text || '';

    // Project selection
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

    // Send to Claude
    try {
      bot.sendMessage(numericChatId, '🤖 思考中...');
      const cwd = state.currentProject ? state.currentProject.path : '/root';
      const output = await runClaude(text, cwd);
      const chunks = chunkMessage(output || '(empty response)', 4000);
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
