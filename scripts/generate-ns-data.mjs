import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const modelRoot = fileURLToPath(new URL('../ns_model/', import.meta.url));
const quote = value => `"${value.replaceAll('"', '""')}"`;
const hash = data => createHash('sha256').update(data).digest('hex');
const iso = ms => new Date(ms).toISOString().replace('.000Z', 'Z');
const key = (dataset, field) => `${dataset}/${field}`;
const sqlTypes = { String: 'TEXT', Int: 'INTEGER', Float: 'REAL', Bool: 'INTEGER' };

export function loadModel() {
  const model = JSON.parse(readFileSync(join(modelRoot, 'data/generation-contract.json')));
  if (model.version !== 1) throw new Error('Unsupported NS generation contract');
  if (model.sourceSha256 !== hash(readFileSync(join(modelRoot, 'data/source-model.json')))) {
    throw new Error('Stale NS contract: run python3 ns_model/tools/generate_model.py');
  }
  for (const [path, expected] of Object.entries(model.generatedHashes)) {
    if (hash(readFileSync(join(modelRoot, path))) !== expected) throw new Error(`Stale NS contract: ${path}`);
  }
  return model;
}

// Fixture-specific identity ownership, not an inference rule for the ontology.
// References select a single owner per row; owners keep distinct namespaces.
function ownership(dataset, field) {
  let score = dataset.internal ? 0 : 200;
  if (dataset.kind === 'Metric' || dataset.kind === 'Event') score -= 80;
  if (dataset.grain.includes(field.name)) score += 100;
  if (['obj_sys_id', 'ori_res_id', 'native_id', 'obj_id', 'file_system_id', 'name', 'wwn', 'sn'].includes(field.name)) score += 60;
  if (/^(ref_|a_|z_)/.test(field.name) || ['parent_res_id', 'ne_res_id', 'access_device_id', 'me_dn', 'frame_native_id', 'if_name', 'fs_id'].includes(field.name)) score -= 350;
  if (field.name === 'pool_id' && dataset.id === 'storage-pool') score += 100;
  return score;
}

export function prepare(model) {
  const datasets = new Map(model.datasets.map(d => [d.id, d]));
  const fields = new Map(model.datasets.flatMap(d => d.fields.map((f, i) => [key(d.id, f.name), { ...f, dataset: d, ordinal: i }])));
  if (datasets.size !== model.datasets.length || new Set(model.datasets.map(d => d.table)).size !== datasets.size) throw new Error('Duplicate NS dataset/table');
  const rank = k => ownership(fields.get(k).dataset, fields.get(k));
  const candidates = new Map();
  for (const relation of model.relations) {
    for (const pair of relation.pairs) {
      let a = key(relation.from, pair.from), b = key(relation.to, pair.to);
      if (!fields.has(a) || !fields.has(b) || fields.get(a).storage !== fields.get(b).storage) throw new Error(`Invalid relation ${relation.id}`);
      if (rank(a) > rank(b) || (rank(a) === rank(b) && a > b)) [a, b] = [b, a];
      if (a !== b) {
        if (!candidates.has(a)) candidates.set(a, new Set());
        candidates.get(a).add(b);
      }
    }
  }
  const references = new Map([...candidates].map(([k, values]) => {
    const maximum = Math.max(...[...values].map(rank));
    // Keep alternative resource owners, including alias identities, but avoid
    // routing a reference through another reference when its owner is known.
    return [k, [...values].filter(v => rank(v) >= 60 || rank(v) === maximum).sort()];
  }));
  const donors = new Set([...references.values()].flat());
  const identityFields = new Set([...references.keys(), ...donors]);
  const guards = new Map();
  for (const r of model.relations.filter(r => r.guard)) {
    if (!r.guard.op.symbol.endsWith('::Eq')) throw new Error(`Unsupported fixture guard ${r.id}`);
    const k = key(r.from, r.guard.field);
    if (!guards.has(k)) guards.set(k, []);
    if (!guards.get(k).includes(r.guard.input.args[0])) guards.get(k).push(r.guard.input.args[0]);
  }
  return { datasets, fields, references, identityFields, guards };
}

