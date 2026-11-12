import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const queries=JSON.parse(readFileSync(process.argv[2],'utf8'));
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE devices(id TEXT,classification TEXT,priority INTEGER);
INSERT INTO devices VALUES ('a','olt',2),('b','ne.category.olt',1),('c','onu',2),('d','future-kind',1),('e',NULL,1);`);
const run=i=>db.prepare(queries[i].sql).all(...queries[i].bindings).map(row=>({...row}));
assert.deepEqual(run(0),[
 {a_id:'a',a_kind:'Olt'},{a_id:'b',a_kind:'Olt'},{a_id:'c',a_kind:'Onu'},
 {a_id:'d',a_kind:'Unknown'},{a_id:'e',a_kind:null}
]);
assert.deepEqual(run(1),run(0).slice(0,2));
assert.deepEqual(run(2),[{a_id:'d',a_kind:'Unknown'}]);
assert.deepEqual(run(3),run(1));
assert.deepEqual(run(4).map(row=>row.a_id),['b','d','e','a','c']);
assert(queries[1].bindings.includes('olt')&&queries[1].bindings.includes('ne.category.olt'));
assert(!queries[1].bindings.includes('!unmapped:kind'));
assert.match(queries[1].sql,/WHERE/);
assert.match(queries[5].sql,/WHERE/);
assert(queries[5].bindings.includes('olt')&&queries[5].bindings.includes('ne.category.olt'));
assert.deepEqual(run(6),[{id:'a',kind:'Olt'},{id:'b',kind:'Olt'}]);
assert.deepEqual(run(7),[{id:'d',kind:'Unknown'}]);
assert.deepEqual(run(8),[{id:'c',kind:'Onu'},{id:'d',kind:'Unknown'}]);
assert.deepEqual(run(9),[{id:'a',kind:'Olt'},{id:'b',kind:'Olt'},{id:'c',kind:'Onu'}]);
assert.match(queries[6].sql,/ IN \(/);
assert.match(queries[5].sql,/ IN \(/);
const membershipWhere=queries[6].sql.split('WHERE')[1];
assert(membershipWhere.includes('classification'));
assert(!membershipWhere.split(') AS __q_result')[0].includes('CASE'),'membership must filter the source, not its CASE projection');
db.close();
console.log('Mapped scopes: multi-wire source filtering, parallel projection, Unknown/NULL separation, and explicit business order passed; PostgreSQL lowering produced both wires');
