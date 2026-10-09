import assert from 'node:assert/strict';
import test from 'node:test';
import { OUTPUT_ROW_LIMIT, withOutputLimit } from './ontology-output-limit.mjs';

test('forwarding overrides every top-level cap without modifying operands or input', () => {
  const operand = { op: 'Graph', take: 3 };
  const input = { intents: [
    { op: 'Graph', limit: 1001, take: 5 },
    { op: 'GraphPair', limit: null, left: operand, right: operand },
    { op: 'GraphUnion', branches: [{ graph: operand }, { graph: operand }] },
  ] };
  const output = withOutputLimit(input);
  assert.deepEqual(output.intents.map(intent => intent.limit), [100, 100, 100]);
  assert.equal(OUTPUT_ROW_LIMIT, 100);
  assert.equal(output.intents[0].take, 5);
  assert.equal(output.intents[1].left, operand);
  assert.equal(output.intents[2].branches, input.intents[2].branches);
  assert.equal(input.intents[0].limit, 1001);
  assert.equal(input.intents[1].limit, null);
  assert.equal('limit' in input.intents[2], false);
  assert.equal('limit' in operand, false);
});
