import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export async function withKnowledgeRunner(artifact, use, { requestFuel = '100000', memory = '1024' } = {}) {
  const child = spawn(fileURLToPath(new URL('../../bin/telora-run', import.meta.url)),
    [artifact, '--serve', 'stdio+jsonl://', '--request-fuel', requestFuel, '--with-memory-limit', memory]);
  const closed = new Promise(resolve => child.once('close', resolve));
  child.stderr.pipe(process.stderr);
  const reader = createInterface({ input: child.stdout });
  const lines = reader[Symbol.asyncIterator]();
  let failure;
  child.on('error', error => { failure = error; reader.close(); });
  child.stdin.on('error', error => { failure = error; reader.close(); });
  let active = false;
  const info = async (domain, input) => {
    assert.equal(active, false, 'knowledge runner calls must be sequential');
    if (failure) throw failure;
    active = true;
    const timeout = setTimeout(() => child.kill(), 60000);
    try {
      child.stdin.write(JSON.stringify({ method: `${domain}/info`, input }) + '\n');
      const line = await lines.next();
      if (failure) throw failure;
      assert.equal(line.done, false, 'knowledge runner exited before answering');
      const response = JSON.parse(line.value);
      assert.equal(response.error, false, JSON.stringify(response.diagnostics));
      return response.ok;
    } finally {
      clearTimeout(timeout);
      active = false;
    }
  };
  try { return await use(info); }
  finally {
    child.stdin.end();
    child.kill();
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    await closed;
    clearTimeout(timeout);
    reader.close();
  }
}
