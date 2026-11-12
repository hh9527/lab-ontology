import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const cases=JSON.parse(readFileSync(process.argv[2]??0,'utf8'));
const db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE samples(id INTEGER,ts TEXT,epoch INTEGER,value REAL)');
const samples=[['2026-05-01T01:00:00Z',20],['2026-05-01T23:00:00Z',40],['2026-05-02T00:00:00Z',80],['2026-01-01T00:00:00Z',10],['2025-12-31T23:59:59Z',50],['1969-12-31T23:59:59.999Z',5],['1969-12-31T23:59:58.999Z',15],['2024-02-29T23:59:59.123Z',25],['2026-05-01T00:00:00.999Z',35]];
const insert=db.prepare('INSERT INTO samples VALUES(?,?,?,?)');
for(const [i,[ts,value]]of samples.entries())insert.run(i,new Date(ts).toISOString(),Date.parse(ts),value);
insert.run(samples.length,'2026-05-03T00:00:00.000Z',null,7);
const rows=db.prepare('SELECT ts,epoch,value FROM samples').all();
const {utcBucket,calendarBucket,registerCalendarSqlite}=await import('../../dari/src/calendar.ts');
registerCalendarSqlite(db);
for(const {mode,encoding,unit,result,intent_json}of cases)for(const zone of mode==='region'?['Asia/Shanghai','America/New_York','America/Havana','Australia/Lord_Howe','Asia/Kathmandu']:['UTC']){
 assert.match(result.sql,/GROUP BY/);
 assert.equal(result.receipt.inputDigest,createHash('sha256').update(intent_json).digest('hex'));
 assert.deepEqual(result.receipt.consumedStepIds,JSON.parse(intent_json).steps.map(s=>s.id));
 assert.equal(result.columns[0].logical,'DateTimeUtc');
 const groups=new Map();for(const row of rows){const instant=encoding==='epoch'?(row.epoch===null?null:new Date(row.epoch).toISOString()):row.ts;const bucket=unit==='Identity'?instant:mode==='region'?calendarBucket(instant,unit,zone):utcBucket(instant,unit);const values=groups.get(bucket)??[];values.push(row.value);groups.set(bucket,values);}
 const expected=[...groups].sort(([a],[b])=>a===null?(b===null?0:-1):b===null?1:a.localeCompare(b)).map(([bucket,values])=>({bucket,mean:values.reduce((a,b)=>a+b,0)/values.length}));
 const parameters=[];const sql=result.sql.replace(/:__dari_0/g,()=>{parameters.push(zone);return '?';});
 assert.deepEqual(db.prepare(sql).all(...parameters,...result.bindings).map(row=>({...row})),expected.slice(0,10));
 assert.equal(result.max_rows,10);
}
db.close();console.log('Model UTC bucket: explicit EpochMillis conversions and five units lowered to SQL grouping with parameterized region timezones and matching local semantics, aggregate results, Schema and original-intent receipts passed');
