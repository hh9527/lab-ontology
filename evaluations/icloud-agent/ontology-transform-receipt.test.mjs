import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformResult } from './ontology-transform-receipt.mjs';

test('success stores the complete Query without exposing it to the Agent', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'ontology-receipt-'));
  try {
    const intent = { op: 'graph', root: 's' };
    const ctx = { now: 1790553600000, tz: 480 };
    const result = transformResult({ error: false, ok: { sql: 'SELECT ?1', bindings: [7] } },
      intent, ctx, outputDir);
    const receipt = JSON.parse(result.content[0].text);
    assert.equal(result.isError, false);
    assert.equal(receipt.accepted, true);
    assert.match(receipt.receipt, /^[0-9a-f-]{36}$/);
    assert.doesNotMatch(JSON.stringify(result), /SELECT|bindings/);
    assert.deepEqual(readdirSync(outputDir), [`${receipt.receipt}.json`]);
    const path = join(outputDir, `${receipt.receipt}.json`);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(path)), {
      intent, ctx, query: { sql: 'SELECT ?1', bindings: [7] },
    });
  } finally {
    rmSync(outputDir, { recursive: true });
  }
});

test('failure returns diagnostics and stores nothing', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'ontology-receipt-'));
  try {
    const diagnostic = { schema: 'telora.service/v1', error: true,
      ok: { sql: 'SHOULD NOT LEAK', bindings: [] },
      diagnostics: [{ message: 'unknown entity' }] };
    const result = transformResult(diagnostic, { root: 'bad' }, undefined, outputDir);
    assert.equal(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), {
      schema: diagnostic.schema, error: true, diagnostics: diagnostic.diagnostics,
    });
    assert.deepEqual(readdirSync(outputDir), []);
    assert.throws(() => transformResult({ error: false, ok: { sql: 'SELECT 1' } },
      {}, undefined, outputDir), /invalid transform response/);
    assert.deepEqual(readdirSync(outputDir), []);
  } finally {
    rmSync(outputDir, { recursive: true });
  }
});
