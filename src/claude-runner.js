const { spawn } = require('child_process');

const SSH_HOST = process.env.SSH_HOST || '';
const SSH_USER = process.env.SSH_USER || 'root';

// Strip ANSI escape codes from TTY output
function stripAnsi(str) {
  return str.replace(/\x1B\[[^@-~]*[@-~]|\x1B\][^\x07]*\x07|\x1B[^[\]].|\r/g, '');
}

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
      // Remote execution via SSH (-tt forces TTY, required by claude CLI)
      const escaped = prompt.replace(/'/g, "'\\''");
      const tools = 'Bash,Read,Write,Edit,Glob,Grep';
      const cmd = `source ~/.bashrc 2>/dev/null; cd '${cwd}' && claude --print --allowedTools '${tools}' '${escaped}'`;
      proc = spawn('ssh', [
        '-tt',
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
      const clean = SSH_HOST ? stripAnsi(output).trim() : output;
      if (code === 0) resolve(clean);
      else reject(new Error(`claude exited with code ${code}: ${clean}`));
    });

    proc.on('error', (err) => reject(err));
  });
}

module.exports = { runClaude, chunkMessage };
