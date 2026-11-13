function readProjection(row:any,path:readonly string[]):any {
 let value=row;
 for(const segment of path){const unwrap=segment.endsWith('?'),key=unwrap?segment.slice(0,-1):segment;value=value[key];if(unwrap){if(value===null||value?.tag==='None')return null;if(value?.tag==='Some')value=value.value;}}
 return value;
}
import {calendarFunctions,utcBucket,calendarBucket,registerCalendarSqlite} from './calendar.ts';
import {formatValue} from './format.ts';
import {timeFunctions,epochMillis} from './time-values.ts';
import {timeType,sharedTypes} from './shared-types.ts';
import {inSubnet} from './ipv4.ts';
import {same,projectionType,type Program,type Type,type Plan} from './compiler.ts';
import type {Node} from './syntax.ts';
import {renderDiagnostics} from './diagnostics.ts';
import type {DatabaseSync} from 'node:sqlite';
import {storage,type PreparedQuery} from './model.ts';
import {createHash,randomUUID} from 'node:crypto';
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const display=(v:any):string=>v&&typeof v==='object'&&typeof v.tag==='string'?(Object.hasOwn(v,'value')?v.tag+'('+String(v.value)+')':v.tag):String(v??'无数据');
const html=(v:unknown)=>display(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const md=(v:unknown)=>display(v).replaceAll('|','\\|').replaceAll('\n',' ');
// The POC's report body is Markdown; support its own emitted headings and links.
const reportHtml=(text:string)=>text.split('\n\n').map(block=>{
 if(block.startsWith('# '))return '<h1>'+html(block.slice(2))+'</h1>';
 if(block.startsWith('## '))return '<h2>'+html(block.slice(3))+'</h2>';
 const image=/^!\[([A-Za-z_0-9]+)\]\(([A-Za-z_0-9]+\.svg)\)$/.exec(block);
 if(image)return '<img alt="'+image[1]+'" src="'+image[2]+'">';
 return '<pre style="white-space:pre-wrap">'+html(block)+'</pre>';
}).join('\n');
export function resolve(p:Program,db:DatabaseSync,inputs:Record<string,unknown>={},execution:{context?:unknown;contextContractId?:string}={}){
 if(p.model&&(p.model.contractId!==p.modelContractId||p.model.implementationId!==p.modelImplementationId))throw Error(renderDiagnostics(p.source,[{at:0,message:'Model contract changed; check the plan again',stage:'runtime',code:'stale-model-proof',reason:'当前模型身份或实现与检查时不同，已有查询证明不能复用',suggestion:'对同一稿件重新执行检查，再提交；不要修改业务口径或放宽类型'}],'SubmitFailed'));
 if(p.contextContractId!==execution.contextContractId)throw Error(renderDiagnostics(p.source,[{at:0,message:'Context contract changed; check the plan again',stage:'runtime',code:'stale-context-proof',reason:'当前 context 的类型契约与检查时不同',suggestion:'确认上下文契约后重新检查同一稿件，再提交'}],'SubmitFailed'));
 registerCalendarSqlite(db);
 db.function('dari_utc_bucket',{deterministic:true},(value:any,unit:any)=>utcBucket(value,unit));
 const patterns=new Map<string,RegExp>();
 db.function('regexp',{deterministic:true},(pattern:any,input:any)=>{
  if(pattern===null||input===null)return null;
  let regex=patterns.get(String(pattern));if(!regex){regex=new RegExp(String(pattern));patterns.set(String(pattern),regex);}
  return Number(regex.test(String(input)));
 });
 db.function('dari_in_subnet',{deterministic:true},(address:any,subnet:any)=>address===null||subnet===null?null:inSubnet(address,subnet));
 for(const [name,run] of Object.entries(timeFunctions))db.function('dari_'+name,{deterministic:true,varargs:true},(...args:any[])=>args.some(v=>v===null)?null:(run as (...args:any[])=>any)(...args));
 for(const [name,fn]of Object.entries(p.host?.functions??{}))if(fn.sql)db.function('dari_host_'+name,{deterministic:true,varargs:true},(...args:any[])=>fn.run(args.map((value,i)=>fn.sql!.jsonArgs?.includes(i)&&value!==null?JSON.parse(value):value)) as any);
 for(const [name,type]of Object.entries(sharedTypes))if(timeType(type)||['LocalDate','TimeZone'].includes(name))db.function('dari_parse_'+name,{deterministic:true},(v:any)=>type.codec!.parse(v) as any);
 let chartSerial=0;
 let dataScope='answer';
 const dataSections=new Map<string,string[]>(),includedReports=new Set<string>();
 const recordData=(key:string,text:string)=>{const parts=dataSections.get(dataScope)??[];parts.push('## '+dataScope+'/'+key+'\n\n'+text);dataSections.set(dataScope,parts);};
 const valueKeys=new Set<string>(),valueSections=new Map<string,string[]>();
 function recordValue(n:Node,text:unknown){const a=Object.fromEntries(n.attrs.map((f:Node)=>[f.name,f.value]));const key=a.ref.path.join('.');const full=dataScope+'/'+key;if(!valueKeys.has(full)){valueKeys.add(full);const lines=valueSections.get(dataScope)??[];lines.push('- '+key+': '+md(text));valueSections.set(dataScope,lines);}}

 const cache=new Map<string,any>();const artifacts:Record<string,string>={};let queries=0;
 const runId=randomUUID(),startedAt=new Date().toISOString();
 let scopes:Record<string,any>[]=[];
 let contextSnapshot:any;let contextLoaded=false;
 const acquisitions:{binding:string;sql:string;parameters:unknown[];startedAt:string;elapsedMillis:number;rowCount:number}[]=[];
 function execute(name:string,text:string,args:any[]){
  const startedAt=new Date().toISOString(),start=performance.now();queries++;
  const rows=db.prepare(text).all(...args);
  acquisitions.push({binding:name,sql:text,parameters:args,startedAt,elapsedMillis:performance.now()-start,rowCount:rows.length});
  return rows;
 }
 const prepared=new Map<string,PreparedQuery>();
 function expressionType(n:Node):Type|undefined {
  if(n.resolvedType)return n.resolvedType;
  if(n.k==='call')return p.types.get(n.name);
  if(n.k!=='ref')return;
  let t=p.bindings.get(n.path[0])?.type;
  for(const key of n.path.slice(1))t=t?.fields?.[key];
  return t;
 }
 function encodeValue(t:Type|undefined,v:any):any {
  if(v===null||!t)return v;
  if(t.kind==='option')return encodeValue(t.inner,v);
  return t.codec?t.codec.encode(v):typeof v==='boolean'?Number(v):v;
 }
 const operand=(n:Node)=>{const v=value(n);let t=expressionType(n);if(t?.kind==='option')t=t.inner;return t&&timeType(t)&&v!==null?epochMillis(v):t?.codec?.variants?encodeValue(t,v):v;};
 function convert(t:Type,v:any,mode:'parse'|'decode'):any {
  if(t.kind==='option')return v===null?null:convert(t.inner!,v,mode);
  if(t.codec)return t.codec[mode](v);
  if(t.kind==='nominal')return convert(t.inner!,v,mode);
  if(t.kind==='schema'){
   if(v===null||typeof v!=='object'||Array.isArray(v))throw Error('Expected Schema row');
   if(mode==='parse'&&Object.keys(v).some(key=>!Object.hasOwn(t.fields!,key)))throw Error('Input/context Schema contains undeclared fields; check its contract again');
   return Object.fromEntries(Object.entries(t.fields!).map(([key,field])=>[key,convert(field,v[key],mode)]));
  }
  if(mode==='decode'&&t.name==='Bool'&&(v===0||v===1))v=Boolean(v);
  if(!validate(t,v))throw Error('Value violates '+(t.name??t.kind));return v;
 }
 function validate(t:Type,v:any):boolean {if(t.kind==='option')return v===null||validate(t.inner!,v);if(t.kind==='nominal')return validate(t.inner!,v);if(t.kind==='schema')return v!==null&&typeof v==='object'&&Object.entries(t.fields!).every(([k,t])=>Object.hasOwn(v,k)&&validate(t,v[k]));if(t.name==='Int'||t.name==='EpochMillis')return Number.isSafeInteger(v);if(t.name==='Float')return typeof v==='number'&&Number.isFinite(v);if(t.name==='Bool')return typeof v==='boolean';if(t.name==='Rfc3339')return typeof v==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));return typeof v==='string';}
 function value(n:Node):any {
  if(n.calendarBucketUnit)return calendarBucket(value(n.args[0]),n.calendarBucketUnit,value(n.args[2]));
  if(n.utcBucketUnit)return utcBucket(value(n.args[0]),n.utcBucketUnit);
  if(n.calendarFunction)return calendarFunctions[n.name].run(n.args.map(value));
  if(n.k==='call'&&n.name==='is_empty'&&n.args[0].k==='ref'){
   const source=p.bindings.get(n.args[0].path[0])!;if(source.result?.maxRows!==undefined&&source.result.maxRows<=500)return binding(n.args[0].path[0]).length===0;
   const args:any[]=[],text=sql(n.args[0].path[0],args);return !!execute(n.args[0].path[0],'SELECT NOT EXISTS ('+text+') AS empty',args)[0].empty;
  }
  if(n.k==='call'&&['in_subnet','not_in_subnet'].includes(n.name)){
   const a=value(n.args[0]),b=value(n.args[1]);if(a===null||b===null)return null;
   const result=inSubnet(a,b);return result===null?null:n.name==='in_subnet'?!!result:!result;
  }
  if(n.k==='call'&&['contains','not_contains','starts_with','ends_with'].includes(n.name)){
   const a=value(n.args[0]),b=value(n.args[1]);if(a===null||b===null)return null;
   // Match SQLite lower(): only ASCII letters are case folded.
   const lower=(s:string)=>s.replace(/[A-Z]/g,c=>c.toLowerCase()),x=lower(a),y=lower(b);
   return n.name==='contains'?x.includes(y):n.name==='not_contains'?!x.includes(y):n.name==='starts_with'?x.startsWith(y):x.endsWith(y);
  }
  if(n.k==='call'&&n.name==='map_opt'){
   const row=value(n.args[0]),projection=n.args[1],contract=projection.checkedType;
   if(contract?.kind!=='projection'||!same(contract.output,projectionType(contract.input,projection.path)))throw Error('Optional projection does not match its checked contract');
   if(row===null||row?.tag==='None')return null;return readProjection(row?.tag==='Some'?row.value:row,projection.path);
  }
  if(n.k==='call'&&Object.hasOwn(timeFunctions,n.name)){const args=n.args.map(value);return args.some((v:any)=>v===null)?null:(timeFunctions[n.name as keyof typeof timeFunctions] as (...args:any[])=>any)(...args);}
  if(n.k==='call'&&p.types.get(n.name)?.kind==='scalar'&&['EpochMillis','DateTimeUtc','DateTimeTz','LocalDate','TimeZone'].includes(p.types.get(n.name)!.name!))return convert(p.types.get(n.name)!,value(n.args[0]),'parse');
  if(n.k==='call'&&p.host?.functions[n.name])return p.host.functions[n.name].run(n.args.map(value));
  if(n.k==='call'&&['difference','ratio','growth_rate'].includes(n.name)){
   const a=value(n.args[0]),b=value(n.args[1]);if(a===null||b===null)return null;
   return n.name==='difference'?a-b:n.name==='ratio'?b===0?null:a/b:b>0?(a-b)/b:null;
  }
  if(n.k==='call'&&['is_some','is_none'].includes(n.name)){const v=value(n.args[0]),some=v!==null&&v!==undefined&&v?.tag!=='None';return n.name==='is_some'?some:!some;}
  if(n.k==='call'&&n.name==='case_when')return value(n.args[value(n.args[0])?1:2]);
  if(n.k==='call'&&n.name==='round'){const v=value(n.args[0]);return v===null?null:Number(v.toFixed(n.args[1]?.value??0));}
  if(n.k==='call'&&n.name==='concat'){const args=n.args.map(value);return args.includes(null)?null:args.join('');}
  if(n.k==='context'){
   if(!contextLoaded){contextSnapshot=structuredClone(execution.context);contextLoaded=true;}
   return Object.fromEntries(n.fields.map((field:Node)=>[field.name,convert(field.resolvedType,contextSnapshot?.[field.contextKey],'parse')]));
  }
  if(n.k==='do'){const local:Record<string,any>={};scopes.push(local);try{for(const binding of n.bindings)local[binding.name]=value(binding.value);return value(n.result);}finally{scopes.pop();}}
  if(n.enumVariant)return n.enumVariant.type.codec.parse(n.enumVariant.name);
  if(n.k==='call'&&n.name==='lookup'){
   const input=operand(n.args[0]);if(input===null)return null;
   for(const entry of n.args[1].items){const key=entry.fields.find((f:Node)=>f.name==='value').value;if(input===operand(key))return value(entry.fields.find((f:Node)=>f.name==='label').value);}return null;
  }
  return plainValue(n);
 }
 function plainValue(n:Node):any {if(n.k==='array')return n.items.map(value);if(n.k==="unary"){const v=value(n.value);return v===null?null:-v;}if(n.k==="binary"){const a=operand(n.left),b=operand(n.right);if(a===null||b===null)return null;switch(n.op){case "+":return a+b;case "-":return a-b;case "*":return a*b;case "/":return b===0?null:a/b;case "%":return b===0?null:a%b;case "==":return a===b;case "!=":return a!==b;case "<":return a<b;case ">":return a>b;case "<=":return a<=b;case ">=":return a>=b;case "&&":return a&&b;case "||":return a||b;}}if(n.k==="call"&&n.name==="unwrap_or"){const v=value(n.args[0]);return v?.tag==='Some'?v.value:v?.tag==='None'||v===null?value(n.args[1]):v;}if(n.k==='literal')return n.value;if(n.k==='ref'){const scope=scopes.findLast(s=>Object.hasOwn(s,n.path[0]));let v=scope?scope[n.path[0]]:binding(n.path[0]);for(const k of n.path.slice(1))v=v[k];return v;}if(n.k==='object')return Object.fromEntries(n.fields.map((f:Node)=>[f.name,value(f.value)]));if(n.k==='call'&&n.name==='is_empty')return value(n.args[0]).length===0;if(n.k==='call'&&p.types.get(n.name)?.kind==='nominal')return convert(p.types.get(n.name)!,value(n.args[0]),'parse');throw Error('Unsupported runtime expression '+n.k);}
 function sql(name:string,args:any[]):string {
  const b=p.bindings.get(name)!;
  if(b.kind==='literal_table'){
   const fields=b.type.inner!.fields!,rows=b.ast.args[0].items;
   if(!rows.length)return 'SELECT '+Object.keys(fields).map(k=>'NULL AS '+quote(k)).join(', ')+' WHERE 0';
   const tuples=rows.map((row:Node)=>'('+Object.entries(fields).map(([key,type])=>{const field=row.fields.find((f:Node)=>f.name===key);args.push(encodeValue(type,value(field.value)));return '?';}).join(', ')+')');
   return 'SELECT '+Object.keys(fields).map((key,index)=>'column'+(index+1)+' AS '+quote(key)).join(', ')+' FROM (VALUES '+tuples.join(', ')+')';
  }
  if(b.kind==='source')return 'SELECT * FROM '+quote(b.ast.args[0].value);
  if(b.kind==='model'){
   let q=prepared.get(name);
   if(!q){
    q=p.model!.bind(b.modelPlan,b.parameters!.map(value));
    const expected=Object.entries(b.result!.element.fields!).map(([name,t])=>({name,...storage(t)}));
    if((b.result!.maxRows===undefined?q.max_rows!==undefined:q.max_rows===undefined||!Number.isInteger(q.max_rows)||q.max_rows<0||q.max_rows>b.result!.maxRows)||q.columns.length!==expected.length||q.columns.some((c,i)=>c.name!==expected[i].name||c.type!==expected[i].type||c.nullable!==expected[i].nullable))throw Error('Model transform contradicts published type/bound: '+name);
    prepared.set(name,q);
   }
   args.push(...q.bindings);return q.sql.replace(/;\s*$/,'');
  }
  if(b.kind!=='select')throw Error('Not a query '+name);
  return planSql(b.plan!,args);
 }
 function planSql(plan:Plan,args:any[]):string {
  const alias='stage_'+plan.id;
  function expr(n:Node,input:Plan,qualifier:string|Record<string,string>=alias):string {
   if(n.k==='object')return 'json_object('+n.fields.flatMap((f:Node)=>{args.push(f.name);return ['?',expr(f.value,input,qualifier)];}).join(', ')+')';
   if(n.enumVariant){args.push(encodeValue(n.enumVariant.type,value(n)));return '?';}
   if(n.k==='literal'){args.push(typeof n.value==='boolean'?Number(n.value):n.value);return '?';}
   if(n.k==='ref'){
    const path=n.path.join('.');
    if(typeof qualifier!=='string'&&Object.hasOwn(qualifier,path))return qualifier[path];
    const column=input.refs[path];if(column!==undefined&&typeof qualifier==='string')return quote(qualifier)+'.'+quote(column);
    args.push(encodeValue(expressionType(n),value(n)));return '?';
   }
   if(n.k==='unary')return '(-'+expr(n.value,input,qualifier)+')';
   if(n.k==='binary'){const op=({'==':'=','!=':'<>','&&':'AND','||':'OR'} as Record<string,string>)[n.op]??n.op;const operand=(v:Node)=>{const sql=expr(v,input,qualifier),t=presentType(v);return t&&timeType(t)?'dari_to_epoch_millis('+sql+')':sql;};const a=operand(n.left),b=operand(n.right);return n.op==='%'?'('+a+' % NULLIF('+b+', 0))':n.op==='/'?'(1.0 * '+a+' / NULLIF('+b+', 0))':'('+a+' '+op+' '+b+')';}
   if(n.k==='call'){
    if(n.calendarBucketUnit){const bucketInput=expr(n.args[0],input,qualifier);args.push(n.calendarBucketUnit);const zone=expr(n.args[2],input,qualifier);return 'dari_calendar_bucket('+bucketInput+', ?,'+zone+')';}
    if(n.utcBucketUnit){const bucketInput=expr(n.args[0],input,qualifier);args.push(n.utcBucketUnit);return 'dari_utc_bucket('+bucketInput+', ?)';}
    if(['in_subnet','not_in_subnet'].includes(n.name))return '('+(n.name==='not_in_subnet'?'NOT ':'')+'dari_in_subnet('+expr(n.args[0],input,qualifier)+','+expr(n.args[1],input,qualifier)+'))';
    if(['contains','not_contains','starts_with','ends_with'].includes(n.name)){
     const first=()=>expr(n.args[0],input,qualifier),second=()=>expr(n.args[1],input,qualifier);
     if(n.name==='ends_with')return '(substr(lower('+first()+'), length(lower('+first()+')) - length(lower('+second()+')) + 1) = lower('+second()+'))';
     return '(instr(lower('+first()+'), lower('+second()+')) '+(n.name==='contains'?'> 0':n.name==='not_contains'?'= 0':'= 1')+')';
    }
    if(['difference','ratio','growth_rate'].includes(n.name)){
     const first=()=>expr(n.args[0],input,qualifier),second=()=>expr(n.args[1],input,qualifier);
     if(n.name==='difference')return '('+first()+' - '+second()+')';
     if(n.name==='ratio')return '(1.0 * '+first()+' / NULLIF('+second()+', 0))';
     return '(CASE WHEN '+second()+' > 0 THEN 1.0 * ('+first()+' - '+second()+') / '+second()+' ELSE NULL END)';
    }
    if(Object.hasOwn(timeFunctions,n.name))return 'dari_'+n.name+'('+n.args.map((a:Node)=>expr(a,input,qualifier)).join(', ')+')';
    if(p.types.get(n.name)?.kind==='scalar'&&timeType(p.types.get(n.name)!)){if(n.args[0].k==='literal'){args.push(value(n));return '?';}return 'dari_parse_'+p.types.get(n.name)!.name+'('+expr(n.args[0],input,qualifier)+')';}
    if(p.host?.functions[n.name]?.sql)return 'dari_host_'+n.name+'('+n.args.map((a:Node)=>expr(a,input,qualifier)).join(', ')+')';
    if(n.name==='not_none')return expr(n.args[0],input,qualifier);
    if(n.name==='map_opt'){args.push(encodeValue(expressionType(n),value(n)));return '?';}
    if(n.name==='case_when')return '(CASE WHEN '+expr(n.args[0],input,qualifier)+' THEN '+expr(n.args[1],input,qualifier)+' ELSE '+expr(n.args[2],input,qualifier)+' END)';
    if(n.name==='concat')return '('+n.args.map((a:Node)=>expr(a,input,qualifier)).join(' || ')+')';
    if(['is_some','is_none'].includes(n.name))return '('+expr(n.args[0],input,qualifier)+(n.name==='is_some'?' IS NOT NULL)':' IS NULL)');
    if(n.name==='lookup')return '(CASE '+expr(n.args[0],input,qualifier)+n.args[1].items.map((entry:Node)=>' WHEN '+expr(entry.fields.find((f:Node)=>f.name==='value').value,input,qualifier)+' THEN '+expr(entry.fields.find((f:Node)=>f.name==='label').value,input,qualifier)).join('')+' ELSE NULL END)';
    if(p.types.get(n.name)?.kind==='nominal'){const t=p.types.get(n.name)!;if(t.codec){args.push(t.codec.encode(value(n)));return '?';}return expr(n.args[0],input,qualifier);}
    const fn=({count:'COUNT',sum:'SUM',avg:'AVG',min:'MIN',max:'MAX',unwrap_or:'COALESCE',round:'ROUND'} as Record<string,string>)[n.name];
    if(!fn)throw Error('Unsupported SQL function '+n.name);return fn+'('+(n.name==='count'&&!n.args.length?'*':n.args.map((a:Node)=>expr(a,input,qualifier)).join(', '))+')';
   }
   throw Error('Unsupported SQL expression '+n.k);
  }
  function sorted(n:Node,input:Plan):string{
   const type=presentType(n),text=type&&timeType(type)?'dari_to_epoch_millis('+expr(n,input)+')':expr(n,input),codec=type?.codec;
   if(!codec?.order?.length)return text;
   return '(CASE '+text+codec.order.map((name,index)=>{args.push(codec.encode(name),index);return ' WHEN ? THEN ?';}).join('')+' ELSE NULL END)';
  }
  function presentType(n:Node){let t=expressionType(n);if(t?.kind==='option')t=t.inner;return t;}
  const order=()=>plan.result.ordering.length?' ORDER BY '+plan.result.ordering.map(o=>quote(o.key)+' '+o.direction.toUpperCase()).join(', '):'';
  if(plan.kind==='set'){
   const columns=Object.keys(plan.result.element.fields!).map(quote).join(', ');
   return plan.sources!.map(s=>'SELECT '+columns+' FROM ('+sql(s.binding,args)+') AS '+quote(s.alias)).join(' '+plan.setOp+' ');
  }
  if(plan.kind==='distinct'||plan.kind==='top'){
   const input=plan.input!,columns=Object.keys(plan.result.element.fields!).map(name=>quote(alias)+'.'+quote(name)).join(', ');
   if(plan.kind==='distinct')return 'SELECT DISTINCT '+columns+' FROM ('+planSql(input,args)+') AS '+quote(alias);
   const keys=plan.keys!.map(k=>expr(k,input)),terms=plan.terms!.map(t=>sorted(t.args[0],input)+' '+t.name.toUpperCase());
   let rank='_dari_rank_'+plan.id;while(Object.hasOwn(plan.result.element.fields!,rank))rank+='_';
   const text='SELECT '+columns+', ROW_NUMBER() OVER (PARTITION BY '+keys.join(', ')+' ORDER BY '+terms.join(', ')+') AS '+quote(rank)+' FROM ('+planSql(input,args)+') AS '+quote(alias);
   return 'SELECT '+Object.keys(plan.result.element.fields!).map(quote).join(', ')+' FROM ('+text+') AS '+quote('ranked_'+plan.id)+' WHERE '+quote(rank)+' <= '+plan.count;
  }
  if(plan.kind==='source'){
   const columns=plan.sources!.filter((s,i)=>!plan.existsMode||i===0).flatMap(s=>Object.entries(s.fields).map(([name,column])=>quote(s.alias)+'.'+quote(name)+' AS '+quote(column)));
   if(plan.result.ordering.length){const s=plan.sources![0];columns.push(...s.ordering.map((o,i)=>quote(s.alias)+'.'+quote(o.key)+' AS '+quote(plan.result.ordering[i].key)));}
   const sources=plan.sources!.map(s=>'('+sql(s.binding,args)+') AS '+quote(s.alias));
   let text='SELECT '+columns.join(', ')+' FROM '+sources[0];
   if(sources.length===2){const refs=Object.fromEntries(plan.sources!.flatMap(s=>Object.keys(s.fields).map(name=>[s.alias+'.'+name,quote(s.alias)+'.'+quote(name)])));text+=plan.existsMode?' WHERE '+(plan.existsMode==='anti'?'NOT ':'')+'EXISTS (SELECT 1 FROM '+sources[1]+' WHERE '+expr(plan.join!,plan,refs)+')':(plan.sources![1].nullable?' LEFT JOIN ':' INNER JOIN ')+sources[1]+' ON '+expr(plan.join!,plan,refs);}
   return text+order();
  }
  if(plan.kind==='group')throw Error('Grouped rows must be consumed by project');
  let input=plan.input!,group:Plan|undefined;
  let fields=plan.fields,terms=plan.terms;
  // Hidden source sorting is lowered together with its projection, preserving keys.
  if(plan.kind==='order'&&input.kind==='project'&&terms!.some(t=>!Object.hasOwn(input.refs,t.args[0].path.join('.')))){
   const project=input;fields=project.fields;
   terms=terms!.map(t=>({...t,args:[t.args[0].path[0]==='out'?project.fields!.find(f=>f.name===t.args[0].path[1])!.value:t.args[0]]}));
   input=project.input!;
  }
  if(input.kind==='group'){group=input;input=input.input!;}
  const columns=fields?fields.map(f=>expr(f.value,input)+' AS '+quote(f.name)):Object.keys(plan.result.element.fields!).map(name=>quote(alias)+'.'+quote(name)+' AS '+quote(name));
  if(plan.kind==='order')columns.push(...terms!.map((term,i)=>sorted(term.args[0],input)+' AS '+quote(plan.result.ordering[i].key)));
  else columns.push(...plan.result.ordering.map((o,i)=>quote(alias)+'.'+quote(input.result.ordering[i].key)+' AS '+quote(o.key)));
  // Projection parameters precede parameters in nested source SQL.
  let text='SELECT '+columns.join(', ')+' FROM ('+planSql(input,args)+') AS '+quote(alias);
  if(plan.kind==='filter')text+=' WHERE '+expr(plan.predicate!,input);
  if(group)text+=' GROUP BY '+group.keys!.map(k=>expr(k,input)).join(', ');
  const required=(fields??[]).filter(f=>f.value.k==='call'&&f.value.name==='not_none');
  if(required.length)text='SELECT * FROM ('+text+') AS '+quote('nonnull_'+plan.id)+' WHERE '+required.map(f=>quote(f.name)+' IS NOT NULL').join(' AND ');
  text+=order();
  if(plan.kind==='take')text+=' LIMIT '+plan.count;
  return text;
 }
 function binding(name:string):any {
  const saved=scopes;scopes=[];
  try{return globalBinding(name);}catch(error){
   const message=(error as Error).message,b=p.bindings.get(name);
   if(!b||/^(SubmitFailed|CheckFailed)\n/.test(message))throw error;
   const contract=/Model (transform contradicts|result exceeds)|projection does not match|contract changed/i.test(message);
   throw Error(renderDiagnostics(p.source,[{at:b.ast.at,message,stage:'runtime',asset:b.ast.owner??name,code:contract?'runtime-contract':b.ast.name==='input'?'runtime-input':'runtime-value',...(contract?{reason:'运行实现或结果违背检查期已证明的契约',suggestion:'核对模型及宿主版本并修复实现；不要通过放宽类型或上界掩盖此错误'}:b.ast.name==='input'?{reason:'运行期输入不符合声明的类型或编码',suggestion:'核对输入字段、业务类型编码及可空性；不要修改 Schema 来掩盖错误值'}:{})}],'SubmitFailed'));
  }finally{scopes=saved;}

 }
 function globalBinding(name:string):any {
  if(cache.has(name))return cache.get(name);const b=p.bindings.get(name)!;let v:any;
  if(b.kind==='select'||b.kind==='model'){if(b.internal)throw Error('A node-local relation plan cannot be materialized independently');if(b.result?.maxRows===undefined||b.result.maxRows>500)throw Error('Cannot materialize an unbounded intermediate plan: '+name);const args:any[]=[];const text=sql(name,args);v=execute(name,text,args).map(row=>({...row}));
   if(b.result?.maxRows!==undefined&&v.length>b.result.maxRows)throw Error('Model result exceeds published row bound: '+name);
   const element=b.result!.element;
   v=v.map((row:any)=>convert(element,row,'decode'));
   if(b.type.kind==='option')v=v.length?{tag:'Some',value:v[0]}:{tag:'None'};
  }
  else if(b.ast.k==='call'&&b.ast.name==='input'){try{v=convert(b.type,inputs[name],'parse');}catch(e){throw Error('Invalid input '+name+': '+(e as Error).message);}}
  else if(b.kind==='tree'){const previous=dataScope;dataScope=name===p.answer?'answer':'reports/'+name;try{v=render(b.ast.root);}finally{dataScope=previous;}}
  else if(b.kind==='literal_table'){
   if(b.result!.maxRows!>500)throw Error('Materialization requires a proven bound <= 500');
   v=b.ast.args[0].items.map((row:Node)=>convert(b.type.inner!,value(row),'parse'));
  }
  else if(b.kind==='source')throw Error('Physical source must be consumed through a bounded query');
  else v=value(b.ast);cache.set(name,v);return v;
 }
 type FigureNumbers={charts:number;tables:number};
 const answerNumbers:FigureNumbers={charts:0,tables:0};
 const figureLabel=(kind:'chart'|'table',numbers:FigureNumbers)=>kind==='table'?'表 '+(++numbers.tables):'图 '+(++numbers.charts);
 function reportNode(n:Node,numbers:FigureNumbers):string {
  if(n.k==='literal')return html(n.value);
  if(n.k==='if')return (value(n.test)?n.yes:n.no).map((c:Node)=>reportNode(c,numbers)).join('');
  if(n.k==='iflet'){const v=value(n.test),yes=v!==null&&v!==undefined&&v?.tag!=='None';if(!yes)return n.no.map((c:Node)=>reportNode(c,numbers)).join('');scopes.push({[n.name]:v?.tag==='Some'?v.value:v});try{return n.yes.map((c:Node)=>reportNode(c,numbers)).join('');}finally{scopes.pop();}}
  const attrs=Object.fromEntries(n.attrs.map((a:Node)=>[a.name,a.value]));
  if(n.name==='Lit')return html(attrs.value.value);
  if(n.name==='UseValue'){
   const reference=attrs.ref.path.join('.');
   const shown=componentValue(n);recordValue(n,shown);
   const title=n.attrs.find((a:Node)=>a.name==='ref').sourceText??reference;
   return '<span data-oks-ref="'+html(reference)+'" title="'+html(title)+'">'+html(shown)+'</span>';
  }
  if(n.checkedSpec||n.name==='ColumnChart'){
   const figure=renderChart(n);
   const label=figureLabel(figure.kind,numbers);recordData((figure.kind==='table'?'tables/':'figures/')+(figure.kind==='table'?numbers.tables:numbers.charts),figure.dataText??(figure.kind==='table'?figure.content:''));
   return '<figure>'+(figure.kind==='table'?figure.html:figure.content)+'<figcaption><span class="item-no">'+label+'</span>'+html(figure.title??'')+'</figcaption></figure>';
  }
  const tag=n.name==='Report'?'article':n.name;
  const attributes=Object.entries(attrs).filter(([key])=>n.name!=='Report'||key!=='title').map(([key,node]:[string,any])=>' '+key+'="'+html(node.value)+'"').join('');
  return '<'+tag+attributes+'>'+n.children.map((c:Node)=>reportNode(c,numbers)).join('')+(['br','hr'].includes(tag)?'':'</'+tag+'>');
 }
 function presented(t:Type|undefined,v:any,digits?:number):any {
  if(t?.kind==='option')return presented(t.inner,v?.tag==='Some'?v.value:v?.tag==='None'?null:v,digits);
  return p.host?.formatValue?p.host.formatValue(t,v,digits):formatValue(t,v,digits);
 }
 function componentValue(n:Node):any {
  const attrs=Object.fromEntries(n.attrs.map((a:Node)=>[a.name,a.value]));
  return presented(expressionType(attrs.ref),value(attrs.ref),n.checkedPrecision);
 }
 function renderChart(n:Node):import('./host.ts').FigureOutput {
  const a=Object.fromEntries(n.attrs.map((f:Node)=>[f.name,f.value]));const ref=(key:string)=>a[key].path[0];
  if(n.checkedSpec&&p.host){
   const rows=(name:string)=>binding(name).map((row:any)=>Object.fromEntries(Object.entries(row).map(([k,v]:[string,any])=>[k,v&&typeof v==='object'&&typeof v.tag==='string'?display(v):v])));
   // Resolve inputs outside the rendering catch: an upstream failure keeps its own location.
   const data=rows(ref('data')).map((row:any)=>({...row,...Object.fromEntries((n.checkedPaths??[]).map((path:string[])=>[path.join('.'),readProjection(row,path)]))})),nodes=a.nodes?rows(ref('nodes')):undefined;
   try{return p.host.renderFigure(n.name,n.checkedSpec,data,n.checkedFields,nodes);}
   catch(error){
    const asset=[...p.bindings].filter(([,b])=>b.kind==='tree'&&b.ast.root.at<=n.at).sort((a,b)=>b[1].ast.root.at-a[1].ast.root.at)[0]?.[0];
    const message=n.name+'(data = '+ref('data')+'): '+(error as Error).message;
    throw Error(renderDiagnostics(p.source,[{at:n.at,message,stage:'runtime',asset}],'SubmitFailed'));
   }
  }
  const field=(key:string)=>{const projection=a[key],contract=projection.checkedType,row=p.bindings.get(ref('data'))!.result!.element;if(contract?.kind!=='projection'||!same(contract.input,row)||!same(contract.output,projectionType(row,projection.path)))throw Error('Field projection does not match its checked row contract');return projection.path.join('.');};
  if(n.name==='Table'){
   const spec=n.checkedSpec??{},fields=n.checkedFields,rows=binding(ref('data')),columns=spec.columns??Object.keys(fields),labels=spec.labels??{};
   if(!rows.length&&!spec.allow_no_data)throw Error('Table has no data; set allow_no_data:True when an empty result is acceptable');
   const content='| '+columns.map((key:string)=>md(labels[key]??key)).join(' | ')+' |\n| '+columns.map(()=>'---').join(' | ')+' |\n'+rows.map((row:any)=>'| '+columns.map((key:string)=>md(presented(fields[key],row[key],spec.precision))).join(' | ')+' |').join('\n');
   const tableHtml='<table><thead><tr>'+columns.map((key:string)=>'<th>'+html(labels[key]??key)+'</th>').join('')+'</tr></thead><tbody>'+rows.map((row:any)=>'<tr>'+columns.map((key:string)=>'<td>'+html(presented(fields[key],row[key],spec.precision))+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
   return {kind:'table',content,html:tableHtml,title:spec.title};
  }
  if(n.name==='ColumnChart'){
   const rows=binding(ref('data')).map((row:any)=>({...row,...Object.fromEntries(['x','value'].map(key=>[a[key].path.join('.'),readProjection(row,a[key].path)]))})),x=field('x'),y=field('value'),width=Math.max(320,rows.length*80),height=240,max=Math.max(1,...rows.map((r:any)=>Number(r[y]??0)));
   const bars=rows.map((r:any,i:number)=>{const h=Math.max(0,Number(r[y]??0))/max*170;return `<rect x="${i*80+20}" y="${190-h}" width="45" height="${h}" fill="#3977b8"/><text x="${i*80+20}" y="210">${html(r[x])}</text>`;}).join('');
   return {kind:'chart' as const,content:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><metadata>${html(JSON.stringify({spec:{x,y},data:rows}))}</metadata>${bars}</svg>`};
  }

  throw Error('Unknown chart component '+n.name);
 }
 function render(n:Node,numbers:FigureNumbers=answerNumbers):any {
  if(n.k==='literal')return md(n.value);
  if(n.k==='iflet'){const v=value(n.test);const yes=v?.tag==='Some'||v!==null&&v!==undefined&&v?.tag!=='None';if(!yes)return n.no.map((c:Node)=>render(c,numbers)).join('\n\n');scopes.push({[n.name]:v?.tag==='Some'?v.value:v});try{return n.yes.map((c:Node)=>render(c,numbers)).join('\n\n');}finally{scopes.pop();}}
  if(n.k==='if')return (value(n.test)?n.yes:n.no).map((c:Node)=>render(c,numbers)).join('\n\n');
  const a=Object.fromEntries(n.attrs.map((f:Node)=>[f.name,f.value]));
  const ref=(key:string)=>a[key].path[0];
  if(n.name==='Report')return {kind:'report',title:a.title?.value,html:reportNode(n,{charts:0,tables:0})};
  if(n.checkedSpec||n.name==='ColumnChart'){
   const figure=renderChart(n),label=figureLabel(figure.kind,numbers),caption=label+(figure.title?'：'+figure.title:'');recordData((figure.kind==='table'?'tables/':'figures/')+(figure.kind==='table'?numbers.tables:numbers.charts),figure.dataText??(figure.kind==='table'?figure.content:''));
   if(figure.kind==='table')return '**'+md(caption)+'**\n\n'+figure.content;
   const name='chart_'+(++chartSerial);artifacts[name+'.svg']=figure.content;return '!['+md(caption)+']('+name+'.svg)\n\n'+md(caption);
  }

  const children=()=>n.children.map((c:Node)=>render(c,numbers)).join(['p','span','a','code','pre','li','h1','h2','h3','strong','em'].includes(n.name)?'':'\n\n');
  if(n.name==='Lit')return md(a.value.value);
  if(n.name==='br')return '  \n';
  if(n.name==='hr')return '\n\n---\n\n';
  if(n.name==='ul'||n.name==='ol')return n.children.map((child:Node,index:number)=>(n.name==='ol'?String(index+1)+'. ':'- ')+render(child,numbers).replaceAll('\n','\n  ')).join('\n');
  if(n.name==='blockquote')return children().split('\n').map((line:string)=>'> '+line).join('\n');
  if(n.name==='pre'){const text=children(),fence='`'.repeat(Math.max(3,...(text.match(/`+/g)??[]).map((s:string)=>s.length+1)));return fence+'\n'+text+'\n'+fence;}
  if(n.name==='code'){const text=children(),fence='`'.repeat(Math.max(1,...(text.match(/`+/g)??[]).map((s:string)=>s.length+1)));return fence+' '+text+' '+fence;}
  if(n.name==='a')return '['+children()+']('+a.href.value.replaceAll(' ','%20').replaceAll('(','%28').replaceAll(')','%29')+')';
  if(n.name==='UseValue'){
   const shown=componentValue(n);recordValue(n,shown);
   const text=display(shown).replace(/([\\`*_\[\]<>|])/g,'\\$1').replace(/\r?\n/g,' ');
   return text?'*'+text+'*':'';
  }
  if(n.name==='UseReport'){
   const name=ref('ref'),report=binding(name),json=(v:unknown)=>JSON.stringify(v).replaceAll('<','\\u003c');
   includedReports.add('reports/'+name);
   const captured=contextLoaded?contextSnapshot:execution.context??null;
   const archive={version:1,context:{run:runId,batch:runId,sourceHash:createHash('sha256').update(p.source).digest('hex'),startedAt,model:p.model?{hash:p.modelImplementationId,domain:p.modelContractId}:null,captures:[{binding:'context',at:{line:1,column:1},value:captured},{binding:'input',at:{line:1,column:1},value:inputs}],acquisitions}};
   const source=p.source.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
   artifacts[name+'.html']='<!doctype html><meta charset="utf-8"><title>'+html(report.title??name)+'</title><style>'+(p.host?.reportStyle??'')+'</style>'+report.html+'\n<script type="text/plain" id="dari-source">'+source+'</script>\n<script type="application/json" id="dari-context">'+json(archive)+'</script>';
   const label=display(report.title??name).replace(/([\\`*_\[\]<>|])/g,'\\$1').replace(/\r?\n/g,' ');
   return '['+label+']('+name+'.html)';
  }
  const s=children();return /^h[123]$/.test(n.name)?'#'.repeat(Number(n.name[1]))+' '+s:n.name==='strong'?'**'+s+'**':n.name==='em'?'*'+s+'*':s;
 }
 const answer=binding(p.answer);const dataDocument=['answer',...includedReports].flatMap(scope=>{const values=valueSections.get(scope);return [...(dataSections.get(scope)??[]),...(values?.length?['## '+scope.replace(/^reports\//,'report/')+'/values\n\n'+values.join('\n')]:[])];}).join('\n\n');return {answer,artifacts,queries,dataDocument,deliveryId:runId,values:Object.fromEntries([...cache].filter(([name])=>!p.bindings.get(name)?.internal))};
}
