import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const [artifact, adapter] = process.argv.slice(2);
assert(artifact && adapter, 'Usage: node scripts/check-icloud-finite-group-bounds.mjs <model.wasm> <telora-model.ts>');
const url = pathToFileURL(resolve(adapter));
const requireAdapter = createRequire(url);
const core = Object.keys(requireAdapter('../package.json').dependencies).find(name => name.endsWith('/dari-core'));
const {check} = await import(pathToFileURL(requireAdapter.resolve(core)));
const {openModel} = await import(url);
const host = await openModel(artifact);
const db = new DatabaseSync(':memory:');
try {
  function plan(dataset, projection, suffix = '') {
    const program = check(`data groups = query_remote! {
      let a = from(ic::${dataset});
      let rows = a |> project({${projection}});
      rows ${suffix}
    }; answer tree! { Answer [Table(data = groups)] };`, host.model);
    const binding = program.bindings.get('groups');
    return host.bind(binding.modelPlan, []);
  }
  assert.equal(plan('current_alarm', 'label: a.alarm_severity, n: a.alarm_count').max_rows, 4);
  assert.equal(plan('current_alarm', 'label: a.alarm_severity, cleared: a.alarm_cleared, n: a.alarm_count').max_rows, 8);
  assert.equal(plan('current_alarm', 'label: a.alarm_severity, n: a.alarm_count',
    '|> order_by(desc(rows.n)) |> take(50)').max_rows, 4);
  assert.throws(() => plan('current_alarm', 'label: a.alarm_name, n: a.alarm_count'), /proven result bound/);

  db.exec(`CREATE TABLE EntPonElement(id TEXT, commuState TEXT);
    INSERT INTO EntPonElement VALUES ('a','0'),('b','2'),('c','1');`);
  const bound = plan('pon_device', 'label: a.pon_commu_state, n: a.pon_device_count');
  assert.equal(bound.max_rows, 2);
  const rows = db.prepare(bound.sql).all(...bound.bindings).map(row => ({...row}));
  assert.deepEqual(rows.sort((a, b) => b.n - a.n), [
    {label: 'Offline', n: 2}, {label: 'Online', n: 1},
  ]);
  console.log('Finite groups: four severity groups, multi-key bounds, explicit take, open strings and enum aliases passed');
} finally {
  db.close();
  await host.close();
}
