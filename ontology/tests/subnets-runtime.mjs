import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Execute generated queries, not hand-written equivalents, against boundary data.
// Input is the JSON export from: telora -C ontology eval @test/subnets:runtime_cases
const cases = JSON.parse(readFileSync(process.argv[2] ?? 0, 'utf8'));
const number = (address) => address.split('.').reduce((n, octet) => n * 256 + Number(octet), 0);
const address = (n) => [24, 16, 8, 0].map((bits) => Math.floor(n / 2 ** bits) % 256).join('.');
const samples = new Set(['10.4.2.3', '10.40.0.1', '10.4.15.255', '10.4.16.0',
  '10.4.31.255', '10.4.32.0', '10.4.2.127', '10.4.2.128', '10.4.2.255',
  '127.255.255.255', '128.0.0.0', '255.255.255.255']);
for (const { network } of cases) {
  const [base, mask] = network.split('/');
  const lower = number(base);
  const width = 2 ** (32 - Number(mask));
  for (const n of [lower - 1, lower, lower + 1, lower + width - 1, lower + width]) {
    if (n >= 0 && n < 2 ** 32) samples.add(address(n));
  }
}
const db = new DatabaseSync(':memory:');
db.function('regexp', { deterministic: true }, (pattern, value) => {
  if (pattern === null || value === null) return null;
  return new RegExp(pattern).test(value) ? 1 : 0;
});
db.exec('CREATE TABLE hosts (ip TEXT, raw TEXT); CREATE INDEX hosts_ip ON hosts(ip COLLATE BINARY)');
const insert = db.prepare('INSERT INTO hosts VALUES (?, ?)');
for (const ip of samples) insert.run(ip, ip);
insert.run(null, 'missing');
for (const { network, queries } of cases) {
  const [base, mask] = network.split('/');
  const lower = number(base);
  const upper = lower + 2 ** (32 - Number(mask));
  for (const [index, query] of queries.entries()) {
    const expected = [...samples].filter((ip) => {
      const inside = number(ip) >= lower && number(ip) < upper;
      return index === 0 ? inside : !inside;
    }).sort();
    const actual = db.prepare(query.sql).all(...query.bindings).map((row) => row.h_ip).sort();
    assert.deepEqual(actual, expected, `${network} ${index === 0 ? 'InSubnet' : 'NotInSubnet'}`);
  }
}
for (const network of ['10.4.0.0/16', '10.4.16.0/20']) {
  const query = cases.find((item) => item.network === network).queries[0];
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.bindings);
  assert.ok(plan.some((step) => step.detail.includes('SEARCH')
    && step.detail.includes('ip>? AND ip<?')), JSON.stringify(plan));
}
db.close();
console.log(`Passed ${cases.length * 2} generated SQLite queries, NULL/complement boundaries and 2 index range plans.`);
