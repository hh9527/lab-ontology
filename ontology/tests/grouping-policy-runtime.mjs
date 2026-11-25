import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

// telora -C ontology eval @test/grouping_policy:runtime_cases > "$TMPDIR/grouping.json"
// node ontology/tests/grouping-policy-runtime.mjs "$TMPDIR/grouping.json"
const cases=JSON.parse(readFileSync(process.argv[2]??0,'utf8'));
const db=new DatabaseSync(':memory:');
try {
  db.exec(`CREATE TABLE samples(id TEXT,name TEXT,ts TEXT,value REAL);
    INSERT INTO samples VALUES ('a','Same','2026-01-01',10),('a','Same','2026-01-02',20),
      ('b','Same','2026-01-01',30),('b','Same','2026-01-02',40);
    CREATE TABLE owners(id TEXT,name TEXT,region TEXT);
    INSERT INTO owners VALUES ('t1','Owner',NULL),('t2','Owner',NULL);
    CREATE TABLE linked_samples(id TEXT,ts TEXT,owner TEXT,changing_owner TEXT,stable_flag INT,sample_flag INT);
    INSERT INTO linked_samples VALUES ('a','2026-01-01','t1',NULL,1,1),('a','2026-01-02','t1',NULL,1,0),
      ('b','2026-01-01','t2',NULL,1,1),('c','2026-01-01',NULL,NULL,1,1),('c','2026-01-02',NULL,NULL,1,1);`);
  const run=plan=>db.prepare(plan.sql).all(...plan.bindings).map(row=>({...row}));
  assert.deepEqual(run(cases.names),[{s_samples__name:'Same'},{s_samples__name:'Same'}],
    'Repeated records collapse, but equal labels on different identities stay separate');
  assert.deepEqual(run(cases.linked),[{o_owner_name:null},{o_owner_name:'Owner'},{o_owner_name:'Owner'}],
    'Optional relations preserve NULL and the grouped source identities');
  assert.deepEqual(run(cases.multiplied),[{o_owner_name:'Owner'},{o_owner_name:'Owner'}],
    'A multiplying join may qualify grouped identities without multiplying the result');
  assert.deepEqual(run(cases.protocol),[{label:'Same'},{label:'Same'}]);
  assert.equal(cases.protocol.max_rows,20);
  assert.equal(cases.protocol.container,'table');
  assert.deepEqual(cases.protocol.receipt.consumedStepIds,['s0','s1','s2','s3']);
  assert.match(cases.postgres.sql,/GROUP BY "s"\."name", "s"\."id"/);
  assert(!/GROUP BY[^)]*\bts\b/.test(cases.postgres.sql),'Sampling time must not refine the identity group');
  db.exec('DELETE FROM samples');
  assert.deepEqual(run(cases.names),[]);
  assert.deepEqual(run(cases.protocol),[],'An empty identity set must not invent an aggregate row');
} finally {db.close();}
console.log('Identity-only grouping: duplicate samples, equal labels, optional dependencies, fanout, empty input, public receipt and PostgreSQL lowering passed');
