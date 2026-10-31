import assert from 'node:assert/strict';
import { normalizeUtcMillis } from '../utc-milliseconds.mjs';
for (const [input, expected] of [
  ['2024-02-29T00:00:00Z', '2024-02-29T00:00:00.000Z'],
  ['2024-02-29T00:00:00.1Z', '2024-02-29T00:00:00.100Z'],
  ['2024-02-29T00:00:00.12Z', '2024-02-29T00:00:00.120Z'],
  ['2024-02-29T00:00:00.123Z', '2024-02-29T00:00:00.123Z'],
]) assert.equal(normalizeUtcMillis(input), expected);
for (const bad of ['0000-01-01T00:00:00Z', '2025-02-29T00:00:00Z', '2024-01-01T24:00:00Z',
  '2024-01-01T00:00:60Z', '2024-01-01T00:00:00.1234Z', '2024-01-01T00:00:00+00:00'])
  assert.throws(() => normalizeUtcMillis(bad), /valid UTC/);
assert.ok(normalizeUtcMillis('2024-01-01T00:00:00Z') < normalizeUtcMillis('2024-01-01T00:00:00.001Z'));
console.log('UTC milliseconds: precision, canonical padding, ordering, calendar and invalid inputs passed');
