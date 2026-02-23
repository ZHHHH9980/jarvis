const { chunkMessage } = require('./claude-runner.js');

let botInstance = null;
let chatId = null;

function init(bot, targetChatId) {
  botInstance = bot;
  chatId = targetChatId;
}

async function notify(message) {
  if (!botInstance || !chatId) return;
  const chunks = chunkMessage(message, 4000);
  for (const chunk of chunks) {
    await botInstance.sendMessage(chatId, chunk);
  }
}

module.exports = { init, notify };
