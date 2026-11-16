import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/check-icloud-source.mjs <source-audit.json>');
const report = JSON.parse(readFileSync(path));
const catalog = JSON.parse(readFileSync(new URL('../icloud_model/data/source_catalog.json', import.meta.url)));
const exceptions = JSON.parse(readFileSync(new URL('../icloud_model/data/source_exceptions.json', import.meta.url)));
const physical = { string: 'String', uuid: 'String', ip: 'String', enum: 'String', integer: 'Int', long: 'Int', float: 'Float', double: 'Float', boolean: 'Bool', datetime: 'String' };
assert.equal(new Set(report.datasets.map(d => d.id)).size, report.datasets.length);
const sourceByTable = new Map(catalog.datasets.map(d => [d.table, d]));
for (const source of catalog.datasets) {
  const datasets = report.datasets.filter(d => d.table === source.table);
  assert.ok(datasets.length, `missing source table ${source.table}`);
  for (const dataset of datasets) {
    const fields = new Map(dataset.fields.map(f => [f.column, f]));
    for (const field of source.fields) {
      const actual = fields.get(field.name);
      assert.ok(actual, `${dataset.id}: missing ${field.name}`);
      assert.equal(actual.scalar, physical[field.type.type], `${dataset.id}.${field.name}: storage type`);
    }
    for (const field of dataset.fields) assert.ok(source.fields.some(f => f.name === field.column) || exceptions.supplemental_fields?.[`${dataset.id}.${field.column}`], `${dataset.id}: unproved physical column ${field.column}`);
    for (const name of dataset.grain) assert.ok(dataset.fields.some(f => f.name === name && !f.nullable), `${dataset.id}: incomplete/nullable grain ${name}`);
  }
}
for (const dataset of report.datasets) assert.ok(sourceByTable.has(dataset.table), `unproved table ${dataset.table}`);
const byName = new Map(catalog.datasets.map(d => [d.name, d]));
function sourceKey(edge) {
  const branches = edge.condition.split(/\s+or\s+/i).map(branch => {
    const terms = branch.split(/\s+and\s+/i).map(term => {
      const match = /^\s*(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)\s*$/.exec(term);
      assert.ok(match, `unsupported source condition ${term}`);
      const [, side, left, , right] = match;
      return { Eq: { from_column: side === edge.target && edge.source !== edge.target ? right : left, to_column: side === edge.target && edge.source !== edge.target ? left : right } };
    });
    return terms.length === 1 ? terms[0] : { And: terms };
  });
  return branches.length === 1 ? branches[0] : { Or: branches };
}
function canonical(key) {
  if (key.Eq) return ['Eq', key.Eq.from_column, key.Eq.to_column];
  const kind = key.And ? 'And' : 'Or';
  return [kind, ...key[kind].map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))];
}
function reverse(key) {
  if (key.Eq) return {Eq:{from_column:key.Eq.to_column,to_column:key.Eq.from_column}};
  const kind=key.And?'And':'Or';return {[kind]:key[kind].map(reverse)};
}
let provedRelations = 0;
const unpublished = [];
for (const source of catalog.relations) {
  const from = byName.get(source.source).table, to = byName.get(source.target).table;
  const actual = report.relations.find(r => r.id === `source_${source.name}`) ?? report.relations.find(r => ((r.from_table === from && r.to_table === to && JSON.stringify(canonical(r.key)) === JSON.stringify(canonical(sourceKey(source)))) || (r.from_table === to && r.to_table === from && JSON.stringify(canonical(reverse(r.key))) === JSON.stringify(canonical(sourceKey(source))))));
  if (exceptions.excluded_relations[source.name]) {
    assert.equal(actual, undefined, `invalid source relation ${source.name}`);
    continue;
  }
  if (!actual) { unpublished.push(source.name); continue; }
  assert.ok((actual.from_table === from && actual.to_table === to) || (actual.from_table === to && actual.to_table === from), `${source.name}: relation tables`);
  const actualKey = actual.from_table === from ? actual.key : reverse(actual.key);
  assert.deepEqual(canonical(actualKey), canonical(sourceKey(source)), `${source.name}: join condition`);
  provedRelations++;
}
assert.equal(report.datasets.length, 50);
assert.deepEqual(unpublished, [], 'valid source relations must be published');
console.log(`Passed source evidence: ${catalog.datasets.length} tables, ${report.datasets.length} datasets, ${provedRelations} published source relation conditions; ${unpublished.length} source candidates not published`);
if (unpublished.length) console.log(JSON.stringify({unpublishedSourceRelations: unpublished}));
