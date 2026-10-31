import { createKpiWaves } from './kpi-waveforms.mjs';
import { categoryRandom, categoryValue, enumCategoryValue, tenantLayout, networkDevicePresentation, networkDeviceClass } from './icloud-category-profiles.mjs';
import { normalizeUtcMillis } from './utc-milliseconds.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('../', import.meta.url));
const quote = name => `"${name.replaceAll('"', '""')}"`;
const iso = ms => new Date(ms).toISOString();
const hash = data => createHash('sha256').update(data).digest('hex');
const wire = value => Object.values(value)[0];
const leaves = key => key.Eq ? [key.Eq] : Object.values(key).flatMap(parts => parts.flatMap(leaves));

// Synthetic profiles adapted from icloud-corpus/pack/tables.py. These are
// generation scenarios, not additional model capabilities or source facts.
const profiles = {
  ServerDeviceKPI: {
    cpuUsage: [[78, 16], [45, 10], [12, 7]], memUsage: [[66, 15], [48, 9], [22, 8]],
    systemPower: [[860, 160], [540, 80], [300, 40]],
    averagePower: [[820, 140], [510, 70], [280, 35]],
    peakPower: [[1180, 190], [760, 95], [420, 50]],
  },
  StorageDeviceKPI: {
    cpuusage: [[86, 10], [40, 10], [10, 6]], memoryusage: [[78, 10], [45, 8], [20, 8]],
  },
  StorageHardDriveKPI: {
    utility: [[85, 8], [45, 12], [12, 8]],
    avgreadiosize: [[512, 96], [256, 64], [64, 32]],
    avgwriteiosize: [[410, 80], [200, 48], [48, 24]],
  },
};
const resourceNames = {
  X_TENANT_VIEW: '企业租户', X_SITE_VIEW: '园区站点', I_EntNetworkElement: '园区交换机',
  PhysicalServer: '业务服务器', HuaweiStorageDevice: '存储阵列', FCSwitchDevice: '存储交换机',
  I_EntPonElement: '光接入设备', I_EntCollaborationElement: '会议终端',
  I_EnterpriseNetworkLTP: '网络接口', I_EnterpriseSlot: '设备板卡', SYS_StorageDisk: '存储磁盘',
};

const defaultWaves = createKpiWaves(20261031);
export function metricValue(table, column, index, sample, interval, random, samples = 1, startMs = 0, waves = defaultWaves) {
  const elapsed = sample * interval;
  // A synthetic UTC+08 business clock: peaks around afternoon, quiet nights,
  // lower weekends and occasional resource-specific incidents.
  const clock = new Date(startMs + elapsed + 8 * 3600000);
  const hour = clock.getUTCHours() + clock.getUTCMinutes() / 60;
  const shape = waves(table,column,index);
  const {daily,load:dayLoad,jitter} = shape.at(startMs+elapsed);
  const weekday = ![0, 6].includes(clock.getUTCDay());
  const incident = (Math.floor(elapsed / 86400000) + index) % 11 === 3
    ? Math.exp(-Math.pow((hour - 15) / 1.2, 2)) : 0;
  const progress = sample / Math.max(1, samples - 1);
  const trend = progress * [18, -12, 2][index % 3] * shape.trend;
  const load = dayLoad * (weekday ? 1 : 0.76);
  const variation = jitter * 8;
  const profile = profiles[table]?.[column]?.[index % 3];
  if (/effcnt$/i.test(column)) return 1;
  const noise = (random() - 0.5) * 1.2;
  if (profile) {
    const number = Math.max(0, profile[0] * shape.baseline + profile[1] * daily + trend * 0.25
      + (index % 7 - 3) * 0.5 + variation + noise + incident * profile[1]);
    return /power|iosize/i.test(column) ? number : Math.min(100, number);
  }
  if (/onlineRate/i.test(column)) return index % 6 === 5 && elapsed % 86400000 < 4 * 3600000 || incident > 0.7 ? 0 : 100;
  if (/optics.*power/i.test(column)) return (/tx/i.test(column) ? -4 : -20) + daily * 1.5 - incident * 3;
  if (/rssi/i.test(column)) return -65 + daily * 7 - incident * 8;
  if (/noise/i.test(column)) return -96 + daily * 3 + incident * 7;
  if (/temperature/i.test(column)) return 33 + load * 25 + index % 5 + incident * 20 + noise;
  if (/loss|retry.*rate|PortPER/i.test(column)) return Math.max(0, 0.08 + load * 0.15 + incident * 3 + noise * 0.03);
  if (/errors?|BipError/i.test(column)) return Math.round(load * 2 + incident * (20 + index % 5));
  if (/jitter/i.test(column)) return 0.3 + load * 2 + incident * 12;
  if (/delay|PingRespTime/i.test(column)) return 2 + load * 12 + incident * 80;
  if (/^(portCount|adminStatusCount)$/i.test(column)) return 48;
  if (/^(portUsedCount|operStatusCount)$/i.test(column)) return Math.round(48 * load);
  if (/count|Terminals/i.test(column)) return Math.round(8 + (20 + index % 8 * 8) * load + incident * 10);
  if (/speed|traffic|octets|bytes|Ethport.*Rate/i.test(column)) {
    const scale = /bytes|octets(?!speed)/i.test(column) ? 100000000 : 100000;
    return Math.max(0, scale * (1 + index % 6 * 0.35) * (load + incident * 0.25 + noise * 0.005));
  }
  if (/power/i.test(column)) return 150 + index * 10 + daily * 20;
  // High/mid/low populations make both sides of CPU/utilization thresholds reachable.
  return Math.max(0, Math.min(100, [68, 45, 18][index % 3] * shape.baseline + daily * 9 + trend
    + (index % 7 - 3) * 0.8 + variation + noise + incident * 18));
}

