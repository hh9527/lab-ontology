import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {openModel} from './model-bridge.ts';

const host=await openModel(process.argv[2]);
const db=new DatabaseSync(':memory:');
try {
 db.exec("CREATE TABLE I_EnterpriseFrame(name TEXT,refParentNE TEXT);CREATE TABLE I_EntNetworkElement(id TEXT,name TEXT);INSERT INTO I_EnterpriseFrame VALUES('linked','d1'),('missing',NULL);INSERT INTO I_EntNetworkElement VALUES('d1','device one')");
 const relation='ic::relations::frame_belongs_to_device';
 const optional=(condition:string,projection='d.device_name')=>`data rows=query_remote! {
  let linked=from(ic::frame).as!(f) |> connect(${relation}).as!(d);
  let output=linked |> filter(${condition}) |> project({frame:f.frame_name,device:${projection}}).as!(out);
  output |> order_by(asc(output.frame)) |> take(10)
 };answer tree! {Answer [Table(data=rows)]};`;
 assert.deepEqual(resolve(check(optional('is_some(d.device_name)'),host.model),db).values.rows,[{frame:'linked',device:'device one'}]);
 assert.deepEqual(resolve(check(optional('is_none(d.device_name)'),host.model),db).values.rows,[{frame:'missing',device:null}]);
 assert.deepEqual(resolve(check(optional('(d.device_name == "device one").unwrap_or!(True)'),host.model),db).values.rows,[{frame:'linked',device:'device one'},{frame:'missing',device:null}]);
 assert.throws(()=>check(optional('d.device_name == "device one"'),host.model),/Option\(Bool\)/);
 const required=check(optional('is_some(d.device_name)','not_none(d.device_name)'),host.model);
 assert.match(show(required.bindings.get('rows')!.type),/device: String/);
 assert.throws(()=>check(optional('is_some(f.frame_name)'),host.model),/optional dimension/);

 db.exec("CREATE TABLE I_EntPonElement(id TEXT,name TEXT,parentOltResId TEXT);INSERT INTO I_EntPonElement VALUES('p','parent','none'),('c1','child one','p'),('c2','child two','p')");
 const self='ic::relations::source_EntPonElementAssociationEntPonElement';
 const parentSource=`data rows=query_remote! {
  let child=from(ic::pon_device).as!(child);
  let parent=from(ic::pon_device);
  let linked=child |> connect(${self},parent,child);
  let output=linked |> project({child:child.pon_name,parent:parent.pon_name}).as!(out);
  output |> order_by(asc(output.child)) |> take(10)
 };answer tree! {Answer [Table(data=rows)]};`;
 const parents=resolve(check(parentSource,host.model),db).values.rows;
 assert.deepEqual(parents,[{child:'child one',parent:'parent'},{child:'child two',parent:'parent'},{child:'parent',parent:null}]);
 const namedParent=parentSource.replace('connect('+self+',parent,child);','connect('+self+',parent,child).as!(peer);').replace('parent:parent.pon_name','parent:peer.pon_name');
 assert.deepEqual(resolve(check(namedParent,host.model),db).values.rows,parents);
 const childrenSource=parentSource.replace('let linked=child |>','let linked=parent |>');
 assert.throws(()=>check(childrenSource,host.model),/multiplying relation/);
 assert.throws(()=>check(parentSource.replace(`connect(${self},parent,child)`,`connect(${self}).as!(peer)`),host.model),/Self Relation.*connect\(Relation, from_node, to_node\)/);

 const local=(body:string)=>check('data left_data=table([{id:"a",name:"A",rank:2},{id:"b",name:"B",rank:2},{id:"c",name:"C",rank:1}]);data right_data=table([{id:"b"},{id:"b"}]);data rows=query! {'+body+'};answer tree! {Answer [Table(data=rows)]};');
 const overlap=local('let a=from(left_data);let b=from(right_data);let kept=a |> semi_join(b, a.id==b.id);let output=kept |> project({id:a.id,name:a.name,rank:a.rank}).as!(out);output |> order_by(desc(output.rank),asc(output.name)) |> take(10)');
 assert.deepEqual(resolve(overlap,db).values.rows,[{id:'b',name:'B',rank:2}]);
 const sorted=local('let a=from(left_data);let output=a |> project({id:a.id,name:a.name,rank:a.rank}).as!(out);output |> order_by(desc(output.rank),asc(output.name)) |> take(10)');
 assert.deepEqual(resolve(sorted,db).values.rows.map((r:any)=>r.id),['a','b','c']);
 assert.throws(()=>local('let kept=semi_join({a:left_data,b:right_data},a.id==b.id);kept |> project({id:a.id}).as!(out)'),/requires a pipeline input/);
 assert.throws(()=>local('let kept=left_data |> intersect(right_data);kept'),/Unknown relation binding[\s\S]*from\(data_a\)/);
 assert.throws(()=>local('let rows=from(left_data);rows |> project({name:rows.name}).as!(out) |> distinct() |> order_by(asc(rows.name)) |> take(10)'),/not an input[\s\S]*let output/);

 const unbounded='type Row=Schema({id:String});data raw:Table(Row)=source("raw");data unbounded=query! {let a=from(raw);a |> project({id:a.id}).as!(out)};';
 assert.doesNotThrow(()=>check(unbounded+'answer tree! {Answer []};',undefined,{allowTestSources:true}));
 assert.throws(()=>check(unbounded+'answer tree! {Answer [Table(data=unbounded)]};',undefined,{allowTestSources:true}),/proven bound|requires a proven|110/);
 assert.doesNotThrow(()=>check(unbounded+'data limited=query! {let a=from(unbounded);a |> order_by(asc(a.id)) |> take(5)};answer tree! {Answer []};',undefined,{allowTestSources:true}));
 assert.doesNotThrow(()=>check('type Row=Schema({id:String});data raw:Table(Row)=source("raw");data rows=query! {let a=from(raw);let selected=a |> project({id:a.id}).as!(out);selected |> order_by(asc(selected.id)) |> take(5)};answer tree! {Answer []};',undefined,{allowTestSources:true}));
 assert.throws(()=>check('data unbounded=query_remote! {let f=from(ic::frame);f |> project({name:f.frame_name}).as!(out)};answer tree! {Answer []};',host.model),/Remote query data node requires a proven result bound/);
 const many=Array.from({length:120},(_,n)=>'{key:0,n:'+n+'}').join(',');
 const composed=check('data a=table(['+many+']);data b=table(['+many+']);data joined=query! {let l=from(a);let r=from(b);let j=l |> join(r, l.key==r.key);j |> project({left:l.n,right:r.n}).as!(out)};data summary=query! {let j=from(joined);j |> project({n:count()}).as!(out)};answer tree! {Answer [Table(data=summary)]};');
 const counted=resolve(composed,db);
 assert.deepEqual(counted.values.summary,[{n:14400}]);
 assert(!Object.hasOwn(counted.values,'joined'));
 const presentation=(size:number,component='Table')=>'data rows=table(['+Array.from({length:size},(_,id)=>'{name:"row",n:'+id+'}').join(',')+']);answer tree! {Answer ['+component+'(data=rows'+(component==='Table'?'':',spec={category:$.name,value:$.n}')+')]};';
 assert.doesNotThrow(()=>check(presentation(110)));
 assert.throws(()=>check(presentation(111)),/proven bound <= 110/);
 const {dariHost}=await import('../../dsh-oks/packages/dsh-oks/src/dari-host.ts');
 assert.doesNotThrow(()=>check(presentation(110,'BarChart'),undefined,{host:dariHost}));
 assert.throws(()=>check(presentation(111,'BarChart'),undefined,{host:dariHost}),/proven bound <= 110/);
 const intermediate=local('let a=from(left_data);let b=from(right_data);let kept=a |> join(b, a.id==b.id);let output=kept |> project({id:a.id}).as!(out);output |> order_by(asc(output.id)) |> take(10)');
 assert.deepEqual(resolve(intermediate,db).values.rows,[{id:'b'},{id:'b'}]);
 console.log('Relation usability: optional-context predicates, self-relation directions, multi-key sorting, identity semi-join, diagnostics remote bound, local SQL composition and 110-row presentation bounds passed');
} finally {db.close();await host.close();}
