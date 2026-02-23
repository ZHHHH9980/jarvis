const { spawn } = require('child_process');

const SSH_HOST = process.env.SSH_HOST || '';
const SSH_USER = process.env.SSH_USER || 'root';

function chunkMessage(text, maxLen = 4000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks.length ? chunks : [''];
}

function runClaude(prompt, cwd, onChunk) {
  return new Promise((resolve, reject) => {
    let proc;

    if (SSH_HOST) {
      // Remote execution via SSH
      const escaped = prompt.replace(/'/g, "'\\''");
      const cmd = `source ~/.bashrc 2>/dev/null; cd '${cwd}' && claude --print '${escaped}'`;
      proc = spawn('ssh', [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=10',
        `${SSH_USER}@${SSH_HOST}`,
        cmd,
      ]);
    } else {
      // Local execution
      proc = spawn('claude', ['--print', prompt], {
        cwd,
        env: { ...process.env },
        shell: true,
      });
    }

    let output = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      if (onChunk) onChunk(text);
    });

    proc.stderr.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`claude exited with code ${code}: ${output}`));
    });

    proc.on('error', (err) => reject(err));
  });
}

module.exports = { runClaude, chunkMessage };