export function loadModel() {
  const contract = JSON.parse(readFileSync(join(root, 'icloud_model/data/generation-contract.json')));
  if (contract.format !== 'icloud-generation-contract/v1') throw new Error('Unsupported IC generation contract');
  if (contract.catalogSha256 !== hash(readFileSync(join(root, 'icloud_model/data/source_catalog.json')))) {
    throw new Error('Stale IC generation contract: update generation-contract.json with source_catalog.json');
  }
  return contract.model;
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
  const { output, seed, resources, days, intervalMinutes, anchor: inputAnchor, storageGapHours = 0, alarmsPerResourcePerDay = 2 } = options;
  const anchor = normalizeUtcMillis(inputAnchor);
  const anchorMs = Date.parse(anchor);
  for (const [name, value] of Object.entries({ seed, resources, days, intervalMinutes, alarmsPerResourcePerDay })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  }
  if (seed > 0xffffffff) throw new Error('seed must fit an unsigned 32-bit integer');
  if (!Number.isSafeInteger(storageGapHours) || storageGapHours < 0 || storageGapHours >= days * 24) {
    throw new Error('storageGapHours must be a nonnegative safe integer smaller than the KPI window in hours');
  }
  const interval = intervalMinutes * 60000;
  const samples = Math.ceil(days * 86400000 / interval);
  if (resources < 6) throw new Error('resources must be at least 6 to cover PON and polymorphic scenarios');
  if (samples * resources * 18 > 10000000) throw new Error('Requested data exceeds 10 million KPI rows');
  if ((days + 1) * resources * alarmsPerResourcePerDay * 1.6 > 1000000) throw new Error('Requested data exceeds 1 million alarm rows');
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
  const waves = createKpiWaves(seed);
  const rows = new Map();
  const enums = new Map();
  const enumDefinitions = new Map();
  for (const dimension of model.dimensions) {
    const dataset = byId.get(dimension.dataset);
    const key = `${dataset.table}.${dimension.column}`;
    if (dimension.values.length && !dataset.scope.length && !enums.has(key)) {
      enums.set(key, dimension.values.map(value => wire(value.wires[0])));
      enumDefinitions.set(key, dimension.values);
    }
  }
  const tenants = tenantLayout(resources, seed);
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
    if (dataset.table === 'I_EntNetworkElement' && column === 'classification') return networkDeviceClass(index,seed,dataset.table,enumDefinitions.get(`${dataset.table}.${column}`));
    if (values) return enumCategoryValue(dataset.table, column, index, seed, enumDefinitions.get(`${dataset.table}.${column}`)) ?? values[index % values.length];
    const category = categoryValue(dataset.table, column, index, seed);
    if (category !== undefined) return field.scalar === 'String' ? String(category) : category;
    if (field.scalar === 'Int') return index + 1;
    if (field.scalar === 'Float') return Number((10 + random() * 80).toFixed(3));
    if (field.scalar === 'Bool') return index % 2;
    if (field.scalar !== 'String') throw new Error(`Unsupported scalar ${field.scalar}`);
    if (/tenant_?id/i.test(column)) return id('X_TENANT_VIEW', dataset.table === 'X_TENANT_VIEW' ? index : tenants.assignments[index]);
    if (/^(projectId|refParentSubnet|siteId|SITE_ID|STREXT13|srcSiteId|destSiteId)$/.test(column)) return id('X_SITE_VIEW', index);
    if (/^(id|resId|CSN|TENANT_ID|oriResId|frameDn)$/i.test(column)) return id(dataset.table, index);
    if (/ipAddress|IPADDRESS/i.test(column)) return `192.0.2.${index % 254 + 1}`;
    if (/mac/i.test(column)) return `02:00:00:00:${Math.floor(index / 256).toString(16).padStart(2, '0')}:${(index % 256).toString(16).padStart(2, '0')}`;
    if (/name/i.test(column)) return `${resourceNames[dataset.table] ?? dataset.table}-${String(index + 1).padStart(2, '0')}`;
    return `${column}-${index + 1}`;
  }
  for (const [table, dataset] of tables) {
    const source = catalog.datasets.find(entry => entry.table === table);
    if (source.fields.length !== dataset.fields.length || source.fields.some(field => !dataset.fields.some(entry => entry.column === field.name))) {
      throw new Error(`Catalog/model columns differ: ${table}`);
    }
    rows.set(table, Array.from({ length: table === 'X_TENANT_VIEW' ? tenants.count : resources }, (_, index) => Object.fromEntries(dataset.fields.map(field => [field.column, value(dataset, field, index)]))));
  }
  const networkClasses = enumDefinitions.get('I_EntNetworkElement.classification');
  rows.get('I_EntNetworkElement').forEach((row,index) => Object.assign(row,
    networkDevicePresentation(row.classification,networkClasses,row.manufacturer,index,row.productName)));
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
      if (identityField(field) || /tenant_?id/i.test(fromColumn) || ['projectId', 'refParentSubnet', 'parentOltResId'].includes(fromColumn)) continue;
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
  // Components inherit ownership through their actual parent, including PON
  // parents whose site/tenant was normalized to the OLT above.
  const parentColumns = new Set(['parentResId', 'refParentNE', 'neResId', 'cardResId', 'portResId', 'accessDeviceId']);
  for (let pass = 0; pass < 3; pass++) for (const group of groups.values()) {
    if (!parentColumns.has(group.column)) continue;
    rows.get(group.table).forEach((row,index) => {
      const target = group.targets[index % group.targets.length];
      const parent = rows.get(target.table)[index];
      const tenant = parent.tenantId ?? parent.TENANT_ID;
      if (tenant !== undefined && 'tenantId' in row) row.tenantId = tenant;
      if (parent.projectId !== undefined) for (const column of ['projectId','refParentSubnet','siteId']) {
        if (column in row) row[column] = parent.projectId;
      }
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
        if ('projectId' in row) row.projectId = onu.projectId;
      } else {
        row.resId = owner.id ?? owner.resId ?? owner.diskId ?? id(ownerTable, index);
        if ('tenantId' in row) row.tenantId = owner.tenantId ?? id('X_TENANT_VIEW', tenants.assignments[index % resources]);
        if ('parentId' in row) row.parentId = ['NetworkApRadioKPI', 'NetworkApRadioSsidKPI'].includes(table)
          ? rows.get('I_EntNetworkElement')[index].id
          : owner.refParentNE ?? owner.parentResId ?? owner.id ?? row.resId;
      }
      if ('projectId' in row && table !== 'PonDeviceOnuKPI') row.projectId = owner.projectId ?? row.projectId;
      if ('deviceName' in row) row.deviceName = owner.name;
      if ('classification' in row) row.classification = owner.classification;
    });
    if (table === 'PonDeviceOnuKPI') rows.set(table, rows.get(table).filter((row, index, all) => all.findIndex(other => other.resId === row.resId) === index));
  }
  const seriesGaps = [];
  if (storageGapHours) rows.get('StorageDeviceKPI').forEach((row, index) => {
    if (index < resources && [2, 11].includes(index)) seriesGaps.push({
      table: 'StorageDeviceKPI', resId: row.resId,
      endExclusive: iso(anchorMs - storageGapHours * 3600000),
    });
  });
  const gapEnds = new Map(seriesGaps.map(gap => [gap.resId, Date.parse(gap.endExclusive)]));
  const alarmTemplates = rows.get('T_CURRENT_ALARM');
  const alarms = [];
  const startMs = anchorMs - days * 86400000;
  for (let day = Math.floor(startMs / 86400000) * 86400000, dayIndex = 0; day < anchorMs; day += 86400000, dayIndex++) {
    const begin = Math.max(startMs, day);
    const end = Math.min(anchorMs, day + 86400000);
    const weekday = ![0, 6].includes(new Date(day).getUTCDay());
    const volume = resources * alarmsPerResourcePerDay;
    const count = Math.max(6, Math.round(volume * (weekday ? 1.1 : 0.8)
      * (1 + 0.18 * Math.sin(dayIndex * 0.8) + (dayIndex % 13 === 4 ? 0.35 : 0))));
    for (let slot = 0; slot < count; slot++) {
      const row = { ...alarmTemplates[slot % alarmTemplates.length] };
      const index = (Math.floor(slot / 6) + dayIndex * 5) % resources;
      const eventIndex = alarms.length;
      const family = ['I_EntNetworkElement', 'PhysicalServer', 'HuaweiStorageDevice', 'I_EntPonElement', 'FCSwitchDevice', 'I_EntCollaborationElement'][slot % 6];
      const owner = rows.get(family)[index];
      row.MEDN = owner.id;
      row.TENANTID = owner.tenantId;
      row.STREXT13 = owner.projectId ?? id('X_SITE_VIEW', index);
      row.MENAME = owner.name;
      row.MANUFACTURER = owner.manufacturer ?? '';
      row.PRODUCTNAME = owner.productName ?? owner.productmodel ?? '';
      row.MECATEGORY = owner.classification ?? '';
      row.TENANT = rows.get('X_TENANT_VIEW').find(tenant => tenant.TENANT_ID === owner.tenantId)?.TENANT_NAME ?? '';
      row.CSN = eventIndex + 1;
      // critical / major / minor / warning: 1 / 1.8 / 3.2 / 4.
      const severity = categoryRandom(seed, 'T_CURRENT_ALARM', eventIndex, 'SEVERITY');
      row.SEVERITY = severity < 0.10 ? 1 : severity < 0.28 ? 2 : severity < 0.60 ? 3 : 4;
      const recent = dayIndex >= days - 2;
      row.ACKED = (slot + dayIndex) % 5 === 0 ? 0 : 1;
      row.CLEARED = (slot + dayIndex) % (recent ? 3 : 13) === 0 ? 0 : 1;
      row.ALARMNAME = ['CPU 利用率过高', '内存使用率过高', '链路质量下降', '设备短时离线', '设备温度过高', '端口错误率升高'][Math.floor(slot / 6) % 6];
      row.LOCATION = owner.projectId ?? owner.name;
      const duration = Math.min(120000, Math.max(0, end - begin - 1));
      const occur = Math.max(startMs, Math.min((gapEnds.get(owner.id) ?? anchorMs) - duration - 1,
        Math.floor(begin + (slot + 0.2 + random() * 0.6) / count * Math.max(1, end - begin - duration))));
      for (const column of ['OCCURUTC', 'OCCURTIME', 'LATESTOCCURUTC', 'LATESTOCCURTIME']) row[column] = occur;
      row.ARRIVEUTC = occur + Math.min(1000, duration);
      row.ACKUTC = row.ACKED ? occur + Math.floor(duration / 2) : 0;
      row.CLEARUTC = row.CLEARED ? occur + duration : 0;
      row.CLEARTIME = row.CLEARUTC;
      row.ENDUTC = row.CLEARUTC;
      row.COMMENTUTC = row.ACKUTC;
      alarms.push(row);
    }
  }
  rows.set('T_CURRENT_ALARM', alarms);
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
          if (metric && table === 'StorageDeviceKPI' && startMs + sample * interval >= (gapEnds.get(base.resId) ?? anchorMs)) continue;
          const row = { ...base };
          if (metric) {
            row.ts = iso(startMs + sample * interval);
            for (const field of dataset.fields) if (metricColumns.has(field.column)) {
              let number = metricValue(table, field.column, index, sample, interval, random, samples, startMs, waves);
              if (field.scalar === 'Int') number = Math.round(number);
              if (field.scalar === 'Float') number = Number(number.toFixed(3));
              if (field.scalar === 'Int' || field.scalar === 'Float') row[field.column] = number;
            }
          }
          if (table === 'ServerDeviceKPI') row.peakPower = Math.max(row.peakPower, Number((Math.max(row.averagePower*1.12,row.systemPower*1.05)).toFixed(3)));
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
    for (const [table, dataset] of tables) if (dataset.fields.some(field => field.column === 'ts')) {
      index(table, ['ts']);
      for (const owner of ['resId', 'parentId']) if (dataset.fields.some(field => field.column === owner)) index(table, [owner, 'ts']);
    }
    db.exec('COMMIT; ANALYZE');
    const checks = validate(db, model, counts, { anchor, start: iso(startMs) });
    if (checks.integrity !== 'ok' || checks.emptyTables.length || checks.emptyCarriers.length || checks.invalidTimes.length || checks.invalidEnums.length || checks.missingCpuSeries.length || checks.alarmsWithoutCpuSamples.length || checks.invalidMetricScenarios.length || checks.invalidAlarmTimes.length || checks.missingAlarmDays.length) throw new Error(`Validation failed: ${JSON.stringify(checks)}`);
    const alarmDays = db.prepare("SELECT date(OCCURUTC / 1000,'unixepoch') day, count(*) alarms, sum(SEVERITY='1') critical, sum(CLEARED=0) uncleared FROM T_CURRENT_ALARM GROUP BY day ORDER BY day").all();
    db.close();
    db = undefined;
    const manifest = {
      format: 'icloud-synthetic-data/v1', revision: model.revision,
      options: { seed, resources, days, intervalMinutes, anchor: inputAnchor, storageGapHours, alarmsPerResourcePerDay },
      generation: { revision: 6, devicePresentationProfile: 'canonical-device-class/v1', waveformProfile: 'business-envelope-seeded-jitter/v1', waveformSha256: hash(readFileSync(new URL('./kpi-waveforms.mjs', import.meta.url))), categoryProfile: 'seeded-weighted-categories/v1', tenantDistribution: { tenants: tenants.count, tiers: tenants.tiers }, alarmSeverityWeights: { critical: 1, major: 1.8, minor: 3.2, warning: 4 }, profile: 'daily-business-demo', seriesGaps, alarmDays, metricBusinessUtcOffsetHours: 8 },
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
        'Server-to-tenant source relations declare reversed cardinalities; shared tenants expose these exceptions without changing the model.',
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

export function validate(db, model, counts, { anchor, start } = {}) {
  const checks = { integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    emptyTables: [], emptyCarriers: [], invalidTimes: [], invalidEnums: [], relations: [],
    missingCpuSeries: [], alarmsWithoutCpuSamples: [], unsupportedAlarmCpuResources: [],
    invalidMetricScenarios: [], invalidAlarmTimes: [], missingAlarmDays: [] };
  if (start && anchor) {
    const present = new Set(db.prepare("SELECT DISTINCT date(OCCURUTC / 1000,'unixepoch') day FROM T_CURRENT_ALARM").all().map(row => row.day));
    for (let day = Math.floor(Date.parse(start) / 86400000) * 86400000; day < Date.parse(anchor); day += 86400000) {
      if (!present.has(iso(day).slice(0, 10))) checks.missingAlarmDays.push(iso(day).slice(0, 10));
    }
  }
  for (const [table, predicate] of [
    ['ServerDeviceKPI', 'peakPower < averagePower OR systemPower < 0 OR averagePower < 0'],
    ['StorageHardDriveKPI', 'utility < 0 OR utility > 100 OR avgreadiosize < 0 OR avgwriteiosize < 0'],
    ['StorageDeviceKPI', 'cpuusage < 0 OR cpuusage > 100 OR memoryusage < 0 OR memoryusage > 100'],
    ['NetworkDeviceKPI', 'portUsedCount < 0 OR portUsedCount > portCount OR operStatusCount > portCount OR cpuUsage < 0 OR cpuUsage > 100'],
  ]) {
    const invalid = db.prepare(`SELECT count(*) n FROM ${quote(table)} WHERE ${predicate}`).get().n;
    if (invalid) checks.invalidMetricScenarios.push({ table, invalid });
  }
  const invalidAlarms = db.prepare(`SELECT CSN FROM T_CURRENT_ALARM WHERE ARRIVEUTC < OCCURUTC
    OR (ACKED=1 AND ACKUTC < OCCURUTC) OR (CLEARED=1 AND CLEARUTC < OCCURUTC)
    OR (ACKED=0 AND ACKUTC != 0) OR (CLEARED=0 AND CLEARUTC != 0)
    ${anchor ? 'OR max(OCCURUTC, ARRIVEUTC, LATESTOCCURUTC, ACKUTC, CLEARUTC) >= ?' : ''}
    ${start ? 'OR OCCURUTC < ?' : ''}`)
    .all(...(anchor ? [Date.parse(anchor)] : []), ...(start ? [Date.parse(start)] : []));
  checks.invalidAlarmTimes.push(...invalidAlarms.map(row => row.CSN));
  const cpuSources = {
    I_EntNetworkElement: 'NetworkDeviceKPI', PhysicalServer: 'ServerDeviceKPI',
    HuaweiStorageDevice: 'StorageDeviceKPI', FCSwitchDevice: 'StorageDeviceKPI', I_EntPonElement: 'PonDeviceKPI',
  };
  for (const [resource, metric] of Object.entries(cpuSources)) {
    const missing = db.prepare(`SELECT r.id FROM ${quote(resource)} r WHERE NOT EXISTS (SELECT 1 FROM ${quote(metric)} k WHERE k.resId=r.id)`).all();
    checks.missingCpuSeries.push(...missing.map(row => ({ resource, id: row.id, metric })));
    const missingAlarms = db.prepare(`SELECT a.CSN, a.MEDN FROM T_CURRENT_ALARM a JOIN ${quote(resource)} r ON a.MEDN=r.id
      WHERE NOT EXISTS (SELECT 1 FROM ${quote(metric)} k WHERE k.resId=r.id AND k.ts >= strftime('%Y-%m-%dT00:00:00.000Z', a.OCCURUTC / 1000, 'unixepoch')
        AND k.ts < strftime('%Y-%m-%dT00:00:00.000Z', a.OCCURUTC / 1000, 'unixepoch', '+1 day'))`).all();
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
        : `length(${column}) != 24 OR substr(${column},11,1) != 'T' OR substr(${column},20,1) != '.' OR substr(${column},21,3) GLOB '*[^0-9]*' OR substr(${column},24,1) != 'Z' OR datetime(${column}) IS NULL`;
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
    'storage-gap-hours': { type: 'string', default: '0' },
    'alarms-per-resource-per-day': { type: 'string', default: '2' },
    'anchor-utc': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/generate-icloud-data.mjs [--output DIR] [--seed N] [--resources N>=6]\n  [--days N] [--interval-minutes N] [--storage-gap-hours N] [--alarms-per-resource-per-day N]\n  [--anchor-utc YYYY-MM-DDTHH:MM:SSZ]\nRequires Node.js 22.13+; reads the static JSON generation contract. Creates icloud.sqlite, manifest.json and model.json.\nExisting output directories are preserved. Default: 12 resources/table, 32 days, hourly samples, alarms every day.');
  } else {
    const manifest = generate({ output: resolve(values.output), seed: Number(values.seed), resources: Number(values.resources),
      days: Number(values.days), intervalMinutes: Number(values['interval-minutes']), storageGapHours: Number(values['storage-gap-hours']),
      alarmsPerResourcePerDay: Number(values['alarms-per-resource-per-day']),
      anchor: values['anchor-utc'] ?? iso(Math.floor(Date.now() / 60000) * 60000) });
    console.log(JSON.stringify({ output: resolve(values.output), tables: Object.keys(manifest.tables).length,
      rows: Object.values(manifest.tables).reduce((sum, count) => sum + count, 0),
      relationsCovered: manifest.checks.relations.filter(relation => relation.pairs > 0).length,
      cardinalityExceptions: manifest.checks.relations.filter(relation => relation.upperBoundExceeded).length }));
  }
}
