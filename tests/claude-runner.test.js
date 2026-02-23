const { chunkMessage } = require('../src/claude-runner.js');

describe('claude-runner', () => {
  it('chunks long messages at 4000 chars', () => {
    const long = 'a'.repeat(10000);
    const chunks = chunkMessage(long, 4000);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(4000);
    expect(chunks[2]).toHaveLength(2000);
  });

  it('returns single chunk for short messages', () => {
    const chunks = chunkMessage('hello', 4000);
    expect(chunks).toHaveLength(1);
  });
});
