import { spawn } from 'child_process';

export function chunkMessage(text, maxLen = 4000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks.length ? chunks : [''];
}

export function runClaude(prompt, cwd, onChunk) {
  return new Promise((resolve, reject) => {
    const args = ['--print', prompt];
    const proc = spawn('claude', args, {
      cwd,
      env: { ...process.env },
      shell: true,
    });

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
