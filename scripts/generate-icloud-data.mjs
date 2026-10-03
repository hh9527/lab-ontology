import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('../', import.meta.url));
const quote = name => `"${name.replaceAll('"', '""')}"`;
const iso = ms => new Date(ms).toISOString().replace('.000Z', 'Z');
const hash = data => createHash('sha256').update(data).digest('hex');
const wire = value => Object.values(value)[0];
const leaves = key => key.Eq ? [key.Eq] : Object.values(key).flatMap(parts => parts.flatMap(leaves));

export function loadModel() {
  const result = spawnSync(join(root, 'bin/telora'), ['-C', 'icloud_model', 'eval', '@src/source_audit:report',
    '--initialization-fuel', '100000', '--request-fuel', '100000', '--with-memory-limit', '2048'],
  { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'Model export failed');
  return JSON.parse(result.stdout);
}

function grain(dataset) {
  if (dataset.dataset?.grain.length) return dataset.dataset.grain.map(name => {
    const field = dataset.fields.find(field => field.name === name);
    if (!field) throw new Error(`Unknown grain field ${dataset.id}.${name}`);
    return field.column;
  });
  // Source-only KPI carriers do not declare a DatasetSpec. This is a synthetic sample identity.
  if (dataset.fields.some(field => field.column === 'ts')) {
    return ['resId', 'tenantId', 'ts'].filter(column => dataset.fields.some(field => field.column === column));
  }
  return dataset.fields.filter(field => field.is_key).map(field => field.column);
}

export function generate(options, model = loadModel()) {
  const { output, seed, resources, days, intervalMinutes, anchor } = options;
  const anchorMs = Date.parse(anchor);
  for (const [name, value] of Object.entries({ seed, resources, days, intervalMinutes })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  }
  if (seed > 0xffffffff) throw new Error('seed must fit an unsigned 32-bit integer');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(anchor) || !Number.isFinite(anchorMs) || iso(anchorMs) !== anchor) {
    throw new Error('anchor must be a valid UTC timestamp: YYYY-MM-DDTHH:MM:SSZ');
  }
  const interval = intervalMinutes * 60000;
  const samples = Math.ceil(days * 86400000 / interval);
  if (resources < 6) throw new Error('resources must be at least 6 to cover PON and polymorphic scenarios');
  if (samples * resources * 18 > 10000000) throw new Error('Requested data exceeds 10 million KPI rows');
  if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
  const catalogBytes = readFileSync(join(root, 'icloud_model/data/source_catalog.json'));
  const catalog = JSON.parse(catalogBytes);
  const tables = new Map();
  for (const dataset of model.datasets) if (!tables.has(dataset.table)) tables.set(dataset.table, dataset);
  if (tables.size !== catalog.datasets.length) throw new Error('Catalog/model table coverage differs');
  const byId = new Map(model.datasets.map(dataset => [dataset.id, dataset]));
  let state = seed >>> 0;
  function random() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  }
  const rows = new Map();
  const enums = new Map();
  for (const dimension of model.dimensions) {
    const dataset = byId.get(dimension.dataset);
    const key = `${dataset.table}.${dimension.column}`;
    if (dimension.values.length && !dataset.scope.length && !enums.has(key)) {
      enums.set(key, dimension.values.map(value => wire(value.wires[0])));
    }
  }
  const id = (table, index) => `${table}-${String(index + 1).padStart(4, '0')}`;
  function value(dataset, field, index) {
    const column = field.column;
    if (field.time) {
      const ms = anchorMs - (45 + index) * 86400000;
      if (field.time.encoding === 'EpochMillis') return ms;
      if (field.time.encoding === 'DateText') return iso(ms).slice(0, 10);
      if (field.time.encoding === 'Rfc3339Text') return iso(ms);
      throw new Error(`Unsupported time encoding ${dataset.table}.${column}`);
    }
    const values = enums.get(`${dataset.table}.${column}`);
    if (values) return values[index % values.length];
    if (field.scalar === 'Int') return index + 1;
    if (field.scalar === 'Float') return Number((10 + random() * 80).toFixed(3));
    if (field.scalar === 'Bool') return index % 2;
    if (field.scalar !== 'String') throw new Error(`Unsupported scalar ${field.scalar}`);
    if (/tenant_?id/i.test(column)) return id('X_TENANT_VIEW', index);
    if (/^(projectId|refParentSubnet|siteId|SITE_ID|STREXT13|srcSiteId|destSiteId)$/.test(column)) return id('X_SITE_VIEW', index);
    if (/^(id|resId|CSN|TENANT_ID|oriResId|frameDn)$/i.test(column)) return id(dataset.table, index);
    if (/ipAddress|IPADDRESS/i.test(column)) return `192.0.2.${index % 254 + 1}`;
    if (/mac/i.test(column)) return `02:00:00:00:${Math.floor(index / 256).toString(16).padStart(2, '0')}:${(index % 256).toString(16).padStart(2, '0')}`;
    if (/name/i.test(column)) return `${dataset.table} ${index + 1}`;
    return `${column}-${index + 1}`;
  }
  for (const [table, dataset] of tables) {
    const source = catalog.datasets.find(entry => entry.table === table);
    if (source.fields.length !== dataset.fields.length || source.fields.some(field => !dataset.fields.some(entry => entry.column === field.name))) {
      throw new Error(`Catalog/model columns differ: ${table}`);
    }
    rows.set(table, Array.from({ length: resources }, (_, index) => Object.fromEntries(dataset.fields.map(field => [field.column, value(dataset, field, index)]))));
  }
  const pon = rows.get('I_EntPonElement');
  for (let i = 0; i < pon.length; i++) {
    pon[i].classification = i % 3 === 0 ? 'ne.category.olt' : i % 3 === 1 ? 'ne.category.pon.onu' : 'ne.category.pon.spl';
    pon[i].parentOltResId = i % 3 === 0 ? '' : pon[i - i % 3].id;
    // OLT and its ONUs share a tenant and site in the synthetic hierarchy.
    for (const column of ['tenantId', 'projectId', 'refParentSubnet']) pon[i][column] = pon[i - i % 3][column];
  }
  // Group alternative owners by source column. Separate physical families keep distinct IDs.
  const groups = new Map();
  const identityField = field => field.is_key || ['oriResId', 'frameDn', 'diskId', 'name'].includes(field.column);
  for (const relation of model.relations) {
    if (byId.get(relation.from_dataset).scope.length || byId.get(relation.to_dataset).scope.length) continue;
    for (const pair of leaves(relation.key)) {
      let fromTable = relation.from_table;
      let toTable = relation.to_table;
      let fromColumn = pair.from_column;
      let toColumn = pair.to_column;
      let field = tables.get(fromTable).fields.find(entry => entry.column === fromColumn);
      const targetField = tables.get(toTable).fields.find(entry => entry.column === toColumn);
      if (identityField(field) && !identityField(targetField)) {
        [fromTable, toTable] = [toTable, fromTable];
        [fromColumn, toColumn] = [toColumn, fromColumn];
        field = targetField;
      }
      if (identityField(field) || ['tenantId', 'TENANTID', 'projectId', 'refParentSubnet', 'parentOltResId'].includes(fromColumn)) continue;
      const key = `${fromTable}.${fromColumn}`;
      if (!groups.has(key)) groups.set(key, { table: fromTable, column: fromColumn, targets: [] });
      const targets = groups.get(key).targets;
      if (!targets.some(target => target.table === toTable && target.column === toColumn)) targets.push({ table: toTable, column: toColumn });
    }
  }
  // Multiple passes resolve component references whose target column is itself a reference.
  for (let pass = 0; pass < 3; pass++) for (const group of groups.values()) {
    rows.get(group.table).forEach((row, index) => {
      const target = group.targets[index % group.targets.length];
      row[group.column] = rows.get(target.table)[index][target.column];
    });
  }
  const ownerTables = {
    NetworkDeviceInterfaceKPI: 'I_EnterpriseNetworkLTP', NetworkDeviceBoardKPI: 'I_EnterpriseSlot',
    ServerDeviceKPI: 'PhysicalServer', StorageDeviceKPI: 'HuaweiStorageDevice',
    StorageHardDriveKPI: 'SYS_StorageDisk',
  };
  for (const [table, dataset] of tables) if (dataset.fields.some(field => field.column === 'ts')) {
    const ownerTable = ownerTables[table] ?? (table.startsWith('Pon') ? 'I_EntPonElement' : 'I_EntNetworkElement');
    const owners = rows.get(ownerTable);
    if (table === 'StorageDeviceKPI') {
      const base = rows.get(table);
      rows.set(table, [...owners, ...rows.get('FCSwitchDevice')].map((owner, index) => ({ ...base[index % base.length], resId: owner.id })));
    }
    rows.get(table).forEach((row, index) => {
      const owner = table === 'StorageDeviceKPI'
        ? (index < owners.length ? owners[index] : rows.get('FCSwitchDevice')[index - owners.length]) : owners[index];
      if (table === 'PonDeviceOnuKPI') {
        const onus = pon.filter(entry => entry.classification === 'ne.category.pon.onu');
        const onu = onus[index % onus.length];
        // One series per declared ONU identity, rather than duplicate owner/time samples.
        row.resId = onu.id;
        row.tenantId = onu.tenantId;
        row.parentId = onu.parentOltResId;
      } else {
        row.resId = owner.id ?? owner.resId ?? owner.diskId ?? id(ownerTable, index);
        if ('tenantId' in row) row.tenantId = owner.tenantId ?? id('X_TENANT_VIEW', index);
        if ('parentId' in row) row.parentId = ['NetworkApRadioKPI', 'NetworkApRadioSsidKPI'].includes(table)
          ? rows.get('I_EntNetworkElement')[index].id
          : owner.refParentNE ?? owner.parentResId ?? owner.id ?? row.resId;
      }
      if ('deviceName' in row) row.deviceName = owner.name;
      if ('classification' in row) row.classification = owner.classification;
    });
    if (table === 'PonDeviceOnuKPI') rows.set(table, rows.get(table).filter((row, index, all) => all.findIndex(other => other.resId === row.resId) === index));
  }
  const alarms = rows.get('T_CURRENT_ALARM');
  alarms.forEach((row, index) => {
    const ownerTable = ['I_EntNetworkElement', 'PhysicalServer', 'HuaweiStorageDevice', 'I_EntPonElement', 'FCSwitchDevice', 'I_EntCollaborationElement'][index % 6];
    const owner = rows.get(ownerTable)[index];
    row.MEDN = owner.id;
    row.TENANTID = owner.tenantId;
    row.STREXT13 = owner.projectId ?? id('X_SITE_VIEW', index);
    row.MENAME = owner.name;
    row.CSN = index + 1;
    row.SEVERITY = index % 4 + 1;
    row.ACKED = index % 2;
    row.CLEARED = index % 3 === 0 ? 1 : 0;
    const recentSamples = Math.max(1, Math.min(samples, Math.floor(45 * 86400000 / interval)));
    const occur = anchorMs - days * 86400000 + (samples - 1 - index % recentSamples) * interval;
    for (const column of ['OCCURUTC', 'OCCURTIME', 'LATESTOCCURUTC', 'LATESTOCCURTIME']) row[column] = occur;
    row.ARRIVEUTC = occur + 1000;
    row.ACKUTC = row.ACKED ? occur + 60000 : 0;
    row.CLEARUTC = row.CLEARED ? occur + 120000 : 0;
    row.CLEARTIME = row.CLEARUTC;
    row.ENDUTC = row.CLEARUTC;
    row.COMMENTUTC = row.ACKUTC;
  });
  rows.get('I_EnterpriseFrame').at(-1).remark = null;
  mkdirSync(dirname(output), { recursive: true });
  const staging = mkdtempSync(join(dirname(output), '.icloud-data-'));
  const databasePath = join(staging, 'icloud.sqlite');
  let db;
  try {
    db = new DatabaseSync(databasePath);
    db.exec('PRAGMA journal_mode=DELETE; BEGIN');
    const counts = {};
    const indices = new Set();
    const startMs = anchorMs - days * 86400000;
    for (const [table, dataset] of tables) {
      const columns = dataset.fields.map(field => `${quote(field.column)} ${field.scalar === 'String' ? 'TEXT' : field.scalar === 'Float' ? 'REAL' : 'INTEGER'}${field.nullable ? '' : ' NOT NULL'}`);
      db.exec(`CREATE TABLE ${quote(table)} (${columns.join(',')}) STRICT`);
      const insert = db.prepare(`INSERT INTO ${quote(table)} VALUES (${columns.map(() => '?').join(',')})`);
      const metric = dataset.fields.some(field => field.column === 'ts');
      counts[table] = 0;
      const sourceFields = catalog.datasets.find(entry => entry.table === table).fields;
      const metricColumns = new Set(sourceFields.filter(field => field.columnType === 'measure').map(field => field.name));
      for (const [index, base] of rows.get(table).entries()) {
        for (let sample = 0; sample < (metric ? samples : 1); sample++) {
          const row = { ...base };
          if (metric) {
            row.ts = iso(startMs + sample * interval);
            const daily = Math.sin(sample * interval / 86400000 * 2 * Math.PI);
            const trend = sample / Math.max(1, samples - 1) * (index % 3 === 0 ? 35 : index % 3 === 1 ? -15 : 0);
            for (const field of dataset.fields) if (metricColumns.has(field.column)) {
              let number = field.column.endsWith('Effcnt') ? 1 : /onlineRate/i.test(field.column)
                ? (index % 6 === 5 && sample % 24 < 4 ? 0 : 100)
                : /count/i.test(field.column) ? 8 + index % 8
                : /optics.*power|rssi|noise/i.test(field.column) ? -20 + daily * 3
                : /power/i.test(field.column) ? 150 + index * 10 + daily * 20
                : Math.max(0, Math.min(100, 25 + index % 4 * 10 + daily * 8 + trend + random()));
              if (field.scalar === 'Int') number = Math.round(number);
              if (field.scalar === 'Float') number = Number(number.toFixed(3));
              if (field.scalar === 'Int' || field.scalar === 'Float') row[field.column] = number;
            }
          }
          insert.run(...dataset.fields.map(field => row[field.column]));
          counts[table]++;
        }
      }
      const identity = grain(dataset);
      if (identity.length) {
        db.exec(`CREATE UNIQUE INDEX ${quote(`grain_${table}`)} ON ${quote(table)} (${identity.map(quote)})`);
        indices.add(`${table}:${identity.join(',')}`);
      }
    }
    function index(table, columns) {
      const key = `${table}:${columns.join(',')}`;
      if (indices.has(key)) return;
      indices.add(key);
      db.exec(`CREATE INDEX ${quote(`join_${indices.size}`)} ON ${quote(table)} (${columns.map(quote)})`);
    }
    for (const relation of model.relations) {
      for (const pair of leaves(relation.key)) {
        index(relation.from_table, [pair.from_column]);
        index(relation.to_table, [pair.to_column]);
      }
    }
    for (const [table, dataset] of tables) if (dataset.fields.some(field => field.column === 'ts')) index(table, ['ts']);
    db.exec('COMMIT; ANALYZE');
    const checks = validate(db, model, counts);
    if (checks.integrity !== 'ok' || checks.emptyTables.length || checks.emptyCarriers.length || checks.invalidTimes.length || checks.invalidEnums.length || checks.missingCpuSeries.length || checks.alarmsWithoutCpuSamples.length) throw new Error(`Validation failed: ${JSON.stringify(checks)}`);
    db.close();
    db = undefined;
    const manifest = {
      format: 'icloud-synthetic-data/v1', revision: model.revision,
      options: { seed, resources, days, intervalMinutes, anchor },
      window: { start: iso(startMs), endExclusive: anchor, samplesPerSeries: samples },
      catalogSha256: hash(catalogBytes), modelSha256: hash(JSON.stringify(model)),
      database: { file: 'icloud.sqlite', sha256: hash(readFileSync(databasePath)) },
      tables: counts, columns: [...tables.values()].reduce((sum, dataset) => sum + dataset.fields.length, 0),
      indices: indices.size, checks,
      assumptions: [
        'All values are synthetic; generic source fields are deterministic placeholders.',
        'Source-only KPI identity is resId + tenantId (when present) + ts; this is a generation assumption.',
        'StorageHardDriveKPI ownership is synthetic because the prepared model declares no owner relation.',
        'Polymorphic references select one resource family per row; unmatched alternative relations are reported.',
        'EpochMillis fields use millisecond values; unresolved source semantics remain subject to model TODOs.',
        'Absent alarm acknowledgement/clear times use zero; Local integer times use the same synthetic clock as UTC.',
        'Relationship cardinality exceptions are reported and are not represented as SQLite foreign keys.',
      ],
    };
    writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(staging, 'model.json'), `${JSON.stringify(model, null, 2)}\n`);
    renameSync(staging, output);
    return manifest;
  } finally {
    db?.close();
    if (existsSync(staging)) rmSync(staging, { recursive: true });
  }
}