function optionsOf(options, model, plan) {
  const opts = { seed: 20261027, resources: 12, days: 7, intervalMinutes: 60,
    anchor: iso(Math.floor(Date.now() / 60000) * 60000), ...options };
  for (const k of ['seed', 'resources', 'days', 'intervalMinutes']) if (!Number.isSafeInteger(opts[k]) || opts[k] <= 0) throw new Error(`${k} must be a positive safe integer`);
  if (opts.seed > 0xffffffff) throw new Error('seed must fit uint32');
  const minimum = Math.max(12, ...[...plan.references.values()].map(v => v.length));
  if (opts.resources < minimum || opts.resources > 10000) throw new Error(`resources must be between ${minimum} and 10000`);
  const anchorMs = Date.parse(opts.anchor);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(opts.anchor) || !Number.isFinite(anchorMs) || iso(anchorMs) !== opts.anchor) throw new Error('anchor must be a valid UTC timestamp: YYYY-MM-DDTHH:MM:SSZ');
  const samples = Math.ceil(opts.days * 1440 / opts.intervalMinutes);
  const startMs = anchorMs - opts.days * 86400000;
  if (!Number.isSafeInteger(startMs) || !Number.isFinite(new Date(startMs).getTime())) throw new Error('Invalid time window');
  const rows = samples * opts.resources * model.datasets.filter(d => d.kind === 'Metric').length;
  if (!Number.isSafeInteger(rows) || rows > 1000000) throw new Error('Requested data exceeds one million KPI rows');
  if (!opts.output) throw new Error('output is required');
  return { ...opts, output: resolve(opts.output), anchorMs, samples, startMs, interval: opts.intervalMinutes * 60000 };
}

export function metricValue(field, resource, sample, samples, time, noise) {
  if (/effcnt|sample_count/i.test(field.name)) return 1;
  const daily = Math.sin(time / 86400000 * 2 * Math.PI);
  const trend = [18, -18, 0][resource % 3] * sample / Math.max(1, samples - 1);
  const percentage = /%|percent/i.test(field.unit ?? '') || /cpu|usage|util|busy|ratio|rate_percent/i.test(field.name);
  let value = Math.max(0, [72, 45, 16][resource % 3] + trend + daily * 6 + noise);
  if (percentage) value = Math.min(100, value);
  else if (/byte|capacity|size|memory|mem_|bandwidth/i.test(field.name)) value *= 1024 * 1024;
  else if (/power/i.test(field.name)) value *= 10;
  return field.storage === 'Int' ? Math.round(value) : Math.round(value * 1000) / 1000;
}

