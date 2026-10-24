// 每轮启动新 runner，直接发送 transform；不预热、不先执行 self_check。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  baseline: { type: 'string' }, staged: { type: 'string' },
  dimensions: { type: 'string', default: '80' }, runs: { type: 'string', default: '3' },
} });
assert(values.baseline && values.staged, '--baseline and --staged are required');
const dimensions = Number(values.dimensions), runs = Number(values.runs);
assert(Number.isSafeInteger(dimensions) && dimensions > 0 && Number.isSafeInteger(runs) && runs > 0);
const runner = fileURLToPath(new URL('../bin/telora-run', import.meta.url));
const median = numbers => {
  const sorted = [...numbers].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
for (const projection of ['identity', 'all']) {
  const select = [{ node: 'r', dimension: 'dataset_1_id' }];
  if (projection === 'all') for (let i = 1; i < dimensions; i++) {
    select.push({ node: 'r', dimension: `dataset_1_name_${i}` });
  }
  const input = JSON.stringify({ method: 'scale/transform', input: { intents: [{
    op: 'Graph', root: 'r', nodes: [{ id: 'r', entity: 'dataset_1' }], edges: [], select,
  }] } });
  const observations = { baseline: [], staged: [] };
  let expected;
  for (let run = 0; run < runs; run++) {
    // 交替先后顺序，减少机器负载变化造成的偏差。
    for (const mode of run % 2 ? ['staged', 'baseline'] : ['baseline', 'staged']) {
      const result = spawnSync(runner, [values[mode], '--serve', 'stdio+jsonl://', '--report-timings'], {
        input: `${input}\n${input}\n${input}\n`, encoding: 'utf8', timeout: 120000,
        maxBuffer: 32 * 1024 * 1024,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      const responses = result.stdout.trim().split('\n').map(JSON.parse);
      assert.equal(responses.length, 3);
      for (const response of responses) {
        assert.equal(response.error, false, JSON.stringify(response));
        assert.equal(response.ok.accepted, true, JSON.stringify(response));
        expected ??= response.ok;
        assert.deepEqual(response.ok, expected);
      }
      const timings = result.stderr.trim().split('\n').filter(Boolean).map(JSON.parse)
        .filter(d => d.code === 'execution-timings').map(d => d.timings);
      assert.equal(timings.length, 3, result.stderr);
      observations[mode].push(timings);
    }
  }
  const summaries = Object.fromEntries(Object.entries(observations).map(([mode, rounds]) => [mode, {
    firstRequestMs: median(rounds.map(t => t[0].request_ms)),
    laterRequestMs: median(rounds.flatMap(t => t.slice(1).map(x => x.request_ms))),
    firstResetMs: median(rounds.map(t => t[0].reset_ms)),
    firstLoadInitializeMs: median(rounds.map(t => t[0].metadata_ms + t[0].module_ms + t[0].instance_ms + t[0].initialize_ms)),
  }]));
  console.log(JSON.stringify({ projection, dimensions, runs, summaries, observations }));
}
