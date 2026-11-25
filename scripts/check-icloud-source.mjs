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
for (const [id, evidence] of Object.entries(exceptions.sampling_grains ?? {})) {
  const dataset = report.datasets.find(dataset => dataset.id === id);
  assert(dataset, `missing sampled dataset ${id}`);
  assert.deepEqual(dataset.grain, evidence.fields, `${id}: sample grain must include its collection time`);
}
for (const dataset of report.datasets) {
  const source = sourceByTable.get(dataset.table);
  const timestamps = source.fields.filter(field => field.name === 'ts' && field.columnType === 'timestamp').map(field => field.name);
  if (!timestamps.length || !dataset.grain.length) continue;
  assert(dataset.grain.some(name => timestamps.includes(dataset.fields.find(field => field.name === name).column)),
    `${dataset.id}: sampled rows cannot be identified by the resource alone`);
}
for (const [dataset, column, symbol, quantity, scale] of [
  ['source_NetworkCellLinkQualityKPI', 'jitter', 'ms', 'time', 0.001],
  ['source_NetworkCellLinkQualityKPI', 'packetLoss', '%', 'ratio', 0.01],
  ['source_NetworkCellLinkTrafficKPI', 'upwardTraffic', 'byte', 'data_size', 1],
  ['source_PonDeviceEthernetPortKPI', 'hwOpticsRxPower', 'dBm', 'power_level', 1],
  ['server_memory', 'capacity', 'MB', 'data_size', 1000000],
  ['server_psu', 'ratedPower', 'W', 'power', 1],
  ['source_SYS_Controller', 'temperature', '°C', 'thermodynamic_temperature', 1],
]) {
  const field = report.datasets.find(d => d.id === dataset).fields.find(f => f.column === column);
  assert.deepEqual(field.unit, {symbol, quantity, scale}, `${dataset}.${column}: nominal unit`);
}
for (const [dataset, column] of [
  ['interface_kpi', 'ifHCInOctetsSpeed'], ['interface_kpi', 'ifHCOutOctetsSpeed'],
  ['pon_port_kpi', 'ifInBandRate'], ['pon_port_kpi', 'ifOutBandRate'],
  ['source_PhysicalServerDisk', 'capacity'], ['source_StorageHardDriveKPI', 'avgreadiosize'],
]) {
  const field = report.datasets.find(d => d.id === dataset).fields.find(f => f.column === column);
  assert.equal(field.unit, null, `${dataset}.${column}: source type must not imply an unestablished conversion`);
}
// Closed enum fields must still cover the source catalog's declared codes.
let closedEnumFields = 0;
for (const dataset of report.datasets) {
  if (dataset.scope.length) continue; // Role scopes intentionally restrict the source population.
  const source=sourceByTable.get(dataset.table);
  for (const field of source.fields) {
    const raw=field.properties?.['dte.enum.values'] ?? field['dte.enum.values'];
    if (!raw) continue;
    const dimensions=report.dimensions.filter(d=>d.dataset===dataset.id && d.column===field.name && !d.computed && d.values.length);
    if (!dimensions.length) continue;
    let expected;
    try { expected=JSON.parse(raw); }
    catch { expected=exceptions.enum_recoveries?.[`${source.name}.${field.name}`]?.values; }
    assert(Array.isArray(expected),`${dataset.id}.${field.name}: missing source enum evidence`);
    const wires=new Set(dimensions.flatMap(d=>d.values.flatMap(v=>v.wires.map(w=>String(Object.values(w)[0])))));
    for (const value of expected) assert(wires.has(String(value.value)),`${dataset.id}.${field.name}: lost closed source code ${value.value}`);
    closedEnumFields++;
  }
}
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
  const actual = report.relations.find(r => r.id === `source_${source.name}` || r.source_names?.includes(`source_${source.name}`)) ?? report.relations.find(r => ((r.from_table === from && r.to_table === to && JSON.stringify(canonical(r.key)) === JSON.stringify(canonical(sourceKey(source)))) || (r.from_table === to && r.to_table === from && JSON.stringify(canonical(reverse(r.key))) === JSON.stringify(canonical(sourceKey(source))))));
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
console.log(`Passed source evidence: ${catalog.datasets.length} tables, ${report.datasets.length} datasets, ${provedRelations} published source relation conditions; ${unpublished.length} source candidates not published; ${closedEnumFields} closed enum source fields checked`);
if (unpublished.length) console.log(JSON.stringify({unpublishedSourceRelations: unpublished}));