function rowFactory(model, plan, opts) {
  const salts = new Map([...plan.fields].map(([k], i) => [k, (i + 1) * 100000]));
  const random = (salt, row, sample = 0) => {
    let v = (opts.seed ^ salt ^ Math.imul(row + 1, 0x9e3779b1) ^ Math.imul(sample + 1, 0x85ebca6b)) >>> 0;
    v ^= v >>> 16; v = Math.imul(v, 0x7feb352d); v ^= v >>> 15;
    return (v >>> 0) / 4294967296;
  };
  const cached = new Map();
  function identity(k, index) {
    const cacheKey = `${k}:${index}`;
    if (cached.has(cacheKey)) return cached.get(cacheKey);
    const f = plan.fields.get(k);
    const refs = plan.references.get(k);
    let value;
    if (refs) value = identity(refs[index % refs.length], Math.floor(index / refs.length));
    else value = f.storage === 'Int' ? salts.get(k) + index + 1 : `ns-${k.replaceAll('/', '-')}-${String(index + 1).padStart(4, '0')}`;
    cached.set(cacheKey, value);
    return value;
  }
  function scalar(d, f, index, sample) {
    const k = key(d.id, f.name), time = opts.startMs + sample * opts.interval;
    if (f.name === d.clock && d.kind === 'Metric') return f.storage === 'Int' ? time : iso(time);
    if (plan.identityFields.has(k)) {
      // The root has no parent; children reference earlier rows, not themselves.
      if (d.id === 'subnet' && f.name === 'ref_parent_subnet') return index === 0 ? null : identity(key(d.id, 'id'), index - 1);
      if (d.id === 'pon-element' && f.name === 'ref_parent_ne') return index % 3 === 0 ? null : identity(key(d.id, 'id'), index - index % 3);
      return identity(k, index);
    }
    const domain = f.domain && model.domains[f.domain];
    const guardValues = plan.guards.get(k);
    if (guardValues) {
      const values = [...new Set([...guardValues, ...(domain?.members.flatMap(m => m.wires) ?? [])])];
      return values[index % values.length];
    }
    if (domain) return domain.members[index % domain.members.length].wires[0];
    if (f.type === 's::DateTimeUtc') return iso(opts.startMs + index % opts.samples * opts.interval);
    if (f.type === 's::DateTime') return iso(opts.startMs + index % opts.samples * opts.interval).replace('T', ' ').replace('Z', '');
    if (f.type === 's::Date') return iso(opts.startMs + index % opts.samples * opts.interval).slice(0, 10);
    if (f.type === 's::EpochMillis' || f.sourceTimeEncoding === 'EpochMillis') return opts.startMs + index % opts.samples * opts.interval;
    if (f.metric) return metricValue(f, index, sample, opts.samples, time, random(salts.get(k), index, sample));
    if (f.storage === 'Float') return Math.round((20 + random(salts.get(k), index) * 80) * 1000) / 1000;
    if (f.storage === 'Int') return d.grain.includes(f.name) ? salts.get(k) + index + 1 : index + 1;
    if (f.storage === 'Bool') return index % 2;
    if (/address|ipv4|ip_address|ipaddr/i.test(f.name)) return `192.0.2.${index % 250 + 1}`;
    if (/name$/i.test(f.name)) return `${d.id}-演示-${String(index + 1).padStart(3, '0')}`;
    return `${d.id}:${f.name}:${index + 1}`;
  }
  return (d, index, sample = 0) => {
    const row = Object.fromEntries(d.fields.map(f => [f.column, scalar(d, f, index, sample)]));
    const appliedGuards = new Map();
    for (const r of model.relations.filter(r => r.from === d.id && r.guard)) {
      const target = plan.datasets.get(r.to);
      const matches = Array.from({ length: opts.resources }, (_, i) => i).some(i => r.pairs.every(p => {
        const from = d.fields.find(f => f.name === p.from), to = target.fields.find(f => f.name === p.to);
        return row[from.column] === scalar(target, to, i, 0);
      }));
      if (!matches) continue;
      const f = d.fields.find(f => f.name === r.guard.field), value = r.guard.input.args[0];
      if (!appliedGuards.has(f.column)) appliedGuards.set(f.column, []);
      if (!appliedGuards.get(f.column).includes(value)) appliedGuards.get(f.column).push(value);
    }
    for (const [column, matched] of appliedGuards) {
      const f = d.fields.find(f => f.column === column);
      const values = [...new Set([...matched, ...(f.domain ? model.domains[f.domain].members.flatMap(m => m.wires) : [])])];
      row[column] = values[index % values.length];
    }
    if (d.kind === 'Event') {
      const field = name => d.fields.find(f => f.name === name).column;
      const occur = opts.startMs + index % opts.samples * opts.interval;
      row[field('occur_utc')] = occur;
      const cleared = model.domains[d.fields.find(f => f.name === 'cleared').domain].members.find(m => m.id === 'cleared');
      row[field('clear_utc')] = row[field('cleared')] === cleared?.wires[0] ? Math.min(occur + 600000, opts.anchorMs - 1) : 0;
      row[field('me_name')] = `告警资源-${index + 1}`;
      row[field('alarm_name')] = ['CPU 利用率过高', '设备离线', '存储响应时间过长', '端口链路异常'][index % 4];
    }
    // Exercise genuine optional values without removing identities or metrics.
    const optional = d.fields.find(f => f.nullable && !f.domain && !f.metric && !f.sourceTimeEncoding && !plan.identityFields.has(key(d.id, f.name)) && !d.grain.includes(f.name) && /description|remark|location/i.test(f.name));
    if (optional && index === opts.resources - 1) row[optional.column] = null;
    return row;
  };
}