function scopeSQL(dataset, alias, bindings, model) {
  return dataset.scope.map(predicate => {
    if (predicate.op !== 'Eq') throw new Error(`Unsupported scope: ${dataset.id}`);
    const column = dataset.fields.find(field => field.name === predicate.field).column;
    const dimension = model.dimensions.find(entry => entry.dataset === dataset.id && entry.column === column && !entry.computed);
    const input = wire(predicate.input);
    const canonical = dimension?.values.find(value => value.id === input);
    const values = canonical ? canonical.wires.map(wire) : [input];
    bindings.push(...values);
    return `${alias}.${quote(column)} IN (${values.map(() => '?')})`;
  });
}

function relationSQL(key) {
  if (key.Eq) return `f.${quote(key.Eq.from_column)} = t.${quote(key.Eq.to_column)}`;
  const [operator, parts] = Object.entries(key)[0];
  return `(${parts.map(relationSQL).join(operator === 'And' ? ' AND ' : ' OR ')})`;
}

export function validate(db, model, counts) {
  const checks = { integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    emptyTables: [], emptyCarriers: [], invalidTimes: [], invalidEnums: [], relations: [],
    missingCpuSeries: [], alarmsWithoutCpuSamples: [], unsupportedAlarmCpuResources: [] };
  const cpuSources = {
    I_EntNetworkElement: 'NetworkDeviceKPI', PhysicalServer: 'ServerDeviceKPI',
    HuaweiStorageDevice: 'StorageDeviceKPI', FCSwitchDevice: 'StorageDeviceKPI', I_EntPonElement: 'PonDeviceKPI',
  };
  for (const [resource, metric] of Object.entries(cpuSources)) {
    const missing = db.prepare(`SELECT r.id FROM ${quote(resource)} r WHERE NOT EXISTS (SELECT 1 FROM ${quote(metric)} k WHERE k.resId=r.id)`).all();
    checks.missingCpuSeries.push(...missing.map(row => ({ resource, id: row.id, metric })));
    const missingAlarms = db.prepare(`SELECT a.CSN, a.MEDN FROM T_CURRENT_ALARM a JOIN ${quote(resource)} r ON a.MEDN=r.id
      WHERE NOT EXISTS (SELECT 1 FROM ${quote(metric)} k WHERE k.resId=r.id AND k.ts >= strftime('%Y-%m-%dT00:00:00Z', a.OCCURUTC / 1000, 'unixepoch')
        AND k.ts < strftime('%Y-%m-%dT00:00:00Z', a.OCCURUTC / 1000, 'unixepoch', '+1 day'))`).all();
    checks.alarmsWithoutCpuSamples.push(...missingAlarms.map(row => ({ resource, ...row, metric })));
  }
  checks.unsupportedAlarmCpuResources = db.prepare('SELECT a.CSN, a.MEDN FROM T_CURRENT_ALARM a JOIN I_EntCollaborationElement r ON a.MEDN=r.id').all()
    .map(row => ({ resource: 'I_EntCollaborationElement', ...row, reason: 'No declared CPU sample source' }));
  for (const [table, expected] of Object.entries(counts)) {
    const actual = db.prepare(`SELECT count(*) AS n FROM ${quote(table)}`).get().n;
    if (actual !== expected) throw new Error(`Row count mismatch: ${table}`);
    if (!actual) checks.emptyTables.push(table);
  }
  const byId = new Map(model.datasets.map(dataset => [dataset.id, dataset]));
  for (const dataset of model.datasets) {
    const bindings = [];
    const scope = scopeSQL(dataset, 'f', bindings, model);
    const where = scope.length ? ` WHERE ${scope.join(' AND ')}` : '';
    if (!db.prepare(`SELECT count(*) AS n FROM ${quote(dataset.table)} f${where}`).get(...bindings).n) checks.emptyCarriers.push(dataset.id);
    for (const field of dataset.fields.filter(field => field.time)) {
      const column = quote(field.column);
      const test = field.time.encoding === 'EpochMillis' ? `typeof(${column}) != 'integer'`
        : field.time.encoding === 'DateText' ? `length(${column}) != 10 OR date(${column}) IS NULL`
        : `length(${column}) != 20 OR substr(${column},11,1) != 'T' OR substr(${column},20,1) != 'Z' OR datetime(${column}) IS NULL`;
      const invalid = db.prepare(`SELECT count(*) AS n FROM ${quote(dataset.table)} WHERE ${column} IS NOT NULL AND (${test})`).get().n;
      if (invalid) checks.invalidTimes.push({ table: dataset.table, column: field.column, invalid });
    }
  }
  const checkedEnums = new Set();
  for (const dimension of model.dimensions) {
    const dataset = byId.get(dimension.dataset);
    const key = `${dataset.table}.${dimension.column}`;
    if (!dimension.values.length || dataset.scope.length || checkedEnums.has(key)) continue;
    checkedEnums.add(key);
    const values = dimension.values.flatMap(value => value.wires.map(wire));
    const column = quote(dimension.column);
    const invalid = db.prepare(`SELECT count(*) AS n FROM ${quote(dataset.table)} WHERE ${column} IS NOT NULL AND ${column} NOT IN (${values.map(() => '?')})`).get(...values).n;
    if (invalid) checks.invalidEnums.push({ table: dataset.table, column: dimension.column, invalid });
  }
  for (const relation of model.relations) {
    const bindings = [];
    const fromScope = scopeSQL(byId.get(relation.from_dataset), 'f', bindings, model);
    const toScope = scopeSQL(byId.get(relation.to_dataset), 't', bindings, model);
    const condition = [relationSQL(relation.key), ...fromScope, ...toScope].join(' AND ');
    const pairs = `SELECT f.rowid AS fid, t.rowid AS tid FROM ${quote(relation.from_table)} f JOIN ${quote(relation.to_table)} t ON ${condition}`;
    const summary = db.prepare(`SELECT count(*) AS pairs, count(DISTINCT fid) AS fromMatched, count(DISTINCT tid) AS toMatched FROM (${pairs})`).get(...bindings);
    const maxima = `SELECT (SELECT coalesce(max(n),0) FROM (SELECT count(*) n FROM matches GROUP BY fid)) AS maxToPerFrom,
      (SELECT coalesce(max(n),0) FROM (SELECT count(*) n FROM matches GROUP BY tid)) AS maxFromPerTo
      FROM (SELECT 1)`;
    // CTE avoids materializing large KPI joins in JavaScript.
    const bounds = db.prepare(`WITH matches AS (${pairs}) ${maxima}`).get(...bindings);
    checks.relations.push({ id: relation.id, ...summary, ...bounds,
      upperBoundExceeded: (['One', 'Optional'].includes(relation.cardinality.to) && bounds.maxToPerFrom > 1)
        || (['One', 'Optional'].includes(relation.cardinality.from) && bounds.maxFromPerTo > 1) });
  }
  return checks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    output: { type: 'string', default: 'bin/icloud-data' }, seed: { type: 'string', default: '20260926' },
    resources: { type: 'string', default: '12' }, days: { type: 'string', default: '32' },
    'interval-minutes': { type: 'string', default: '60' },
    'anchor-utc': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/generate-icloud-data.mjs [--output DIR] [--seed N] [--resources N>=6]\n  [--days N] [--interval-minutes N] [--anchor-utc YYYY-MM-DDTHH:MM:SSZ]\nRequires Node.js 22.13+ and bin/telora. Creates icloud.sqlite, manifest.json and model.json.\nExisting output directories are preserved. Default: 12 resources/table, 32 days, hourly samples.');
  } else {
    const manifest = generate({ output: resolve(values.output), seed: Number(values.seed), resources: Number(values.resources),
      days: Number(values.days), intervalMinutes: Number(values['interval-minutes']),
      anchor: values['anchor-utc'] ?? iso(Math.floor(Date.now() / 60000) * 60000) });
    console.log(JSON.stringify({ output: resolve(values.output), tables: Object.keys(manifest.tables).length,
      rows: Object.values(manifest.tables).reduce((sum, count) => sum + count, 0),
      relationsCovered: manifest.checks.relations.filter(relation => relation.pairs > 0).length,
      cardinalityExceptions: manifest.checks.relations.filter(relation => relation.upperBoundExceeded).length }));
  }
}
