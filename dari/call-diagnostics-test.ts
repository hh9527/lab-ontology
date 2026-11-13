import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {DiagnosticFailure} from './src/diagnostics.ts';
const source=`data ports:Table(Schema({device:Option(String),port:String}))=source("ports");
data labeled=query! {
 let rows=from(ports);
 let output=rows |> project({
  label:concat(unwrap_or!(rows.device,"未登记设备")," / ",unwrap_or!(rows.port,"未命名端口")),
  device:unwrap_or!(rows.device,"未登记设备"),
  port:rows.port.unwrap_or!("未命名端口")
 });
 output |> order_by(asc(output.port)) |> take(10)
};answer tree! {Answer [Table(data=labeled)]};`;
try{check(source,undefined,{allowTestSources:true});assert.fail('Expected failure');}catch(e){
 assert(e instanceof DiagnosticFailure);
 assert.equal(e.diagnostics.length,2);
 for(const d of e.diagnostics){
  assert.equal(d.expression,'unwrap_or!(rows.port, "未命名端口")');
  assert.match(d.reason!,/rows.port: String/);
  assert.match(d.suggestion!,/仅将此调用替换为 rows.port/);
  assert(!d.expression.includes('device'));
 }
 assert.match(e.message,/表达式：unwrap_or!\(rows.port/);
 assert(!e.message.includes('@local/'));assert(!e.message.includes('r0.port'));
 assert.equal(source.slice(e.diagnostics[0].at,e.diagnostics[0].at+10),'unwrap_or!');
}
const fixed=source.replace('unwrap_or!(rows.port,"未命名端口")','rows.port').replace('rows.port.unwrap_or!("未命名端口")','rows.port');
const p=check(fixed,undefined,{allowTestSources:true});
assert.equal(show(p.bindings.get('labeled')!.type),'Table(Schema({label: String, device: String, port: String}))');
const db=new DatabaseSync(':memory:');
try{db.exec('CREATE TABLE ports(device TEXT,port TEXT);INSERT INTO ports VALUES(NULL,\'PON-1\')');assert.deepEqual(resolve(p,db).values.labeled,[{label:'未登记设备 / PON-1',device:'未登记设备',port:'PON-1'}]);}finally{db.close();}
console.log('Call diagnostics: precise prefix/postfix targets, independent findings and preserved optional defaults passed');
