// Static ontology knowledge builder. Execute with new Function('data', source).
'use strict';
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const json = value => JSON.stringify(canonical(value));
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const address = (root, id) => `${root}/${encode(id)}`;
const member = (dataset, kind, id) => `${address('datasets', dataset)}#${kind}/${encode(id)}`;
// Synchronous SHA-256 keeps the model program independent of host imports.
const constants = [], initial = [];
for (let n = 2; constants.length < 64; n++) {
  let prime = true;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
  if (prime) {
    if (initial.length < 8) initial.push((Math.sqrt(n) % 1 * 2 ** 32) | 0);
    constants.push((Math.cbrt(n) % 1 * 2 ** 32) | 0);
  }
}
const rotate = (x, n) => (x >>> n) | (x << (32 - n));
function sha256(text) {
  const bytes = new TextEncoder().encode(text), length = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(length); padded.set(bytes); padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(length - 8, Math.floor(bytes.length / 2 ** 29)); view.setUint32(length - 4, bytes.length * 8 >>> 0);
  const hash = [...initial], words = new Int32Array(64);
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15], b = words[i - 2];
      words[i] = words[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const t1 = h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[i] + words[i];
      const t2 = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      h = g; g = f; f = e; e = d + t1 | 0; d = c; c = b; b = a; a = t1 + t2 | 0;
    }
    for (const [i, value] of [a, b, c, d, e, f, g, h].entries()) hash[i] = hash[i] + value | 0;
  }
  return hash.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
}
function initialize(revision) { return { revision, facts: new Map(), types: new Map(), fieldTypes: new Map(), pendingTypes: [] }; }
function merge(state, key, value, references = []) {
  const previous = state.facts.get(key);
  if (previous) {
    Object.assign(previous.value, value);
    for (const ref of references) previous.references.add(ref);
  } else state.facts.set(key, { key, value, references: new Set(references) });
}
function typeref(state, id) {
  const info = state.fieldTypes.get(id);
  if (!info) throw new Error(`Unknown field type ${id}`);
  return info.text;
}
function typerefs(state, id) {
  const info = state.fieldTypes.get(id);
  if (!info) throw new Error(`Unknown field type ${id}`);
  return info.references;
}
const column = (s, c) => ({ ...c, type: typeref(s, c.type) });
function expression(s, e) {
  if (e.op === 'column') return { ...e, input: column(s, e.input) };
  if (e.op === 'identity') return { ...e, column: column(s, e.column), parts: e.parts.map(c => column(s, c)) };
  if (e.op === 'rate') return { ...e, amount: expression(s, e.amount), duration: expression(s, e.duration) };
  return { ...e, input: expression(s, e.input) };
}
function types(s, items) {
  for (const t of items) s.types.set(t.id, t);
  s.pendingTypes = items;
}
function field_types(s, items) {
  for (const info of items) s.fieldTypes.set(info.id, info);
  for (const t of s.pendingTypes) if (!t.inline) merge(s, address('types', t.id), {
    name: t.name, kind: t.kind, reverse_references: t.reverse_references === true, representation: t.representation === null ? null : typeref(s, t.representation),
    arguments: t.arguments.map(x => typeref(s, x)), field_types: t.field_types.map(c => column(s, c)),
    variants: t.variants.map(v => v.payload === null ? { ...v } : { ...v, payload: typeref(s, v.payload) }),
  }, t.dependencies.flatMap(x => typerefs(s, x)));
}
function binding(s, dataset, b) {
  const definition = { ...b.group };
  if (Object.hasOwn(definition, 'type')) definition.type = typeref(s, definition.type);
  if (Object.hasOwn(definition, 'entity')) definition.entity = address('entities', definition.entity);
  const group = address(b.group_kind, sha256(json(definition)));
  const key = member(dataset, 'bindings', json(Object.fromEntries(b.members.map(m => [m.local, m.publish]))));
  const refs = b.types.flatMap(x => typerefs(s, x));
  merge(s, group, definition, refs);
  merge(s, key, { group, members: b.members.map(m => ({ ...m, type: typeref(s, m.type), input: expression(s, m.input) })) }, [group, ...refs]);
  for (const m of b.members) merge(s, member(dataset, m.aggregate === null ? 'dimensions' : 'measures', m.publish),
    { binding: key, group, local: m.local, type: typeref(s, m.type) }, [key, group, ...typerefs(s, m.type)]);
}
function domain(s, dataset, b) {
  const definition = { ...b.definition, type: typeref(s, b.definition.type), wire: typeref(s, b.definition.wire) };
  const group = address('dimension_groups', sha256(json(definition))), key = member(dataset, 'bindings', json(['domain', b.id]));
  if (typerefs(s, b.definition.type).includes(typeref(s, b.definition.type))) {
    for (const v of b.definition.canonical_values) merge(s, `${typeref(s, b.definition.type)}#values/${encode(v.id)}`, { wires: v.wires }, typerefs(s, b.definition.type));
    merge(s, typeref(s, b.definition.type), { canonical_order: b.definition.order, half_open: b.definition.half_open, wire: typeref(s, b.definition.wire) }, typerefs(s, b.definition.wire));
  }
  merge(s, group, definition, [...typerefs(s, b.definition.type), ...typerefs(s, b.definition.wire)]);
  merge(s, key, { group, input: expression(s, b.input), publish: b.id, nullable: b.nullable, projectable: b.projectable, filters: b.filters }, [group]);
  merge(s, member(dataset, 'dimensions', b.id), { binding: key, group, type: typeref(s, b.definition.type) }, [key, group, ...typerefs(s, b.definition.type)]);
}
function sample(s, dataset, b) {
  const definition = { ...b.definition, type: typeref(s, b.definition.type) };
  const group = address('measure_groups', sha256(json(definition))), key = member(dataset, 'bindings', json(['sample', b.names]));
  const field = member(dataset, 'fields', b.field);
  merge(s, group, definition, typerefs(s, b.definition.type));
  merge(s, key, { group, field, nullable: b.nullable, names: b.names }, [group, field]);
  for (const n of b.names) merge(s, member(dataset, 'measures', n.publish),
    { binding: key, group, statistic: n.statistic, type: typeref(s, b.definition.type) }, [key, group, ...typerefs(s, b.definition.type)]);
}
function entity(s, r) {
  merge(s, address('entities', r.entity), { identity: typeref(s, r.identity) }, typerefs(s, r.identity));
}
function dataset(s, d) {
  merge(s, address('datasets', d.id), { source: d.source, row: typeref(s, d.row), grain: d.grain, kind: d.kind, scope: d.scope, clock: d.clock, references: d.references ?? [] }, typerefs(s, d.row));
  for (const r of d.roles) {
    merge(s, member(d.id, 'roles', r.id), { entity: address('entities', r.entity), identity: typeref(s, r.identity), optional: r.optional,
      parts: r.parts.map(p => ({ ...p, type: typeref(s, p.type), raw: p.raw === null ? null : typeref(s, p.raw) })) },
    [address('entities', r.entity), ...typerefs(s, r.identity), ...r.parts.flatMap(p => [...typerefs(s, p.type), ...(p.raw === null ? [] : typerefs(s, p.raw))])]);
  }
  for (const f of d.fields) {
    const { name, ...value } = f;
    merge(s, member(d.id, 'fields', name), column(s, value), typerefs(s, f.type));
    if (f.time !== null) merge(s, member(d.id, 'time_roles', name), { field: member(d.id, 'fields', name), encoding: f.time.encoding,
      semantics: f.time.semantics, authoritative: d.clock === name }, [member(d.id, 'fields', name)]);
  }
  for (const b of d.bindings) binding(s, d.id, b);
  for (const b of d.domains) domain(s, d.id, b);
  for (const b of d.samples) sample(s, d.id, b);
}
function relationkey(from, to, key) {
  return key.op === 'eq' ? { ...key, from: member(from, 'fields', key.from), to: member(to, 'fields', key.to) }
    : { ...key, inputs: key.inputs.map(k => relationkey(from, to, k)) };
}
function relationfields(from, to, key) {
  return key.op === 'eq' ? [member(from, 'fields', key.from), member(to, 'fields', key.to)] : key.inputs.flatMap(k => relationfields(from, to, k));
}
function capabilities(s, c) {
  for (const d of c.dimensions) {
    const { id, dataset, ...value } = d, field = member(dataset, 'fields', d.field);
    merge(s, member(dataset, 'dimensions', id), { ...value, field }, [field]);
  }
  for (const m of c.measures) {
    const { id, dataset, ...value } = m, field = member(dataset, 'fields', m.anchor_field);
    const requires = m.requires.map(x => address('datasets', x));
    merge(s, member(dataset, 'measures', id), { ...value, anchor_field: field, requires }, [field, ...requires,
      ...(m.computed === null ? [] : [member(dataset, 'measures', m.computed.left), member(dataset, 'measures', m.computed.right)])]);
  }
  for (const r of c.relations) merge(s, address('relations', r.id), { from_dataset: address('datasets', r.from_dataset), to_dataset: address('datasets', r.to_dataset),
    cardinality: r.cardinality, key: relationkey(r.from_dataset, r.to_dataset, r.key), guard: r.guard },
    [address('datasets', r.from_dataset), address('datasets', r.to_dataset), ...relationfields(r.from_dataset, r.to_dataset, r.key)]);
  for (const l of c.links) merge(s, member(l.hub, 'business_links', l.id), { hub: address('datasets', l.hub), participant: address('datasets', l.participant),
    a_relation: address('relations', l.a_relation), z_relation: address('relations', l.z_relation), direction: l.direction, guard: l.guard },
    [address('datasets', l.hub), address('datasets', l.participant), address('relations', l.a_relation), address('relations', l.z_relation)]);
}
const endpoint = p => member(p.dataset, 'roles', p.role);
function relations(s, r) {
  for (const v of r.relations) {
    const from = endpoint(v.from), to = endpoint(v.to);
    merge(s, address('relations', v.id), { from_role: from, to_role: to }, [from, to]);
  }
  for (const a of r.alternatives) {
    const choices = a.choices.map(c => ({ from: endpoint(c.from), to: endpoint(c.to) }));
    merge(s, address('relations', a.id), { alternatives: choices }, choices.flatMap(c => [c.from, c.to]));
  }
}
function finish(s) {
  const kinds = { entities: 'Entity', datasets: 'Dataset', dimension_groups: 'DimensionGroup', measure_groups: 'MeasureGroup', types: 'Ty', relations: 'Relation',
    bindings: 'Binding', roles: 'Role', fields: 'Field', dimensions: 'Dimension', measures: 'Measure', values: 'Value', time_roles: 'TimeRole', business_links: 'BusinessLink' };
  const facts = [...s.facts.values()].map(f => ({ key: f.key, value: f.value, references: [...f.references] }));
  const vocabulary = facts.map(f => {
    const [node, suffix] = f.key.split('#'), root = node.split('/'), part = suffix === undefined ? root : suffix.split('/');
    return { key: f.key, kind: kinds[part[0]], name: decodeURIComponent(part[1]), doc: '', aliases: [],
      owner: suffix === undefined ? null : root[0] === 'datasets' ? 'dataset' : 'ty', ownerValue: suffix === undefined ? null : decodeURIComponent(root[1]) };
  });
  return { graph: { knowledge_contract: 'ontology-knowledge-v4', intent_contract: 'ontology-intent-v1', addressing: 'node-member-uri-v1', revision: s.revision, facts, items: [] }, vocabulary };
}
if (!data || typeof data.revision !== 'string' || !data.revision || !Array.isArray(data.instructions)) {
  throw new Error('Invalid ontology knowledge instructions');
}
const operations = {types, field_types, entity, dataset, capabilities, relations};
const state = initialize(data.revision);
for (const [index, instruction] of data.instructions.entries()) {
  if (!Array.isArray(instruction) || instruction.length !== 2 || typeof instruction[0] !== 'string' || !Object.hasOwn(operations, instruction[0])) {
    throw new Error('Invalid ontology knowledge instruction');
  }
  const [operation, argument] = instruction;
  if ((index === 0) !== (operation === 'types')) throw new Error('Knowledge types must be declared first and once');
  if ((index === 1) !== (operation === 'field_types')) throw new Error('Field type information must be declared second and once');
  operations[operation](state, argument);
}
if (data.instructions.length < 2) throw new Error('Missing knowledge type declarations');
return finish(state);
