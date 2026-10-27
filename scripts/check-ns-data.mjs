// Verify the generated database using SQL lowered by the actual NS runtime.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { withKnowledgeRunner } from '../ontology/tools/knowledge-runner.mjs';
import { validate } from './generate-ns-data.mjs';

const directory = resolve(process.argv[2] ?? 'bin/ns-data');
const artifact = process.argv[3];
if (!artifact) throw new Error('Usage: node scripts/check-ns-data.mjs <data-directory> <ns.wasm> [telora-run]');
const model = JSON.parse(readFileSync(join(directory, 'model.json')));
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json')));
const bytes = readFileSync(join(directory, 'ns.sqlite'));
const sha = data => createHash('sha256').update(data).digest('hex');
assert.equal(sha(bytes), manifest.databaseSha256, 'Database differs from its manifest');
assert.equal(sha(JSON.stringify(model)), manifest.modelSha256, 'Model contract differs from its manifest');
const db = new DatabaseSync(join(directory, 'ns.sqlite'), { readOnly: true });
const quote = v => `"${v.replaceAll('"', '""')}"`;
const dimension = d => d.fields.flatMap(f => f.dimensions).find(v => v.projectable).id;
const graph = (d, dim = dimension(d)) => ({ op: 'Graph', root: 'r', nodes: [{ id: 'r', entity: d.id }], edges: [], select: [{ node: 'r', dimension: dim }], limit: 3 });
const datasets = new Map(model.datasets.map(d => [d.id, d]));
const report = { datasets: 0, relations: 0, domains: 0, metricAggregates: 0, invalidInputs: 0, cardinalityExceptions: manifest.checks.cardinalityExceptions.length };
try {
  validate(db, model, manifest);
  await withKnowledgeRunner(artifact, async (_, request) => {
    const queries = async intents => {
      const result = await request('ns/transform', { intents });
      assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
      assert.equal(result.queries.length, intents.length);
      return result.queries;
    };
    const run = query => db.prepare(query.sql).all(...query.bindings);
    const batched = async (intents, check) => {
      for (let i = 0; i < intents.length; i += 5) {
        const result = await queries(intents.slice(i, i + 5));
        result.forEach((query, j) => check(query, i + j));
      }
    };
    await batched(model.datasets.map(d => graph(d)), query => { assert(run(query).length > 0); report.datasets++; });
    const relationIntents = model.relations.map(r => ({ op: 'Graph', root: 'a', ...(r.cardinality.to.startsWith('Many') ? { row_grain: 'Association', distinct: true } : {}),
      nodes: [{ id: 'a', entity: r.from }, { id: 'b', entity: r.to }], edges: [{ relation: r.id, from: 'a', to: 'b' }],
      select: [{ node: 'a', dimension: dimension(datasets.get(r.from)) }, { node: 'b', dimension: dimension(datasets.get(r.to)) }], limit: 3 }));
    await batched(relationIntents, (query, i) => { assert(run(query).length > 0, model.relations[i].id); report.relations++; });
    const domainCases = model.datasets.flatMap(d => d.fields.filter(f => f.domain && f.dimensions.some(dim => dim.filterable)).map(f => ({ d, f })));
    await batched(domainCases.map(({ d, f }) => ({ ...graph(d), filters: [{ node: 'r', dimension: f.dimensions.find(dim => dim.filterable).id, op: 'Eq', value: model.domains[f.domain].members[0].id }] })),
      (query, i) => { assert(run(query).length > 0, `${domainCases[i].d.id}.${domainCases[i].f.name}`); report.domains++; });
    for (const d of model.datasets.filter(d => d.kind === 'Metric')) {
      const f = d.fields.find(f => f.measures.some(m => m.statistic === 'Mean')) ?? d.fields.find(f => f.measures.length);
      const measure = f.measures.find(m => m.statistic === 'Mean') ?? f.measures[0];
      const object = d.fields.find(f => d.grain.includes(f.name) && f.name !== d.clock);
      const clock = d.fields.find(f => f.name === d.clock);
      const intent = { ...graph(d, object.dimensions.find(dim => dim.projectable).id), limit: 10000,
        filters: [{ node: 'r', dimension: clock.dimensions[0].id, op: 'Ge', value: manifest.window.start }, { node: 'r', dimension: clock.dimensions[0].id, op: 'Lt', value: manifest.window.endExclusive }],
        measures: [{ node: 'r', measure: measure.id }] };
      const [query] = await queries([intent]);
      const rows = run(query);
      assert.equal(rows.length, manifest.generation.resources, d.id);
      const aggregate = { Mean: 'avg', Max: 'max', Min: 'min' }[measure.statistic];
      assert(aggregate);
      const expected = new Map(db.prepare(`SELECT ${quote(object.column)} id, ${aggregate}(${quote(f.column)}) value FROM ${quote(d.table)} GROUP BY ${quote(object.column)}`).all().map(r => [r.id, r.value]));
      const [idColumn, valueColumn] = query.columns;
      for (const row of rows) assert(Math.abs(row[valueColumn.name] - expected.get(row[idColumn.name])) < 1e-6, `${d.id}: aggregate matches SQLite`);
      report.metricAggregates++;
    }
    const { d, f } = domainCases[0];
    const bad = await request('ns/transform', { intents: [{ ...graph(d), filters: [{ node: 'r', dimension: f.dimensions[0].id, op: 'Eq', value: '__invalid_value__' }] }] });
    assert.equal(bad.accepted, false); report.invalidInputs++;
    assert.equal((await queries([graph(d)])).length, 1);
  }, { runner: process.argv[4], artifactLimits: true });
  console.log(JSON.stringify(report));
} finally { db.close(); }