function relationSql(model, relation) {
  const from = model.datasets.find(d => d.id === relation.from), to = model.datasets.find(d => d.id === relation.to);
  const column = (d, field) => quote(d.fields.find(f => f.name === field).column);
  const equal = relation.pairs.map(p => `a.${column(from, p.from)}=b.${column(to, p.to)}`).join(' AND ');
  const guard = relation.guard ? ` AND a.${column(from, relation.guard.field)}=?` : '';
  const values = relation.guard ? [relation.guard.input.args[0]] : [];
  return { from, to, equal, guard, values };
}

export function validate(db, model, manifest) {
  const checks = { integrity: db.prepare('PRAGMA integrity_check').get().integrity_check, emptyDatasets: [], invalidRows: [], invalidDomains: [], invalidTimes: [], invalidGrains: [], invalidSeries: [], invalidScenarios: [], domains: [], relations: [], cardinalityExceptions: [] };
  const start = Date.parse(manifest.window.start), end = Date.parse(manifest.window.endExclusive);
  for (const d of model.datasets) {
    const table = quote(d.table);
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (JSON.stringify(columns.map(f => f.name)) !== JSON.stringify(d.fields.map(f => f.column))) throw new Error(`NS schema mismatch: ${d.id}`);
    const count = db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
    if (count === 0) checks.emptyDatasets.push(d.id);
    if (count !== manifest.tables[d.table].rows) checks.invalidRows.push(d.id);
    for (const f of d.fields) {
      const col = quote(f.column);
      if (!f.nullable && db.prepare(`SELECT count(*) n FROM ${table} WHERE ${col} IS NULL`).get().n) checks.invalidRows.push(`${d.id}.${f.name}:null`);
      const sqliteType = f.storage === 'Float' ? ['real', 'integer'] : f.storage === 'String' ? ['text'] : ['integer'];
      const invalidStorage = db.prepare(`SELECT count(*) n FROM ${table} WHERE ${col} IS NOT NULL AND typeof(${col}) NOT IN (${sqliteType.map(t => `'${t}'`).join(',')})`).get().n;
      if (invalidStorage) checks.invalidRows.push(`${d.id}.${f.name}:storage`);
      if (f.domain) {
        const wires = model.domains[f.domain].members.flatMap(m => m.wires);
        const invalid = db.prepare(`SELECT count(*) n FROM ${table} WHERE ${col} IS NOT NULL AND ${col} NOT IN (${wires.map(() => '?').join(',')})`).get(...wires).n;
        if (invalid) checks.invalidDomains.push(`${d.id}.${f.name}`);
        const observed = new Set(db.prepare(`SELECT DISTINCT ${col} value FROM ${table} WHERE ${col} IS NOT NULL`).all().map(r => r.value));
        const members = model.domains[f.domain].members;
        checks.domains.push({ dataset: d.id, field: f.name, domain: f.domain,
          present: members.filter(m => m.wires.some(w => observed.has(w))).map(m => m.id),
          absent: members.filter(m => !m.wires.some(w => observed.has(w))).map(m => m.id) });
      }
      if (f.type === 's::DateTimeUtc') {
        for (const row of db.prepare(`SELECT DISTINCT ${col} value FROM ${table} WHERE ${col} IS NOT NULL`).all()) {
          const ms = Date.parse(row.value);
          if (!Number.isFinite(ms) || iso(ms) !== row.value) { checks.invalidTimes.push(`${d.id}.${f.name}:encoding`); break; }
        }
      }
      if (f.metric && f.unit === '%') {
        if (db.prepare(`SELECT count(*) n FROM ${table} WHERE ${col}<0 OR ${col}>100`).get().n) checks.invalidScenarios.push(`${d.id}.${f.name}:percent`);
      }
      if (f.name === d.clock && d.kind === 'Metric') {
        const a = f.storage === 'Int' ? start : iso(start), b = f.storage === 'Int' ? end : iso(end);
        if (db.prepare(`SELECT count(*) n FROM ${table} WHERE ${col} IS NULL OR ${col}<? OR ${col}>=?`).get(a, b).n) checks.invalidTimes.push(`${d.id}.${f.name}`);
      }
    }
    if (d.kind === 'Metric') {
      const keys = d.grain.filter(n => n !== d.clock).map(n => quote(d.fields.find(f => f.name === n).column));
      const series = db.prepare(`SELECT count(*) n FROM ${table} GROUP BY ${keys.join(',')}`).all();
      if (series.length !== manifest.generation.resources || series.some(s => s.n !== manifest.samplesPerSeries)) checks.invalidSeries.push(d.id);
    }
    const grain = d.grain.map(n => quote(d.fields.find(f => f.name === n).column));
    if (db.prepare(`SELECT count(*) n FROM (SELECT 1 FROM ${table} GROUP BY ${grain.join(',')} HAVING count(*)>1)`).get().n) checks.invalidGrains.push(d.id);
  }
  for (const r of model.relations) {
    const { from, to, equal, guard, values } = relationSql(model, r);
    const result = db.prepare(`SELECT count(*) pairs,count(DISTINCT a.rowid) fromRows,count(DISTINCT b.rowid) toRows FROM ${quote(from.table)} a JOIN ${quote(to.table)} b ON ${equal} WHERE 1=1${guard}`).get(...values);
    const maximum = alias => db.prepare(`SELECT coalesce(max(n),0) n FROM (SELECT count(*) n FROM ${quote(from.table)} a JOIN ${quote(to.table)} b ON ${equal} WHERE 1=1${guard} GROUP BY ${alias}.rowid)`).get(...values).n;
    const maxTo = maximum('a'), maxFrom = maximum('b');
    const fromExceeded = !r.cardinality.from.startsWith('Many') && maxFrom > 1;
    const toExceeded = !r.cardinality.to.startsWith('Many') && maxTo > 1;
    const upperBoundExceeded = fromExceeded || toExceeded;
    const report = { id: r.id, ...result, maxFrom, maxTo, upperBoundExceeded };
    checks.relations.push(report);
    if (upperBoundExceeded) checks.cardinalityExceptions.push({ id: r.id, declared: r.cardinality, maxFrom, maxTo, sampledEndpoint: from.kind === 'Metric' || to.kind === 'Metric', explainedBySampling: (!fromExceeded || from.kind === 'Metric') && (!toExceeded || to.kind === 'Metric') });
  }
  const alarm = model.datasets.find(d => d.id === 'alarm-record');
  if (alarm) {
    const col = n => quote(alarm.fields.find(f => f.name === n).column);
    const cleared = model.domains[alarm.fields.find(f => f.name === 'cleared').domain].members.find(m => m.id === 'cleared').wires[0];
    const invalid = db.prepare(`SELECT count(*) n FROM ${quote(alarm.table)} WHERE ${col('occur_utc')}<? OR ${col('occur_utc')}>=? OR (${col('cleared')}=? AND (${col('clear_utc')}<${col('occur_utc')} OR ${col('clear_utc')}>=?)) OR (${col('cleared')}<>? AND ${col('clear_utc')}<>0)`).get(start, end, cleared, end, cleared).n;
    if (invalid) checks.invalidScenarios.push('alarm-times');
  }
  if (checks.integrity !== 'ok' || ['emptyDatasets', 'invalidRows', 'invalidDomains', 'invalidTimes', 'invalidGrains', 'invalidSeries', 'invalidScenarios'].some(k => checks[k].length) || checks.relations.some(r => r.pairs === 0) || checks.cardinalityExceptions.some(r => !r.explainedBySampling)) {
    throw new Error(`NS data validation failed: ${JSON.stringify({ ...checks, relations: checks.relations.filter(r => !r.pairs) })}`);
  }
  return checks;
}

