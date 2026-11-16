// 生成夹具与验收共享的有限关系条件；字段始终属于显式的一端。
export function guardLeaves(guard, side = 'from') {
  if (!guard) return [];
  if (guard.to) return guardLeaves(guard.to, 'to');
  if (guard.all || guard.any) return (guard.all ?? guard.any).flatMap(g => guardLeaves(g, side));
  if (!['Eq', 'Ne'].includes(guard.op)) throw Error('Unsupported NS guard operation ' + guard.op);
  const entries = Object.entries(guard.input);
  if (entries.length !== 1) throw Error('Invalid NS guard literal');
  return [{ side, field: guard.field, op: guard.op, value: entries[0][1] }];
}
export function guardSql(model, relation, quote) {
  const values = [];
  function render(guard, side = 'from') {
    if (!guard) return '';
    if (guard.to) return render(guard.to, 'to');
    if (guard.all || guard.any) {
      const parts = guard.all ?? guard.any;
      if (!parts.length) throw Error('Empty NS guard group');
      return '(' + parts.map(g => render(g, side)).join(guard.all ? ' AND ' : ' OR ') + ')';
    }
    const leaf = guardLeaves(guard, side)[0];
    const dataset = model.datasets.find(d => d.id === relation[side]);
    const field = dataset.fields.find(f => f.name === leaf.field);
    if (!field) throw Error('Unknown NS guard field ' + dataset.id + '/' + leaf.field);
    values.push(leaf.value);
    return `${side === 'from' ? 'a' : 'b'}.${quote(field.column)}${leaf.op === 'Eq' ? '=' : '<>'}?`;
  }
  return { sql: render(relation.guard), values };
}
