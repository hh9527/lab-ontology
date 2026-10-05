import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { collectKnowledge } from '../ontology/tools/knowledge-export.mjs';
import { withKnowledgeRunner } from '../ontology/tools/knowledge-runner.mjs';

const { values } = parseArgs({ options: {
  artifact: { type: 'string', default: 'bin/icloud_model.snapshot.wasm' },
  domain: { type: 'string', default: 'ic' },
  output: { type: 'string' }, full: { type: 'boolean', default: false },
} });
const started = performance.now();
function runnerMemory() {
  const children = `/proc/${process.pid}/task/${process.pid}/children`;
  if (!existsSync(children)) return null;
  const pid = readFileSync(children, 'utf8').trim().split(/\s+/)[0];
  if (!pid) return null;
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  return { rss_kib: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1]),
    peak_rss_kib: Number(/^VmHWM:\s+(\d+)/m.exec(status)?.[1]) };
}
const report = await withKnowledgeRunner(resolve(values.artifact), async (info, request) => {
  const discovery = await request(`${values.domain}/discovery`, {});
  const firstResponseMs = performance.now() - started;
  const samples = [];
  for (const key of ['index', 'Ty/DatetimeUtc', 'Dataset/tenant', 'Dataset/onu_kpi',
    'Dimension/onu_kpi/onu_kpi__cpuUsage', 'Dimension/current_alarm/alarm_tenant_id']) {
    assert((await info(values.domain, { key })).Document?.Found, `Missing benchmark key: ${key}`);
    const durations = [];
    for (let i = 0; i < 10; i++) {
      const before = performance.now();
      await info(values.domain, { key });
      durations.push(performance.now() - before);
    }
    durations.sort((a, b) => a - b);
    samples.push({ key, median_ms: durations[5], min_ms: durations[0] });
  }
  const result = { revision: discovery.revision, artifact_bytes: statSync(values.artifact).size,
    first_response_ms: firstResponseMs, samples };
  if (values.full) {
    const before = performance.now();
    const nodes = await collectKnowledge(input => info(values.domain, input), discovery.roots);
    result.full_ms = performance.now() - before;
    result.nodes = nodes.length;
    result.responses = Object.fromEntries(nodes.sort((a, b) => a.key.localeCompare(b.key, 'en')).map(node => {
      const json = JSON.stringify(node);
      return [node.key, { sha256: createHash('sha256').update(json).digest('hex'),
        bytes: Buffer.byteLength(json) }];
    }));
  }
  result.runner_memory = runnerMemory();
  return result;
}, { memory: '2048' });
if (values.output) writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
const { responses, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