export function generate(options, model = loadModel()) {
  const plan = prepare(model), opts = optionsOf(options, model, plan);
  if (existsSync(opts.output)) throw new Error(`Output already exists: ${opts.output}`);
  mkdirSync(dirname(opts.output), { recursive: true });
  const temporary = mkdtempSync(join(dirname(opts.output), '.ns-data-'));
  let db;
  try {
    const file = join(temporary, 'ns.sqlite');
    db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=OFF; BEGIN');
    const makeRow = rowFactory(model, plan, opts), tables = {};
    for (const d of model.datasets) {
      db.exec(`CREATE TABLE ${quote(d.table)} (${d.fields.map(f => `${quote(f.column)} ${sqlTypes[f.storage]}${f.nullable ? '' : ' NOT NULL'}`).join(',')})`);
      const grain = d.grain.map(n => quote(d.fields.find(f => f.name === n).column));
      db.exec(`CREATE UNIQUE INDEX ${quote('grain_' + d.id)} ON ${quote(d.table)} (${grain.join(',')})`);
      const insert = db.prepare(`INSERT INTO ${quote(d.table)} VALUES (${d.fields.map(() => '?').join(',')})`);
      const samples = d.kind === 'Metric' ? opts.samples : 1;
      for (let i = 0; i < opts.resources; i++) for (let s = 0; s < samples; s++) {
        const row = makeRow(d, i, s);
        insert.run(...d.fields.map(f => row[f.column]));
      }
      tables[d.table] = { dataset: d.id, columns: d.fields.length, rows: opts.resources * samples };
    }
    // Tuple indexes serve relation joins and verification, including composite keys.
    const indexes = new Set();
    for (const r of model.relations) for (const [id, side] of [[r.from, 'from'], [r.to, 'to']]) {
      const d = plan.datasets.get(id), names = r.pairs.map(p => d.fields.find(f => f.name === p[side]).column);
      const k = `${id}/${names.join(',')}`;
      if (indexes.has(k)) continue;
      indexes.add(k);
      db.exec(`CREATE INDEX ${quote('ref_' + indexes.size)} ON ${quote(d.table)} (${names.map(quote).join(',')})`);
    }
    db.exec('COMMIT; ANALYZE');
    const manifest = { version: 1, generation: { revision: 1, profile: 'ns-typed-demo', seed: opts.seed, resources: opts.resources, days: opts.days, intervalMinutes: opts.intervalMinutes },
      sourceCommit: model.sourceCommit, sourceSha256: model.sourceSha256, modelSha256: hash(JSON.stringify(model)), generatorSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
      window: { start: iso(opts.startMs), endExclusive: opts.anchor }, samplesPerSeries: opts.samples, tables,
      columns: model.datasets.reduce((n, d) => n + d.fields.length, 0),
      identityPlan: Object.fromEntries(plan.references),
      assumptions: ['Synthetic resource identity routing is a fixture scenario, not ontology inference.', 'Raw time fields with unconfirmed units receive synthetic millisecond values without asserting a typed instant.', 'All declared direct relations have witnesses; optional polymorphic references need not match every alternative.', 'Declared cardinality conflicts are reported; data generation does not amend model contracts.'] };
    manifest.checks = validate(db, model, manifest);
    db.close(); db = undefined;
    manifest.databaseSha256 = hash(readFileSync(file));
    writeFileSync(join(temporary, 'model.json'), JSON.stringify(model, null, 2) + '\n');
    writeFileSync(join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    if (existsSync(opts.output)) throw new Error(`Output already exists: ${opts.output}`);
    renameSync(temporary, opts.output);
    return manifest;
  } finally {
    db?.close();
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { output: { type: 'string' }, seed: { type: 'string' }, resources: { type: 'string' }, days: { type: 'string' }, 'interval-minutes': { type: 'string' }, 'anchor-utc': { type: 'string' } } });
    const options = Object.fromEntries(Object.entries(values).map(([k, v]) => [({ 'interval-minutes': 'intervalMinutes', 'anchor-utc': 'anchor' })[k] ?? k, ['seed', 'resources', 'days', 'interval-minutes'].includes(k) ? Number(v) : v]));
    const m = generate(options);
    console.log(JSON.stringify({ output: resolve(options.output), tables: Object.keys(m.tables).length, rows: Object.values(m.tables).reduce((n, t) => n + t.rows, 0), databaseSha256: m.databaseSha256, cardinalityExceptions: m.checks.cardinalityExceptions.length }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
