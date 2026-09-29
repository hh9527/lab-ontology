import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformResults } from './ontology-transform-receipt.mjs';

test('success stores all Intents and Queries in one private receipt', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'ontology-receipt-'));
  try {
    const intents = [{ op: 'graph', root: 'a' }, { op: 'graph', root: 'z' }];
    const queries = [
      { sql: 'SELECT ?1', bindings: [7] },
      { sql: 'SELECT ?1', bindings: [9] },
    ];
    const response = { error: false, ok: { accepted: true, queries, results: [
      { index: 0, valid: true, diagnostics: [] },
      { index: 1, valid: true, diagnostics: [] },
    ] } };
    const result = transformResults(response, intents, outputDir);
    const receipt = JSON.parse(result.content[0].text);
    assert.equal(result.isError, false);
    assert.equal(receipt.accepted, true);
    assert.equal(receipt.count, 2);
    assert.match(receipt.receipt, /^[0-9a-f-]{36}$/);
    assert.doesNotMatch(JSON.stringify(result), /SELECT|bindings/);
    assert.deepEqual(readdirSync(outputDir), [`${receipt.receipt}.json`]);
    const path = join(outputDir, `${receipt.receipt}.json`);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(path)), {
      items: [
        { intent: intents[0], query: queries[0] },
        { intent: intents[1], query: queries[1] },
      ],
    });
  } finally {
    rmSync(outputDir, { recursive: true });
  }
});

test('one failed Intent returns indexed feedback and stores no partial bundle', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'ontology-receipt-'));
  try {
    const statuses = [
      { index: 0, valid: true, diagnostics: [] },
      { index: 1, valid: false, diagnostics: [{ message: 'unknown entity' }] },
      { index: 2, valid: false, diagnostics: [{ message: 'unknown relation' }] },
    ];
    const result = transformResults(
      { error: false, ok: { accepted: false, queries: null, results: statuses } },
      [{ root: 'valid' }, { root: 'bad' }, { root: 'also bad' }], outputDir);
    assert.equal(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), {
      accepted: false,
      results: statuses,
    });
    assert.deepEqual(readdirSync(outputDir), []);
    assert.throws(() => transformResults({ error: false, ok: {
      accepted: false, queries: [{ sql: 'SHOULD NOT LEAK', bindings: [] }],
      results: [{ index: 0, valid: false, diagnostics: [] }],
    } }, [{}], outputDir), /invalid transform response/);
    assert.deepEqual(readdirSync(outputDir), []);
  } finally {
    rmSync(outputDir, { recursive: true });
  }
});
