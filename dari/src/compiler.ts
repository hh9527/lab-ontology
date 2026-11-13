import {calendarTypes,calendarFunctions} from './calendar.ts';
import {precision} from './format.ts';
import {validateTimeFormat,type TimeFormat} from './time-display.ts';
import {sharedTypes,semantic,timeType} from './shared-types.ts';
import {hasPlanBindings,lowerPlanBindings,resolvePlanNames} from './bindings.ts';
import {lowerNodeBindings} from './node-bindings.ts';
import {faultDiagnostic,DiagnosticCollector,DiagnosticFailure,UpstreamTypeUnavailable,modelErrorText} from './diagnostics.ts';
import {encodeIntent,proofTarget,verifyReceipt,storage} from './model.ts';
import type {ModelPort,CheckedIntent,IntentType,QueryExprType,QueryOperation} from './model.ts';
import {parse,Fault,type FaultDetails,type Node} from './syntax.ts';
import {MAX_RESULT_ROWS,type Plan,type ResultContract,type Ordering} from './plan.ts';
export type {Plan} from './plan.ts';
import {primaryCodecs} from './primary-codecs.ts';
import type {HostPort} from './host.ts';
export type Type={kind:string;name?:string;displayName?:string;semantic?:string;presentation?:{multiplier:number;suffix:string;precision?:number};inner?:Type;fields?:Record<string,Type>;input?:Type;output?:Type;codec?:import('./model.ts').ValueCodec};
export type Binding={internal?:boolean;type:Type;ast:Node;kind:string;plan?:Plan;modelPlan?:unknown;parameters?:Node[];result?:ResultContract};
export type Program={types:Map<string,Type>;bindings:Map<string,Binding>;answer:string;source:string;warnings:import('./diagnostics.ts').Diagnostic[];model?:ModelPort;modelContractId?:string;modelImplementationId?:string;contextType?:Type;contextContractId?:string;host?:HostPort};
const scalar=(name:string):Type=>sharedTypes[name==='Rfc3339'?'DateTimeUtc':name]??{kind:'scalar',name,codec:primaryCodecs[name]};
export const optional=(t:Type):Type=>t.kind==='option'?t:{kind:'option',inner:t};
export const present=(t:Type):Type=>t.kind==='option'?t.inner!:t;
const numeric=(type:Type):boolean=>{let t=present(type);if(t.codec?.variants||t.name?.startsWith('Reference('))return false;while(t.kind==='nominal')t=t.inner!;return t.name==='Int'||t.name==='Float';};
export function show(t:Type):string{if(t.kind==='schema')return 'Schema({'+Object.entries(t.fields!).map(([n,t])=>n+': '+show(t)).join(', ')+'})';if(['option','table'].includes(t.kind))return (t.kind==='option'?'Option':'Table')+'('+show(t.inner!)+')';return t.displayName??t.name??t.kind;}
export const same=(a:Type,b:Type):boolean=>a.kind===b.kind&&(a.kind==='schema'?Object.keys(a.fields!).length===Object.keys(b.fields!).length&&Object.entries(a.fields!).every(([k,t])=>!!b.fields![k]&&same(t,b.fields![k])):a.kind==='option'||a.kind==='table'?same(a.inner!,b.inner!):a.name===b.name);
const err=(n:Node,message:string,details:FaultDetails={}):never=>{throw new Fault(message,n.at,{...(n.k==='call'?{expression:expressionHint(n)}:{}),...details});};
export function projectionType(input:Type,path:readonly string[]):Type {
 let current=input,shortCircuit=false;
 for(const segment of path){
  const unwrap=segment.endsWith('?'),key=unwrap?segment.slice(0,-1):segment;
  if(!['schema','range'].includes(current.kind))throw Error('Cannot project '+key+' on '+show(current)+'; prepare optional or computed values before selecting a field');
  if(!Object.hasOwn(current.fields!,key))throw Error('Unknown field '+key+' in $.'+path.join('.')+'; examples: '+Object.keys(current.fields!).slice(0,8).join(', '));
  current=current.fields![key];
  if(unwrap){if(current.kind!=='option')throw Error('? requires Option(T) at $.'+path.join('.'));current=current.inner!;shortCircuit=true;}
 }
 return shortCircuit?optional(current):current;
}
function checkedProjection(n:Node,input:Type):Type {try{const output=projectionType(input,n.path);n.checkedType={kind:'projection',input,output};return output;}catch(error){return err(n,(error as Error).message);}}

function expressionHint(n:Node):string|undefined {
 if(n.k==='ref')return (n.displayPath??n.path).map((key:string|number,i:number)=>typeof key==='number'?'['+key+']':(i?'.':'')+key).join('');
 if(n.k==='literal')return n.value===null?'None':typeof n.value==='boolean'?n.value?'True':'False':JSON.stringify(n.value);
 if(n.k==='binary'){const a=expressionHint(n.left),b=expressionHint(n.right);return a&&b?'('+a+' '+n.op+' '+b+')':undefined;}
 if(n.k==='call'){const args=n.args.map(expressionHint);return args.every((a:unknown)=>a!==undefined)?n.name+(n.name==='unwrap_or'?'!':'')+'('+args.join(', ')+')':undefined;}
 return undefined;
}
const bool=(n:Node,t:Type)=>{
 if(t.kind==='scalar'&&t.name==='Bool')return;
 const nullable=t.kind==='option'&&t.inner?.name==='Bool',hint=expressionHint(n);
 err(n,'Predicate requires Bool; got '+show(t),nullable?{code:'nullable-predicate',reason:'可空比较或计算可能返回空值，条件需要明确的 True 或 False',suggestion:'仅当空值应表示不满足时，使用 '+(hint?'unwrap_or!('+hint+', False)':'unwrap_or! 为该条件指定 False 默认值')+'；若空值应让条件成立，可选择 True 或单独表达空值条件'}:{code:'predicate-type',reason:'条件必须是 Bool；数值、文本和可选行没有隐式真假转换',suggestion:'数值或文本请显式比较；可空值使用 is_some/is_none；可选行在 tree! 中使用 if let Some 解构'});
};
const compatible=(a:Type,b:Type):boolean=>same(a,b)||a.kind==='option'&&(b.name==='None'||compatible(a.inner!,b))||a.name==='Float'&&b.name==='Int';
function modelPresence(root:number,pair:IntentType['pair'],steps:QueryOperation[],nodeCount:number):Map<number,boolean>{
 const presence=new Map<number,boolean>([[root,false]]);
 if(pair)presence.set(pair.right,false);
 for(let pass=0;pass<nodeCount;pass++)for(const edge of steps){
  if(edge.kind!=='connect'||presence.has(edge.from)===presence.has(edge.to))continue;
  const forward=presence.has(edge.from),origin=forward?edge.from:edge.to,target=forward?edge.to:edge.from,cardinality=forward?edge.relation.toCardinality:edge.relation.fromCardinality;
  presence.set(target,cardinality==='Optional'||!!presence.get(origin)&&cardinality==='One');
 }
 return presence;
}
function mismatchDetails(wanted:Type,got:Type):FaultDetails {return got.kind==='option'&&same(wanted,got.inner!)?{code:'nullable-value',reason:'需要非空值，但表达式可能为空',suggestion:'若有业务默认值，用 unwrap_or!；若来自表字段且允许丢弃空值行，在 project 的字段最外层使用 not_none'}:{code:'type-mismatch',reason:'期望类型与表达式的业务类型或容器形态不一致',suggestion:'保留业务类型约束，核对输入契约和投影；不要只按底层存储类型强行转换'};}
export function check(source:string,model?:ModelPort,options:{allowTestSources?:boolean;contextType?:Type;contextContractId?:string;host?:HostPort}={}):Program{
 const diagnostics=new DiagnosticCollector();
 try{return checkProgram(source,model,options,diagnostics);}catch(e){if(e instanceof DiagnosticFailure)throw e;if(e instanceof Fault){diagnostics.report(faultDiagnostic(e,'syntax'));throw new DiagnosticFailure(source,diagnostics.list());}throw e;}
}
function checkProgram(source:string,model?:ModelPort,options:{allowTestSources?:boolean;contextType?:Type;contextContractId?:string;host?:HostPort}={},diagnostics=new DiagnosticCollector()):Program{
 const p:Program={types:new Map(['Int','Float','String','Bool','Rfc3339',...Object.keys(sharedTypes)].map(n=>[n,scalar(n)])),bindings:new Map(),answer:'answer',source,warnings:[],model,modelContractId:model?.contractId,modelImplementationId:model?.implementationId,contextType:options.contextType,contextContractId:options.contextContractId,host:options.host};
 const failed=new Set<string>();let asset:string|undefined;
 const modelLocations=new WeakMap<QueryExprType,Node>();
 function modelFailure(error:unknown,intent:IntentType,query:Node):Fault{
  const names=new Map<string,string>();
  function collect(n:Node){
   if(n.k==='ref'&&n.displayPath)names.set(n.path[0],n.displayPath[0]);
   for(const value of Object.values(n)){
    if(Array.isArray(value)){for(const child of value)if(child&&typeof child==='object'&&'k'in child)collect(child);}
    else if(value&&typeof value==='object'&&'k'in value)collect(value as Node);
   }
  }
  collect(query);
  for(const [i,binding]of query.bindings.entries()){
   const node=intent.nodes[i],alias=names.get(binding.name)??node?.dataset.symbol??binding.name;
   names.set(node?.id??binding.name,alias);names.set('r'+i,alias);
   if(node)for(const member of Object.values(node.dataset.members))names.set(node.id+'_'+member.id,alias+'.'+member.symbol);
  }
  const message=modelErrorText((error as Error).message).replace(/\b(?:__node_\d+|node_\d+|r\d+)(?:_[A-Za-z0-9_]+)?\b/g,name=>names.get(name)??name);
  function mismatch(expr:QueryExprType):Fault|undefined{
   if(expr.kind!=='binary')return;
   if(expr.left.kind==='member'&&(expr.right.kind==='literal'||expr.right.kind==='parameter')){
    const expected=storage(expr.left.member.type),actual=storage(expr.right.type);
    if(expected.type!==actual.type&&!(expected.type==='Float'&&actual.type==='Int'))return new Fault(message+'; '+(modelLocations.get(expr.left)?expressionHint(modelLocations.get(expr.left)!):intent.nodes[expr.left.node].dataset.symbol+'.'+expr.left.member.symbol)+' expects '+show(present(expr.left.member.type))+' ('+expected.type+'), got '+show(expr.right.type)+' ('+actual.type+'). Use a parameter matching the published member type',modelLocations.get(expr.right)?.at??query.at,{stage:'model',code:'model-parameter-type',reason:'参数的物理编码与模型成员契约不一致',suggestion:'按 oks_info 发布的业务类型构造参数；不要修改成员类型或删去该条件'});
   }
   return mismatch(expr.left)??mismatch(expr.right);
  }
  if(/filter parameter type/.test(message))for(const step of intent.steps)if(step.kind==='filter'){const fault=mismatch(step.predicate);if(fault)return fault;}
  if(/no declared business ordering/.test(message))for(const step of intent.steps)if(step.kind==='order_by')for(const term of step.terms){
   const value=term.value,expr=value.kind==='output'?intent.steps.flatMap(s=>s.kind==='project'&&s.value.kind==='record'?[s.value.fields[value.name]]:[])[0]:value;
   if(expr?.kind==='member'&&present(expr.member.type).codec?.variants&&!present(expr.member.type).codec?.order?.length)return new Fault(message,modelLocations.get(term.value)?.at??query.at,{stage:'model',code:'business-ordering',reason:'该分类成员没有声明业务排序，不能按其内部编码隐式排名',suggestion:'若任务只要求展示分类，在后续 query! 映射标签并按展示口径排序；业务次序须由模型声明，不能擅自当作数值或文本顺序'});
  }
  if(/direct member reference/.test(message))for(const step of intent.steps)if(step.kind==='project'&&step.value.kind==='record')for(const expr of Object.values(step.value.fields))if(expr.kind!=='member')return new Fault(message,modelLocations.get(expr)?.at??query.at,{stage:'model',code:'model-projection',reason:'模型仅证明已发布成员及明确支持的时间转换、not_none 投影',suggestion:'query_remote! 投影需要的成员，后续 query! 处理派生表达式；保持聚合前后筛选口径不变'});
  return new Fault(message,query.at,{stage:'model',code:'model-capability',reason:'模型未能证明该查询满足已发布的领域能力',suggestion:'根据模型拒绝原因及 oks_info 契约修正；不要删除筛选、关系或业务类型以绕过校验'});
 }
 function finding(error:unknown){if(error instanceof UpstreamTypeUnavailable)return;if(!(error instanceof Fault))throw error;diagnostics.report(faultDiagnostic(error,'type',asset));}
 function calculation(n:Node,t:Type,operation:string){const policy=present(t).codec?.operations;if(policy&&!policy.includes(operation))err(n,show(t)+' does not allow '+operation+'; allowed calculations: '+policy.join(', '),{code:'business-operation',reason:'业务类型只允许其契约发布的计算，物理数值表示相同不代表算子可互换',suggestion:'使用该类型允许的计算；若是不同指标的并列展示，保留各自类型并使用宽表多序列，不剥离类型来绕过限制'});}
 function ordering(n:Node,t:Type){const codec=present(t).codec;if(codec?.variants&&!codec.order?.length)err(n,show(t)+' has no declared business ordering',{code:'business-ordering',reason:'语义分类投影不继承原始字符串或整数的排序能力',suggestion:'选择 raw 字段排序，或由模型通过独立的业务排序 property 声明次序'});calculation(n,t,'Compare');}
 function settle<T,R>(items:T[],work:(item:T)=>R):R[]{let invalid=false;const result:R[]=[];for(const item of items){try{result.push(work(item));}catch(error){finding(error);invalid=true;}}if(invalid)throw new UpstreamTypeUnavailable();return result;}
 for(const [name,t]of [...Object.entries(calendarTypes),...Object.entries(options.host?.types??{}),...Object.entries(model?.types??{})]){if(p.types.has(name))throw new Fault('Duplicate model type '+name,0);p.types.set(name,t);}
 function type(n:Node):Type{
  if(n.k==='schema'){const fields:Record<string,Type>=Object.create(null);settle(n.fields,(f:Node)=>{if(Object.hasOwn(fields,f.name))err(f,'Duplicate schema field '+f.name);const t=type(f.value);if(!['scalar','nominal'].includes(present(t).kind))err(f,'Schema fields require logical scalars, optionally nullable; got '+show(t));fields[f.name]=t;});return{kind:'schema',fields};}
  if(n.k==='intersect'){const a=type(n.left),b=type(n.right);if(a.kind!=='schema'||b.kind!=='schema')err(n,'& requires two Schema types');const fields={...a.fields};for(const [name,t]of Object.entries(b.fields!)){if(fields[name]&&!same(fields[name],t))err(n,'Schema conflict '+name+': '+show(fields[name])+' vs '+show(t));fields[name]=t;}return{kind:'schema',fields};}
  if(n.name==='Option'){const inner=type(n.inner);if(!['scalar','nominal','schema'].includes(inner.kind))err(n,'Option requires a logical scalar or Schema');return {kind:'option',inner};}
  if(n.name==='Table'){const inner=type(n.inner);if(inner.kind!=='schema')err(n,'Table requires Schema rows');return{kind:'table',inner};}
  if(n.name==='struct'){const inner=type(n.inner);if(inner.kind!=='scalar')err(n,'newtype requires scalar storage');return{kind:'nominal',inner};}
  if(n.inner)err(n,'Unsupported type constructor '+n.name);
  if(failed.has(n.name))throw new UpstreamTypeUnavailable();
  const t=p.types.get(n.name);if(!t)err(n,'Unknown type '+n.name);return t!;
 }
 function variant(n:Node):{type:Type;name:string}|undefined{
  if(n.k!=='ref'||n.path.length!==1)return;
  const parts=n.path[0].split('::'),name=parts.pop()!,t=p.types.get(parts.join('::'));
  if(!t?.codec?.variants)return;
  if(!t.codec.variants.includes(name))err(n,'Unknown enum variant '+name+' on '+show(t)+'; available: '+t.codec.variants.join(', '),{code:'enum-member',reason:'封闭枚举成员必须来自发布的类型定义',suggestion:'使用列出的精确 Type::Variant 符号，保留大小写；不要改成字符串或构造不存在的成员'});
  return {type:t,name};
 }
 function assign(n:Node,wanted:Type,env:Record<string,Type>={}){const got=infer(n,env);if(!compatible(wanted,got))err(n,'Expected '+show(wanted)+'; got '+show(got),mismatchDetails(wanted,got));}
 function infer(n:Node,env:Record<string,Type>={},aggregate=false,groupKeys=new Set<string>()):Type{
  if(n.k==='projection')err(n,'$.field requires an input row context; use it in figure settings or map_opt');
  if(n.k==='context')err(n,'context! must directly initialize a top-level data declaration');
  if(n.k==='do'){
   const local={...env},names=new Set<string>();
   const pure=(value:Node):void=>{if(['context','query','select','tree'].includes(value.k)||value.k==='call'&&['input','source','table','node','from'].includes(value.name))err(value,'do blocks contain pure calculations; declare acquisition or relation plans in top-level data nodes');for(const item of Object.values(value)){if(Array.isArray(item)){for(const child of item)if(child&&typeof child==='object'&&'k'in child)pure(child);}else if(item&&typeof item==='object'&&'k'in item)pure(item as Node);}};
   pure(n);
   for(const binding of n.bindings){if(names.has(binding.name))err(binding,'Duplicate local binding '+binding.name);const t=infer(binding.value,local);names.add(binding.name);local[binding.name]=t;}
   return n.resolvedType=infer(n.result,local);
  }
  if(n.k==='literal')return scalar(n.literal);
  if(n.k==='object'){const fields:Record<string,Type>=Object.create(null);settle(n.fields,(f:Node)=>{if(Object.hasOwn(fields,f.name))err(f,'Duplicate field '+f.name);fields[f.name]=infer(f.value,env,aggregate,groupKeys);});return{kind:'schema',fields};}
  if(n.k==='ref'){const v=variant(n);if(v){n.enumVariant=v;n.resolvedType=v.type;return v.type;}const [name,...path]=n.path;let t=env[name]??p.bindings.get(name)?.type;if(!t&&failed.has(name))throw new UpstreamTypeUnavailable();if(!t)err(n,name==='out'?'Unknown binding out; out is available only for projected or set results. In this scope use source fields: '+Object.entries(env).flatMap(([alias,t])=>Object.keys(t.fields??{}).map(field=>alias+'.'+field)).slice(0,8).join(', '):'Unknown binding '+name+'; available bindings: '+[...Object.keys(env),...[...p.bindings].filter(([,b])=>!b.internal).map(([name])=>name)].slice(0,8).join(', '));for(const key of path){if(t!.kind==='array'&&typeof key==='number'){t=t!.inner!;continue;}if(!['schema','range'].includes(t!.kind))err(n,'Cannot access '+key+' on '+show(t!));const next=t!.fields![key];if(!next)err(n,'Unknown field '+(n.displayPath??n.path).join('.')+'; examples: '+Object.keys(t!.fields!).slice(0,8).join(', '));t=next;}n.resolvedType=t;return t!;}
  if(n.k==='unary'){const t=infer(n.value,env,aggregate,groupKeys);if(!numeric(t))err(n,'Unary minus requires numeric type');calculation(n,t,'Negate');return t;}
  if(n.k==='binary'){
   const [a,b]=settle([n.left,n.right],(v:Node)=>infer(v,env,aggregate,groupKeys)),nullable=a.kind==='option'||b.kind==='option';const x=present(a),y=present(b);
   if(['&&','||'].includes(n.op)){bool(n.left,a);bool(n.right,b);return scalar('Bool');}
   if(['==','!=','<','>','<=','>='].includes(n.op)){calculation(n,a,'Compare');calculation(n,b,'Compare');if(!same(x,y)&&!(['Int','Float'].includes(x.name??'')&&['Int','Float'].includes(y.name??'')))err(n,'Cannot compare '+show(a)+' and '+show(b),{code:'incompatible-comparison',reason:'两侧没有兼容的业务类型，不能只根据存储都是数字或字符串来比较',suggestion:'比较同一业务类型的值；时间表示不同则先显式转换到同一时间类型'});const t=scalar('Bool');return nullable?optional(t):t;}
   if(semantic(a)==='EpochMillis'||semantic(b)==='EpochMillis'){
    const left=semantic(a)==='EpochMillis',right=semantic(b)==='EpochMillis';
    const result=left&&right&&n.op==='-'?scalar('Int'):left&&y.name==='Int'&&['+','-'].includes(n.op)||right&&x.name==='Int'&&n.op==='+'?scalar('EpochMillis'):undefined;
    if(!result)return err(n,'EpochMillis permits instant subtraction or integer millisecond offsets');
    return n.resolvedType=nullable?optional(result):result;
   }
   if(!numeric(a)||!numeric(b))err(n,'Arithmetic requires numeric types, got '+show(a)+' and '+show(b));
   const operation:Record<string,string>={'+':'Add','-':'Subtract','*':'Multiply','/':'Divide','%':'Remainder'};calculation(n,a,operation[n.op]);calculation(n,b,operation[n.op]);
   if(n.op==='%'){if(x.kind!=='scalar'||y.kind!=='scalar'||x.name!=='Int'||y.name!=='Int')err(n,'Remainder requires Int operands');return n.resolvedType=optional(scalar('Int'));}
   let t:Type;
   if(x.kind==='nominal'||y.kind==='nominal'){
    if(same(x,y)&&['+','-'].includes(n.op))t=x;
    else if(same(x,y)&&n.op==='/')t=scalar('Float');
    else if(x.kind==='nominal'&&y.kind==='scalar'&&['*','/'].includes(n.op))t=x;
    else if(x.kind==='scalar'&&y.kind==='nominal'&&n.op==='*')t=y;
    else return err(n,'Numeric business types require compatible units; got '+show(a)+' '+n.op+' '+show(b));
   }else t=scalar(n.op==='/'||x.name==='Float'||y.name==='Float'?'Float':'Int');
   return n.resolvedType=nullable||n.op==='/'?optional(t):t;
  }
  if(n.k==='call'){
   if(n.name==='utc_bucket'||n.name==='calendar_bucket'){
    const zoned=n.name==='calendar_bucket';
    if(n.args.length!==(zoned?3:2))err(n,n.name+' requires DateTimeUtc, a static CalendarUnit'+(zoned?' and TimeZone':''));
    const input=infer(n.args[0],env,aggregate,groupKeys),unit=variant(n.args[1]);
    if(present(input).name!=='DateTimeUtc')err(n,n.name+' requires DateTimeUtc; convert the instant explicitly with to_datetime_utc');
    if(unit?.type.name!=='CalendarUnit')return err(n.args[1],'utc_bucket requires a static CalendarUnit::Year/Quarter/Month/Week/Day');
    if(zoned){const zone=infer(n.args[2],env,aggregate,groupKeys);if(zone.kind==='option'||zone.name!=='TimeZone')err(n.args[2],'calendar_bucket requires a nonnullable TimeZone; obtain it from context! or construct TimeZone explicitly');n.calendarBucketUnit=unit.name;}else n.utcBucketUnit=unit.name;return n.resolvedType=input.kind==='option'?optional(scalar('DateTimeUtc')):scalar('DateTimeUtc');
   }
   if(Object.hasOwn(calendarFunctions,n.name)&&!(['is_empty','contains'].includes(n.name)&&n.args[0]&&infer(n.args[0],env).kind!=='range')){
    const args=settle(n.args,(a:Node)=>infer(a,env,aggregate,groupKeys));
    try{const t=calendarFunctions[n.name].check(args);n.calendarFunction=true;return n.resolvedType=t;}catch(error){return err(n,(error as Error).message,{code:'calendar-type',reason:'日历运算要求显式区分日期、瞬时值、时区和区间',suggestion:'按算子要求准备非空的业务类型；用 CalendarUnit/Weekday/DateOverflow 的枚举成员表达规则，不使用单位字符串或隐式默认时区'});}
   }
   if(['to_epoch_millis','to_datetime_utc','to_datetime_tz'].includes(n.name)){
    const arity=n.name==='to_datetime_tz'?2:1;
    if(n.args.length!==arity)err(n,n.name+' requires an instant'+(arity===2?' and an IANA time zone':''));
    const source=infer(n.args[0],env,aggregate,groupKeys);
    if(!timeType(source))err(n,'Time conversion requires EpochMillis, DateTimeUtc or DateTimeTz; got '+show(source),{code:'time-semantics',reason:'Int 或 String 的存储表示没有自动赋予时间语义',suggestion:'先核对来源的时间编码和单位；确为毫秒整数时用 EpochMillis 构造，确为 ISO 时间字符串时用 DateTimeUtc 构造，再显式转换；不要猜测秒与毫秒'});
    let nullable=source.kind==='option';
    if(arity===2){const zone=infer(n.args[1],env,aggregate,groupKeys);if(semantic(present(zone))!=='TimeZone')err(n,'Time zone requires TimeZone; use ctx.tz from context! or TimeZone("Asia/Shanghai")');nullable ||= zone.kind==='option';}
    const output=scalar(n.name==='to_epoch_millis'?'EpochMillis':n.name==='to_datetime_utc'?'DateTimeUtc':'DateTimeTz');return n.resolvedType=nullable?optional(output):output;
   }
   if(p.host?.functions[n.name]){
    try{return n.resolvedType=p.host.functions[n.name].check(settle(n.args,(a:Node)=>infer(a,env,aggregate,groupKeys)),n.args.map((a:Node)=>{try{return constant(a);}catch{return undefined;}}));}catch(e){return err(n,(e as Error).message);}
   }
   if(n.name==='lookup'){
    if(n.args.length!==2||n.args[1].k!=='array'||!n.args[1].items.length)err(n,'lookup requires a value and a nonempty static [{value, label}] table');
    const input=present(infer(n.args[0],env,aggregate,groupKeys));let output:Type|undefined;const keys=new Set<string>();
    for(const entry of n.args[1].items){
     if(entry.k!=='object'||entry.fields.length!==2||!entry.fields.some((f:Node)=>f.name==='value')||!entry.fields.some((f:Node)=>f.name==='label'))err(entry,'lookup entries require exactly value and label');
     const key=entry.fields.find((f:Node)=>f.name==='value').value,label=entry.fields.find((f:Node)=>f.name==='label').value;
     const constant=(v:Node):boolean=>!!variant(v)||v.k==='literal'&&v.value!==null||v.k==='unary'&&v.op==='-'&&v.value.k==='literal'&&typeof v.value.value==='number'||v.k==='call'&&p.types.get(v.name)?.kind==='nominal'&&v.args.length===1&&constant(v.args[0]);
     if(!constant(key)||!constant(label))err(entry,'lookup keys and labels must be static scalar constants');
     const kt=infer(key),lt=infer(label);if(!same(input,kt))err(key,'lookup key type must match '+show(input));
     if(!['scalar','nominal'].includes(lt.kind))err(label,'lookup label must be a logical scalar');
     if(output&&!same(output,lt))err(label,'lookup labels must have the same type');output=lt;
     const identity=(v:Node):string=>v.enumVariant?JSON.stringify(v.enumVariant.name):v.k==='literal'?JSON.stringify(v.value):v.k==='unary'?JSON.stringify(-v.value.value):identity(v.args[0]);
     const id=identity(key);if(keys.has(id))err(key,'Duplicate lookup key');keys.add(id);
    }
    return optional(output!);
   }
   if(['in_subnet','not_in_subnet'].includes(n.name)){
    if(n.args.length!==2)err(n,n.name+' requires address and canonical subnet Strings');
    const types=n.args.map((a:Node)=>infer(a,env,aggregate,groupKeys));
    if(types.some((t:Type)=>present(t).kind!=='scalar'||present(t).name!=='String'))err(n,'IPv4 operations require String operands');
    return n.resolvedType=optional(scalar('Bool'));
   }
   if(['contains','not_contains','starts_with','ends_with'].includes(n.name)){
    if(n.args.length!==2)err(n,n.name+' requires two String operands');
    const ts=n.args.map((a:Node)=>infer(a,env,aggregate,groupKeys));
    if(ts.some((t:Type)=>present(t).kind!=='scalar'||present(t).name!=='String'))err(n,n.name+' requires String operands');
    return n.resolvedType=ts.some((t:Type)=>t.kind==='option')?optional(scalar('Bool')):scalar('Bool');
   }
   if(['difference','ratio','growth_rate'].includes(n.name)){
    if(n.args.length!==2)err(n,n.name+' requires two compatible numeric operands');
    const a=infer(n.args[0],env,aggregate,groupKeys),b=infer(n.args[1],env,aggregate,groupKeys),x=present(a),y=present(b);
    if(!numeric(a)||!numeric(b)||!same(x,y)&&!(x.kind==='scalar'&&y.kind==='scalar'))err(n,n.name+' requires compatible numeric business types');
    const operation=n.name==='difference'?'Difference':n.name==='ratio'?'Ratio':'GrowthRate';calculation(n,a,operation);calculation(n,b,operation);
    const result=n.name==='difference'?x.kind==='nominal'?x:scalar(x.name==='Float'||y.name==='Float'?'Float':'Int'):sharedTypes.Ratio;
    return n.resolvedType=n.name!=='difference'||a.kind==='option'||b.kind==='option'?optional(result):result;
   }
   if(n.name==='map_opt'){
    if(n.args.length!==2||n.args[1].k!=='projection')err(n,'map_opt requires an optional row and $.field');
    const input=infer(n.args[0],env,aggregate,groupKeys),projection=n.args[1];
    if(input.kind!=='option'||input.inner?.kind!=='schema')err(n,'map_opt requires Option(Schema); got '+show(input),{code:'optional-row',reason:'map_opt 消费可选的单行结果，不消费表或普通标量',suggestion:'多行处理用 query!；若业务确实只需要一行，先按业务顺序 take_opt()，再用 $.field 选择字段'});
    const field=checkedProjection(projection,input.inner!);
    return n.resolvedType=optional(field);
   }
   if(['is_some','is_none'].includes(n.name)){if(n.args.length!==1||infer(n.args[0],env,aggregate,groupKeys).kind!=='option')err(n,n.name+' requires Option(T)');return scalar('Bool');}
   if(n.name==='round'){if(n.args.length<1||n.args.length>2)err(n,'round requires a number and optional precision 0..15');const t=infer(n.args[0],env,aggregate,groupKeys);if(!numeric(t))err(n,'round requires numeric input');calculation(n,t,'Round');if(n.args[1]&&(n.args[1].k!=='literal'||!Number.isInteger(n.args[1].value)||n.args[1].value<0||n.args[1].value>15))err(n,'round precision must be a static integer 0..15');const output=present(t).kind==='nominal'?present(t):scalar('Float');return n.resolvedType=t.kind==='option'?optional(output):output;}
   if(n.name==='not_none')err(n,'not_none is only allowed at the outermost level of a project field');
   if(n.name==='concat'){if(!n.args.length)err(n,'concat requires at least one String');const types=n.args.map((a:Node)=>infer(a,env,aggregate,groupKeys));if(types.some((t:Type)=>present(t).name!=='String'))err(n,'concat requires String arguments');return types.some((t:Type)=>t.kind==='option')?optional(scalar('String')):scalar('String');}
   if(n.name==='case_when'){if(n.args.length!==3)err(n,'case_when requires condition, then value and else value');bool(n.args[0],infer(n.args[0],env,aggregate,groupKeys));const a=infer(n.args[1],env,aggregate,groupKeys),b=infer(n.args[2],env,aggregate,groupKeys);if(!same(present(a),present(b)))err(n,'case_when branches require the same type');return a.kind==='option'||b.kind==='option'?optional(present(a)):a;}
   if(n.name==='input')err(n,'input() requires an explicitly typed declaration: data request: Params = input();');
   if(['count','sum','avg','min','max'].includes(n.name)){
    if(!aggregate)err(n,'Aggregate only allowed in grouped projection');if(n.name==='count'){if(n.args.length>1)err(n,'count accepts zero or one column');if(n.args.length)infer(n.args[0],env);return scalar('Int');}
    if(n.args.length!==1)err(n,'Aggregate requires one column');const t=present(infer(n.args[0],env));if(!numeric(t))err(n,'Aggregate requires numeric column');calculation(n,t,({sum:'Sum',avg:'Mean',min:'Min',max:'Max'} as Record<string,string>)[n.name]);return optional(n.name==='avg'&&t.kind!=='nominal'?scalar('Float'):t);
   }
   if(n.name==='unwrap_or'){
    if(n.args.length!==2)err(n,'unwrap_or! requires value and fallback');
    const a=infer(n.args[0],env,aggregate,groupKeys),b=infer(n.args[1],env,aggregate,groupKeys);
    if(a.kind!=='option'||!compatible(a.inner!,b)){
     const value=expressionHint(n.args[0]),fallback=expressionHint(n.args[1]);
     const types='第一个参数 '+(value??'（表达式）')+': '+show(a)+'；默认值 '+(fallback??'（表达式）')+': '+show(b);
     err(n,'unwrap_or requires Option(T) and T; got '+show(a)+' and '+show(b),{code:'unwrap_or-types',reason:types+'。'+(a.kind!=='option'?'第一个参数已经是非空值':'默认值必须是与可空值兼容的非空类型'),suggestion:a.kind!=='option'?'仅将此调用替换为 '+(value??'第一个参数')+'；其他 Option 参数的 unwrap_or! 保留':'提供同一业务类型的非空默认值；若需要丢弃空值行，改在投影字段最外层使用 not_none'});
    }
    return a.inner!;
   }
   if(n.name==='is_empty'){if(n.args.length!==1||infer(n.args[0],env).kind!=='table')err(n,'is_empty requires a table');return scalar('Bool');}
   const t=p.types.get(n.name);
   if(t?.kind==='scalar'&&['EpochMillis','DateTimeUtc','DateTimeTz','LocalDate','TimeZone'].includes(semantic(t)??'')){if(n.args.length!==1)err(n,'Time constructor requires one encoded value');const input=infer(n.args[0],env,aggregate,groupKeys);if(input.kind!=='scalar'||input.name!==(semantic(t)==='EpochMillis'?'Int':'String'))err(n,'Time constructor requires its encoded Int/String representation; use to_* for time conversions');return n.resolvedType=t;}
   if(t?.kind==='nominal'&&n.args.length===1){
    if(t.codec?.variants)err(n,'Use a static enum variant: '+n.name+'::Variant');
    else assign(n.args[0],t.inner!,env);return t;
   }
   err(n,'Unknown built-in '+n.name+'; arbitrary function execution is unavailable');
  }
  return err(n,'Unsupported expression '+n.k);
 }
 const fieldsOf=(n:Node)=>{if(n.k!=='object')err(n,'Expected named projection');return n.fields as Node[];};
 const key=(n:Node)=>n.k==='ref'?n.path.join('.'):undefined;
 function select(n:Node):Plan{
  let id=0;
  const aliases=new Map<string,{binding:string;type:Type}>();
  for(const b of n.bindings){
   if(b.name==='out'||aliases.has(b.name))err(b,'Duplicate or reserved source alias '+b.name);
   if(b.value.k!=='call'||b.value.name!=='from'||b.value.args.length!==1||b.value.args[0].k!=='ref'||b.value.args[0].path.length!==1)err(b,'let only binds from(table); start join({a,b}, a.key == b.key) directly, then project({left:a.field,right:b.field})');
   const name=b.value.args[0].path[0],t=p.bindings.get(name)?.type;
   if(!t&&failed.has(name))throw new UpstreamTypeUnavailable();
   if(t?.kind!=='table')err(b,'from requires Table(Schema)');
   aliases.set(b.name,{binding:name,type:t!.inner!});
  }
  const setKinds:Record<string,NonNullable<Plan['setOp']>>={union:'UNION',union_all:'UNION ALL',intersect:'INTERSECT',except:'EXCEPT'};
  const existenceKinds:Record<string,NonNullable<Plan['existsMode']>>={semi_join:'semi',anti_join:'anti'};
  const setOp=n.start.k==='call'?setKinds[n.start.name]:undefined;
  const existsMode=n.start.k==='call'?existenceKinds[n.start.name]:undefined;
  const joined=n.start.k==='call'&&['join','left_join','semi_join','anti_join'].includes(n.start.name);
  const names:string[]=n.start.k==='ref'?n.start.path:(joined&&n.start.args.length===2||setOp&&n.start.args.length===1)?fieldsOf(n.start.args[0]).map(f=>{
   if(f.value.k!=='ref'||f.value.path.join('.')!==f.name)err(f,'join uses {a,b} source aliases');return f.name;
  }):err(n.start,'Start with source alias or join({a,b}, condition)');
  if(new Set(names).size!==names.length||(setOp?names.length<2:names.length!==(joined?2:1)))err(n.start,'Use distinct source aliases; joins require two sources and set operations at least two');
  if(setOp){const first=aliases.get(names[0]);if(!first)err(n.start,'Unknown set source '+names[0]);settle(names.slice(1),name=>{const other=aliases.get(name);if(!other)err(n.start,'Unknown set source '+name);const left=first!.type.fields!,right=other!.type.fields!;const differences=[...new Set([...Object.keys(left),...Object.keys(right)])].filter(key=>!left[key]||!right[key]||!same(left[key],right[key]));if(differences.length)err(n.start,'Set inputs must have the same named Schema and business types; '+differences.slice(0,8).map(key=>key+': '+names[0]+' = '+(left[key]?show(left[key]):'missing')+', '+name+' = '+(right[key]?show(right[key]):'missing')).join('; '));});}
  const scope:Record<string,Type>={},refs:Record<string,string>={},fields:Record<string,Type>={};
  const sources=names.map((alias,i)=>{
   const a=aliases.get(alias);if(!a)err(n.start,'Unknown source alias '+alias);
   const nullable=i===1&&n.start.name==='left_join';
   scope[alias]=nullable?{kind:'schema',fields:Object.fromEntries(Object.entries(a!.type.fields!).map(([k,t])=>[k,optional(t)]))}:a!.type;
   const columns:Record<string,string>={};
   for(const [name,t]of Object.entries(scope[alias].fields!)){
    const column=joined?'s'+i+'_'+Object.keys(columns).length:name;
    columns[name]=column;if(!existsMode||i===0){refs[alias+'.'+name]=column;fields[column]=t;}
   }
   const binding=p.bindings.get(a!.binding)!;
   return {alias,binding:a!.binding,nullable,fields:columns,ordering:binding.result?.ordering??[]};
  });
  if(joined)bool(n.start.args[1],infer(n.start.args[1],Object.fromEntries(names.map(name=>[name,aliases.get(name)!.type]))));
  if(existsMode)delete scope[names[1]];
  const bounds=sources.map(s=>p.bindings.get(s.binding)!.result?.maxRows);
  const maxRows=existsMode||setOp==='EXCEPT'||setOp==='INTERSECT'?bounds[0]:bounds.every(b=>b!==undefined)?setOp?bounds.reduce<number>((v,b)=>v+b!,0):bounds.reduce<number>((v,b,i)=>v*(sources[i].nullable?Math.max(1,b!):b!),1):undefined;
  const element:Type={kind:'schema',fields};
  let plan:Plan={id:id++,kind:setOp?'set':'source',result:{element,container:'table',maxRows,ordering:joined||setOp?[]:sources[0].ordering},scope:setOp?{out:element}:scope,refs:setOp?Object.fromEntries(Object.keys(fields).map(k=>['out.'+k,k])):refs,sources,join:joined?n.start.args[1]:undefined,setOp,existsMode};
  function orderKeys(ordering:Ordering[],schema:Type,stage:number):Ordering[]{
   return ordering.map((o,i)=>{let key='_dari_'+stage+'_order_'+i;while(Object.hasOwn(schema.fields!,key))key+='_';return {key,direction:o.direction};});
  }
  // Each operator proves its own input contract and returns an explicit output node.
  function node(kind:Plan['kind'],input:Plan,result:ResultContract,extra:Partial<Plan>={}):Plan{
   const stage=id++;return {id:stage,kind,input,result:{...result,ordering:orderKeys(result.ordering,result.element,stage)},scope:input.scope,refs:input.refs,...extra};
  }
  function table(input:Plan,step:Node){if(input.result.container!=='table')err(step,input.result.container==='grouped'?'group_by requires project to define grouped output; duplicate group_by is not allowed':'Table operator requires Table(Schema), got Option(Schema)',{code:'plan-input',reason:input.result.container==='grouped'?'分组计划尚未通过投影确定输出 Schema':'当前计划返回可选单行而不是表',suggestion:input.result.container==='grouped'?'先 project 分组键和聚合值，再进行后续关系处理':'多行处理保留 Table 结果；若只需读取可选单行，用 map_opt 或 tree! 中的 if let Some'});}
  const rules:Record<string,(input:Plan,step:Node)=>Plan>={
   distinct(input,step){table(input,step);if(step.args.length)err(step,'distinct accepts no arguments');return node('distinct',input,{...input.result,ordering:[]});},
   top_per(input,step){
    table(input,step);if(step.args.length<3)err(step,'top_per requires key record, asc/desc ordering terms, and static count');
    const keys=fieldsOf(step.args[0]).map(f=>{if(!key(f.value))err(f,'Partition keys require direct field references');infer(f.value,input.scope);return f.value;});
    if(!keys.length)err(step,'top_per requires at least one partition key');
    const count=step.args.at(-1);if(count.k!=='literal'||!Number.isInteger(count.value)||count.value<1||count.value>MAX_RESULT_ROWS)err(count,'top_per count must be a static integer 1..500');
    const terms=step.args.slice(1,-1);for(const term of terms){if(term.k!=='call'||!['asc','desc'].includes(term.name)||term.args.length!==1)err(term,'top_per ordering requires asc/desc terms');const type=infer(term.args[0],input.scope);if(!['scalar','nominal'].includes(present(type).kind))err(term,'Partition ordering requires logical scalars');ordering(term,type);}
    return node('top',input,{...input.result,ordering:[]},{keys,terms,count:count.value});
   },
   filter(input,step){
    table(input,step);if(step.args.length!==1)err(step,'filter requires one predicate');
    bool(step.args[0],infer(step.args[0],input.scope));
    return node('filter',input,input.result,{predicate:step.args[0]});
   },
   group_by(input,step){
    table(input,step);if(step.args.length!==1||step.args[0].k!=='object')err(step,'group_by requires one key record',{code:'group-by-keys',reason:'输入关系由 |> 提供；group_by 的唯一参数是具名分组键对象',suggestion:'写为 rows |> group_by({key: rows.field}) |> project({...})；全表计数使用 rows |> project({n: count()})'});
    const keys=fieldsOf(step.args[0]).map(f=>{if(!key(f.value))err(f,'Grouping requires direct field references');infer(f.value,input.scope);return f.value;});
    return node('group',input,{...input.result,container:'grouped',ordering:[]},{keys});
   },
   project(input,step){
    if(input.result.container==='option')err(step,'project requires Table(Schema), got Option(Schema)',{code:'table-required',reason:'take_opt() 已将表变为可选单行，不能再作为多行关系计划处理',suggestion:'若还需表处理，保留 take(n) 的 Table 结果；若要展示可选单行，使用 map_opt 或 tree! 中的 if let Some'});
    if(step.args.length!==1)err(step,'project requires one expression');
    const expression=step.args[0],group=input.kind==='group'?input:undefined;
    const grouped=!!group||hasAggregate(expression)||expression.k==='object'&&expression.fields.some((f:Node)=>hasAggregate(f.value));
    const groupKeys=new Set<string>((group?.keys??[]).map(k=>key(k)!));
    const schema=expression.k==='object'?{kind:'schema',fields:Object.fromEntries(settle(fieldsOf(expression),(f:Node)=>{
     const wrapped=f.value.k==='call'&&f.value.name==='not_none';
     if(wrapped&&f.value.args.length!==1)err(f.value,'not_none requires one Option(T) expression');
     const t=infer(wrapped?f.value.args[0]:f.value,input.scope,grouped,groupKeys);
     if(wrapped&&t.kind!=='option')err(f.value,'not_none requires Option(T), got '+show(t));
     return [f.name,wrapped?t.inner!:t];
    }))} as Type:infer(expression,input.scope,grouped,groupKeys);
    if(schema.kind!=='schema'||!['object','ref'].includes(expression.k))err(step,'project requires a Schema row; name each column, e.g. project({value: a.cpu})');
    const fields=expression.k==='object'?fieldsOf(expression):Object.keys(schema.fields!).map(name=>({k:'field',name,value:{k:'ref',path:[...expression.path,name],at:expression.at},at:expression.at}));
    if(!fields.length)err(step,'Empty project is unsupported');
    if(new Set(fields.map(f=>f.name)).size!==fields.length)err(step,'Duplicate projection field');
    const external=new Set(groupKeys);for(const [name,b]of p.bindings)if(!Object.hasOwn(input.scope,name)&&b.type.kind!=='table')external.add(name);
    if(grouped)for(const f of fields)checkGrouped(f.value,false,external);
    for(const [name,t]of Object.entries(schema.fields!))if(!['scalar','nominal'].includes(present(t).kind)||present(t).name==='None')err(step,'Table field '+name+' needs a known logical scalar type');
    return node('project',input,{element:schema,container:'table',maxRows:grouped&&!group?1:input.result.maxRows,ordering:grouped?[]:input.result.ordering},{fields,aggregate:grouped,scope:{out:schema},refs:Object.fromEntries(Object.keys(schema.fields!).map(k=>['out.'+k,k]))});
   },
   order_by(input,step){
    table(input,step);if(input.kind==='order')err(step,'Repeated order_by; combine ordering terms in one order_by');
    if(!step.args.length)err(step,'order_by requires ordering terms');
    const source=input.kind==='project'?input.input!:undefined;
    const env={...source?.scope,...input.scope};
    for(const term of step.args){
     if(term.k!=='call'||!['asc','desc'].includes(term.name)||term.args.length!==1||term.args[0].k!=='ref'||term.args[0].path.length!==2)err(term,'Use asc/desc on a row field');
     ordering(term,infer(term.args[0],env));
     if(source&&input.aggregate&&!Object.hasOwn(input.scope,term.args[0].path[0]))checkGrouped(term.args[0],false,new Set((source.keys??[]).map(k=>key(k)!)));
    }
    return node('order',input,{...input.result,ordering:step.args.map((t:Node)=>({key:'',direction:t.name}))},{terms:step.args});
   },
   take(input,step){return take(input,step,false);},
   take_opt(input,step){return take(input,step,true);}
  };
  function take(input:Plan,step:Node,opt:boolean):Plan{
   table(input,step);let count=1;
   if(opt){if(step.args.length)err(step,'take_opt accepts no arguments');}
   else {const n=step.args[0];if(step.args.length!==1||n.k!=='literal'||!Number.isInteger(n.value)||n.value<1||n.value>MAX_RESULT_ROWS)err(step,'take requires a static integer 1..'+MAX_RESULT_ROWS);count=n.value;}
   if(!input.result.ordering.length&&(input.result.maxRows===undefined||input.result.maxRows>1))err(step,(opt?'take_opt':'take')+' on multiple rows requires order_by',{code:'ordering-required',reason:'多行输入没有已证明的顺序，直接取前 N 行不能确定业务口径',suggestion:'按任务口径为当前具名计划选择排序字段，先 order_by 再 '+(opt?'take_opt()':'take(n)')+'；已有至多一行证明的输入无需排序'});
   return node('take',input,{...input.result,container:opt?'option':'table',maxRows:Math.min(input.result.maxRows??count,count)},{count});
  }
  for(const step of n.steps){const rule=rules[step.name];if(!rule){if(['join','left_join','semi_join','anti_join','union','union_all','intersect','except'].includes(step.name))err(step,step.name+' is supported as a query! starting expression, not after |>');err(step,'Unsupported plan operation '+step.name);}plan=rule(plan,step);}
  if(plan.result.container==='grouped')err(n,'group_by requires project to define grouped output');
  if(joined&&!n.steps.some((step:Node)=>step.name==='project'))err(n,'join requires project to name its output fields');
  const localCalendar=(value:Node):void=>{if(value.calendarFunction)err(value,'Calendar range preparation belongs in a top-level data/do node; pass its scalar endpoints into query!/query_remote!');for(const item of Object.values(value)){if(Array.isArray(item)){for(const child of item)if(child&&typeof child==='object'&&'k'in child)localCalendar(child);}else if(item&&typeof item==='object'&&'k'in item)localCalendar(item as Node);}};
  localCalendar(n);
  return plan;
 }
 function hasAggregate(n:Node):boolean{return n.k==='unary'&&hasAggregate(n.value)||n.k==='call'&&(['count','sum','avg','min','max'].includes(n.name)||n.args.some(hasAggregate))||n.k==='binary'&&(hasAggregate(n.left)||hasAggregate(n.right));}
 function checkGrouped(n:Node,inside:boolean,keys:Set<string>){if(n.k==='unary')checkGrouped(n.value,inside,keys);if(n.k==='ref'&&!inside&&!keys.has(n.path.join('.'))&&!keys.has(n.path[0]))err(n,'Ungrouped column '+expressionHint(n),{code:'ungrouped-column',reason:'聚合投影中的普通字段必须是当前输入的分组键；let 绑定的计划不会修改原始输入',suggestion:'若已定义 let g = rows |> group_by({...})，从 g |> project({...}) 继续，并通过 g 引用分组键；否则先按业务口径声明 group_by，或仅投影聚合值'});if(n.k==='call'){const agg=['count','sum','avg','min','max'].includes(n.name);if(inside&&agg)err(n,'Nested aggregates are unsupported');for(const a of n.args)checkGrouped(a,inside||agg,keys);}if(n.k==='binary'){checkGrouped(n.left,inside,keys);checkGrouped(n.right,inside,keys);}}
 function modelQuery(n:Node,parameters:Node[]):IntentType {
  if(!model)err(n,'query requires a model type/transform adapter');
  const nodes:IntentType['nodes']=[];
  const aliases=new Map<string,number>();
  for(const binding of n.bindings){
   if(binding.name==='out'||aliases.has(binding.name))err(binding,'Duplicate or reserved node alias '+binding.name);
   const call=binding.value;
   if(call.k!=='call'||call.name!=='from'||call.args.length!==1||call.args[0].k!=='ref'||call.args[0].path.length!==1)err(binding,'from requires an exported static Dataset symbol in query_remote!');
   const symbol=call.args[0].path[0],dataset=Object.hasOwn(model!.datasets,symbol)?model!.datasets[symbol]:undefined;
   if(!dataset)return err(call.args[0],'Unknown model Dataset symbol '+symbol);
   const index=nodes.length;aliases.set(binding.name,index);nodes.push({kind:'node',index,id:'node_'+index,dataset});
  }
  let pair:IntentType['pair'];
  if(n.start.k==='call'&&n.start.name==='pair'){
   if(n.start.args.length!==2||n.start.args.some((a:Node)=>a.k!=='ref'||a.path.length!==1||!aliases.has(a.path[0])))err(n.start,'pair requires two bound model nodes');
   pair={left:aliases.get(n.start.args[0].path[0])!,right:aliases.get(n.start.args[1].path[0])!};
   if(pair.left===pair.right)err(n.start,'pair requires two independent model populations');
  }else if(n.start.k!=='ref'||n.start.path.length!==1||!aliases.has(n.start.path[0]))err(n.start,'query must start with a bound model node or pair(left,right)');
  function expression(value:Node,allowNotNone=false):QueryExprType {const result=expressionValue(value,allowNotNone);modelLocations.set(result,value);return result;}
  function expressionValue(value:Node,allowNotNone=false):QueryExprType {
   // Expressions independent of model rows are evaluated locally and sent as typed parameters.
   if(value.k==='call'&&['to_datetime_utc','utc_bucket','calendar_bucket'].includes(value.name)&&!usesNode(value)){
    const type=infer(value);return {kind:'parameter',index:parameters.push(value)-1,type};
   }
   if(value.k==='literal')return {kind:'literal',value:value.value,type:scalar(value.literal)};
   if(value.k==='object'){
    const fields:Record<string,QueryExprType>=Object.create(null);
    settle(value.fields,(field:Node)=>{if(Object.hasOwn(fields,field.name))err(field,'Duplicate projection '+field.name);fields[field.name]=expression(field.value,true);});
    return {kind:'record',fields};
   }
   if(value.k==='ref'){
    const [alias,...path]=value.path;
    if(alias==='out'){if(path.length!==1)err(value,'Use out.field for projected model columns');return {kind:'output',name:path[0]};}
    const index=aliases.get(alias);
    if(index!==undefined){
     if(path.length!==1)err(value,'Use node.member for model dimensions and measures');
     const dataset=nodes[index].dataset,member=Object.hasOwn(dataset.members,path[0])?dataset.members[path[0]]:undefined;
     if(!member)return err(value,'Unknown model member '+expressionHint(value),{code:'unknown-model-member',reason:'该字段不属于当前输入 '+dataset.symbol,suggestion:'使用 oks_info 查看该数据集的成员；若字段属于其他实体，先 connect 已发布的 Relation，再通过目标节点别名引用，不能直接从当前节点读取'});
     if(member.owner!==dataset.id)err(value,'Model member does not belong to its Dataset');
     return {kind:'member',node:index,member};
    }
   }
   if(value.k==='call'&&value.name==='to_datetime_utc'){
    if(value.args.length!==1)err(value,'to_datetime_utc requires one EpochMillis or DateTimeUtc dimension');
    const input=expression(value.args[0]);
    if(input.kind!=='member'||input.member.kind!=='dimension'||!['EpochMillis','DateTimeUtc'].includes(present(input.member.type).semantic??present(input.member.type).name??''))return err(value,'Model to_datetime_utc requires a direct EpochMillis or DateTimeUtc dimension');
    return {kind:'to_datetime_utc',node:input.node,member:input.member};
   }
   if(value.k==='call'&&['utc_bucket','calendar_bucket'].includes(value.name)){
    const zoned=value.name==='calendar_bucket';
    if(value.args.length!==(zoned?3:2))err(value,value.name+' requires a DateTimeUtc dimension, a static CalendarUnit'+(zoned?' and a TimeZone parameter':''));
    const input=expression(value.args[0]),unit=variant(value.args[1]);
    if((input.kind!=='member'&&input.kind!=='to_datetime_utc')||input.member.kind!=='dimension'||input.kind==='member'&&present(input.member.type).name!=='DateTimeUtc')return err(value,'Model utc_bucket requires a DateTimeUtc dimension or to_datetime_utc(EpochMillis dimension)');
    if(unit?.type.name!=='CalendarUnit')err(value.args[1],'utc_bucket requires a static CalendarUnit::Year/Quarter/Month/Week/Day');
    const base={node:input.node,member:input.member,...(input.kind==='to_datetime_utc'?{conversion:true as const}:{}),unit:unit!.name as 'Year'|'Quarter'|'Month'|'Week'|'Day'};
    if(zoned){const zone=expression(value.args[2]);if(zone.kind!=='parameter'||zone.type.kind==='option'||zone.type.name!=='TimeZone')return err(value.args[2],'Model calendar_bucket requires a nonnullable TimeZone parameter');return {kind:'calendar_bucket',...base,timeZone:zone};}
    return {kind:'utc_bucket',...base};
   }
   if(value.k==='call'&&value.name==='not_none'){
    if(!allowNotNone)err(value,'not_none is only allowed at the outermost level of a project field');
    if(value.args.length!==1)err(value,'not_none requires one Option(T) expression');
    const inner=expression(value.args[0]);
    const presence=modelPresence(pair?.left??aliases.get(n.start.path[0])!,pair,steps,nodes.length);
    if(inner.kind!=='member'||inner.member.type.kind!=='option'&&!(inner.member.kind==='dimension'&&presence.get(inner.node)))err(value,'not_none requires an optional direct model member',{code:'not-none-member',reason:'字段必须自身可空，或因可选 Relation 成为可空字段',suggestion:'非空字段直接投影；可选关联字段可在 project 最外层使用 not_none 排除缺失行'});
    return {kind:'call',name:'not_none',args:[inner]};
   }
   if(value.k==='binary'){
    if(['==','!='].includes(value.op)){
     const right=variant(value.right),left=variant(value.left),tag=right??left;
     if(tag){
      const column=expression(right?value.left:value.right);
      if(column.kind==='member'&&column.member.kind==='dimension'){
       if(!same(present(column.member.type),tag.type))return err(value,'Semantic equality requires the same business type; got '+show(column.member.type)+' and '+show(tag.type),{code:'type-mismatch',reason:'raw 编码与语义分类不能混用',suggestion:'比较模型发布的语义计算字段与同类型具名成员；原始字段只与原始类型的值比较'});
       return {kind:'mapped_comparison',node:column.node,member:column.member,logical:tag.type.name!,value:tag.name,op:value.op==='=='?'Eq':'Ne'};
      }
     }
    }
    const left=expression(value.left),right=expression(value.right);
    const exprType=(e:QueryExprType)=>e.kind==='member'?present(e.member.type):e.kind==='parameter'||e.kind==='literal'?present(e.type):undefined;
    const a=exprType(left),b=exprType(right);
    if(a&&b&&(a.codec?.variants||b.codec?.variants)&&!same(a,b))err(value,'Semantic comparison requires the same business type; got '+show(a)+' and '+show(b));
    return {kind:'binary',op:value.op,left,right};
   }
   if(value.k==='unary')return {kind:'unary',op:value.op,value:expression(value.value)};
   if(value.k==='call'&&['difference','ratio','growth_rate','contains','not_contains','starts_with','ends_with','is_some','is_none'].includes(value.name))return {kind:'call',name:value.name,args:value.args.map(expression)};
   function usesNode(v:Node):boolean{return v.k==='ref'&&aliases.has(v.path[0])||v.k==='call'&&v.args.some(usesNode)||v.k==='binary'&&(usesNode(v.left)||usesNode(v.right))||v.k==='unary'&&usesNode(v.value);}
   if(usesNode(value))err(value,'Computed model expression '+(value.name==='unwrap_or'?'unwrap_or!':value.name??value.k)+' cannot be a query parameter; project supported members in query_remote!, then compute this expression in query!');
   const t=infer(value);if(!['scalar','nominal'].includes(present(t).kind))err(value,'Query parameters must be logical scalars');
   return {kind:'parameter',index:parameters.push(value)-1,type:t};
  }
  const steps:QueryOperation[]=[];
  for(const step of n.steps){
   if(step.name==='connect'){
    const [relation,from,to]=step.args;
    if(step.args.length!==3||relation.k!=='ref'||relation.path.length!==1||from.k!=='ref'||from.path.length!==1||to.k!=='ref'||to.path.length!==1)err(step,'connect requires a published Relation symbol and two bound nodes');
    const r=model!.relations?.[relation.path[0]],a=aliases.get(from.path[0]),b=aliases.get(to.path[0]);
    if(!r)err(relation,'Unknown published Relation symbol '+relation.path[0]);
    if(a===undefined||b===undefined)err(step,'connect endpoints must be declared model nodes');
    steps.push({kind:'connect',relation:r!,from:a!,to:b!});
   }else if(['filter','project'].includes(step.name)){
    if(step.args.length!==1)err(step,step.name+' requires one expression');
    steps.push(step.name==='filter'?{kind:'filter',predicate:expression(step.args[0])}:{kind:'project',value:expression(step.args[0])});
   }else if(step.name==='group_by_identity'){
    const value=step.args[0];
    if(step.args.length!==1||value.k!=='ref'||value.path.length!==1||!aliases.has(value.path[0]))err(step,'group_by_identity requires a bound model node');
    steps.push({kind:'group_by_identity',node:aliases.get(value.path[0])!});
   }else if(step.name==='order_by'){
    if(!step.args.length)err(step,'order_by requires an ordering');
    const terms=step.args.map((term:Node)=>{
     if(term.k!=='call'||!['asc','desc'].includes(term.name)||term.args.length!==1)err(term,'Use asc/desc with a model member or projected field');
     return {direction:term.name==='desc'?'Desc' as const:'Asc' as const,value:expression(term.args[0])};
    });
    steps.push({kind:'order_by',terms});
   }else if(step.name==='take_opt'){
    if(step.args.length)err(step,'take_opt accepts no arguments');
    steps.push({kind:'take_opt'});
   }else if(step.name==='take'){
    if(step.args.length!==1||step.args[0].k!=='literal'||!Number.isInteger(step.args[0].value)||step.args[0].value<1||step.args[0].value>MAX_RESULT_ROWS)err(step,'take requires a static integer 1..500');
    steps.push({kind:'take',count:step.args[0].value});
   }else err(step,'Unsupported model query operation '+step.name);
  }
  return {kind:'query',nodes,root:pair?.left??aliases.get(n.start.path[0])!,...(pair?{pair}:{}),steps:steps.map((step,i)=>({...step,id:'step_'+i}))};
 }
 function constant(n:Node|undefined,fields?:Record<string,Type>,path='option'):any{
  if(!n)return err({k:'literal',at:0},'Expected a previously declared static option');
  if(n.k==='literal')return n.value;
  if(n.k==='unary'&&n.op==='-')return -constant(n.value,fields,path);
  // Builtins may probe staticness of dynamic arguments; only presentation options publish findings.
  if(n.k==='object'){const evaluate=(f:Node)=>[f.name,constant(f.value,fields,path+'.'+f.name)];return Object.fromEntries(fields?settle(n.fields,evaluate):n.fields.map(evaluate));}
  if(n.k==='array'){const evaluate=({item,index}:{item:Node;index:number})=>constant(item,fields,path+'['+index+']'),items=n.items.map((item:Node,index:number)=>({item,index}));return fields?settle(items,evaluate):items.map(evaluate);}
  if(n.k==='projection'){if(!fields)return err(n,'$.field requires an input row context');const type=checkedProjection(n,{kind:'schema',fields});if(n.path.length>1)fields[n.path.join('.')]=type;return n.path.join('.');}
  if(n.k==='ref'){
   const v=variant(n);if(v)return Object.freeze({[Symbol.for('dari.enum')]:true,enum:v.type.name,variant:v.name});
   if(failed.has(n.path[0]))throw new UpstreamTypeUnavailable();
   const binding=p.bindings.get(n.path[0]);
   if(!binding)err(n,'Unknown static option '+expressionHint(n)+' in '+path,{code:'static-option',reason:'配置中的裸标识被解释为已声明的静态绑定，不是数据列名',suggestion:fields&&n.path.length===1&&Object.hasOwn(fields,n.path[0])?'字段选择写 $.'+n.path[0]+'；列名配置也可写 '+JSON.stringify(n.path[0]):'文本配置加双引号；字段选择写 $.字段名；静态绑定需先声明'});
   let value=constant(binding!.ast,fields,path);for(const key of n.path.slice(1)){if(value==null||!Object.hasOwn(value,key))err(n,'Unknown static option '+expressionHint(n)+' in '+path);value=value[key];}return value;
  }
  return err(n,'Expected a static presentation or builtin option');
 }
 function configObject(n:Node):Node {
  if(n.k==='ref'&&n.path.length===1){const b=p.bindings.get(n.path[0]);if(b)return configObject(b.ast);}
  return n;
 }
 function timeFormat(n:Node,type:Type,env:Record<string,Type>):{sample:TimeFormat;checked:{date_style?:TimeFormat['date_style'];time_zone?:Node}} {
  n=configObject(n);
  if(n.k!=='object')err(n,'Time format requires {time_zone: TimeZone, date_style: DateStyle::Date}');
  const sample:TimeFormat={},checked:{date_style?:TimeFormat['date_style'];time_zone?:Node}={};
  const seen=new Set<string>();
  for(const f of n.fields){
   if(seen.has(f.name))err(f,'Duplicate time format option '+f.name);seen.add(f.name);
   if(f.name==='time_zone'){
    const zoneType=infer(f.value,env);
    if(semantic(zoneType)!=='TimeZone'||zoneType.kind==='option')err(f.value,'time_zone requires a nonnullable TimeZone; use ctx.tz from context! or a prepared TimeZone value');
    checked.time_zone=f.value;sample.time_zone='UTC';
   }else if(f.name==='date_style'){
    const v=variant(f.value);
    if(v?.type.name!=='DateStyle')err(f.value,'date_style requires DateStyle::Date, DateStyle::DateTime or DateStyle::Time');
    checked.date_style=sample.date_style=v!.name as TimeFormat['date_style'];
   }else err(f,'Unknown time format option '+f.name);
  }
  try{validateTimeFormat(type,sample);}catch(e){err(n,(e as Error).message);}
  return {sample,checked};
 }
 function figureSpec(n:Node,fields:Record<string,Type>,owner:Node,env:Record<string,Type>):Record<string,unknown>{
  const object=configObject(n);
  if(object.k!=='object')return constant(n,fields,owner.name+'.spec');
  const formatFields=object.fields.filter((f:Node)=>f.name==='formats');
  if(formatFields.length>1)err(formatFields[1],'Duplicate presentation option formats');
  const spec=constant({...object,fields:object.fields.filter((f:Node)=>f.name!=='formats')},fields,owner.name+'.spec');
  if(formatFields.length){
   const formats=configObject(formatFields[0].value);if(formats.k!=='object')err(formats,'formats requires field names mapped to time formats');
   const checked:Record<string,unknown>={},samples:Record<string,TimeFormat>={};
   settle(formats.fields,(f:Node)=>{
    if(!Object.hasOwn(fields,f.name))err(f,'Unknown format field '+f.name);
    if(Object.hasOwn(checked,f.name))err(f,'Duplicate format field '+f.name);
    const value=timeFormat(f.value,fields[f.name],env);checked[f.name]=value.checked;samples[f.name]=value.sample;
   });
   owner.checkedTimeFormats=checked;spec.formats=samples;
  }
  return spec;
 }
 function tree(n:Node,env:Record<string,Type>={}):Type{
  if(n.invalid)throw new UpstreamTypeUnavailable();
  if(p.host&&n.name==='ColumnChart')err(n,'Unknown component '+n.name+'; available figure components: '+p.host.components.join(', '));
  const attrs:Record<string,Node>=Object.create(null);for(const a of n.attrs){if(Object.hasOwn(attrs,a.name))err(a,'Duplicate attribute '+a.name);attrs[a.name]=a.value;}
  if(p.host?.components.includes(n.name)){
   if(n.children.length)err(n,'Figure component cannot have children');
   const binding=(key:string)=>{const ref=attrs[key];if(ref?.k!=='ref'||ref.path.length!==1)err(n,key+' requires a Table declaration reference');const b=p.bindings.get(ref.path[0]);if(!b&&failed.has(ref.path[0]))throw new UpstreamTypeUnavailable();if(b?.type.kind!=='table'||b.type.inner?.kind!=='schema')err(n,key+' requires Table(Schema)');return b!;};
   const checkpoint=diagnostics.checkpoint();
   const allowed=['data','nodes','spec',...(attrs.spec?[]:['x','value','series','title','style','layout','allow_no_data','value_min','unit','x_label','value_label','formats','x_axis'])];
   for(const key of Object.keys(attrs))if(!allowed.includes(key))finding(new Fault('Unknown figure attribute '+key+' on '+n.name+'; chart configuration belongs in spec = {...}',attrs[key].at));
   const data=binding('data'),nodes=attrs.nodes?binding('nodes'):undefined,fields={...data.type.inner!.fields!};
   for(const b of [data,...(nodes?[nodes]:[])])if(b.result?.maxRows===undefined||b.result.maxRows>MAX_RESULT_ROWS)finding(new Fault('Figure input '+(b===data?'data':'nodes')+' requires a proven bound <= 500; order_by and take before presentation',n.at));
   const spec=attrs.spec?figureSpec(attrs.spec,fields,n,env):figureSpec({k:'object',at:n.at,fields:Object.entries(attrs).filter(([key])=>!['data','nodes'].includes(key)).map(([name,value])=>({k:'field',name,value,at:value.at}))},fields,n,env);
   try{p.host.checkFigure(n.name,spec,fields,nodes?.type.inner!.fields);}catch(e){finding(new Fault((e as Error).message,attrs.spec?.at??n.at));}
   if(diagnostics.hasErrors(checkpoint))throw new UpstreamTypeUnavailable();
   n.checkedSpec=spec;n.checkedFields=fields;n.checkedPaths=Object.keys(fields).filter(key=>!Object.hasOwn(data.type.inner!.fields!,key)).map(key=>key.split('.'));return {kind:'figure'};
  }
  const signature:Record<string,string[]>={Answer:[],Report:[],section:[],h1:[],h2:[],h3:[],p:[],div:[],span:[],ul:[],ol:[],li:[],blockquote:[],pre:[],code:[],strong:[],em:[],a:['href'],br:[],hr:[],Lit:['value'],UseValue:['ref','precision','format'],Table:['data','spec'],ColumnChart:['data','x','value'],UseReport:['ref']};
  const optionalAttrs=['id','class','title','lang','data-oks-shrink'];
  for(const key of optionalAttrs)if(attrs[key]){if(attrs[key].k!=='literal'||typeof attrs[key].value!=='string')err(attrs[key],key+' requires static text');}
  if(n.name==='a'){if(attrs.href?.k!=='literal'||typeof attrs.href.value!=='string'||! /^(https?:|mailto:|#|\/)/.test(attrs.href.value))err(n,'Link href requires a static http, mailto, fragment or absolute path');}
  if(n.name==='Lit'&&(attrs.value?.k!=='literal'||typeof attrs.value.value!=='string'))err(n,'Lit requires value = "static text"',{code:'literal-text',reason:'Lit 使用具名属性 value 接收静态字符串，表示作者确认这是固定文案',suggestion:'固定文案写 Lit(value = "最近 3 天")；查询结果用 UseValue(ref = ...) 引用；普通文字也可以直接写 "文字"'});
  if(n.name==='UseValue'){
   if(attrs.precision){try{n.checkedPrecision=precision(constant(attrs.precision));}catch(e){err(attrs.precision,(e as Error).message);}}
   if(attrs.ref){
    if(attrs.ref.k!=='ref'||attrs.ref.path.some((key:unknown)=>typeof key!=='string'))err(attrs.ref,'UseValue requires a direct scalar reference',{code:'value-reference',reason:'tree! 只引用已准备好的标量，不执行计算或默认值处理',suggestion:'先用 data prepared = ... 准备结果，再写 UseValue(ref = prepared) 或 UseValue(ref = prepared.field)'});
    const t=infer(attrs.ref,env);let base=t;while(base.kind==='option')base=base.inner!;
    if(!['scalar','nominal'].includes(base.kind))err(attrs.ref,'UseValue requires a logical scalar reference; got '+show(t));
    if(attrs.format)n.checkedTimeFormat=timeFormat(attrs.format,t,env).checked;
   }
  }
  if(!Object.hasOwn(signature,n.name))err(n,'Unknown component '+n.name);for(const a of Object.keys(attrs))if(!signature[n.name].includes(a)&&!optionalAttrs.includes(a))err(n,'Unknown attribute '+a+' on '+n.name);for(const a of signature[n.name])if(!['precision','format'].includes(a)&&!(n.name==='Table'&&a==='spec')&&!attrs[a])err(n,'Missing attribute '+a+' on '+n.name);
  const lookup=(a:string)=>{const v=attrs[a];if(v?.k!=='ref'||v.path.length!==1)err(n,a+' requires a declaration reference');const b=p.bindings.get(v.path[0]);if(!b&&failed.has(v.path[0]))throw new UpstreamTypeUnavailable();if(!b)err(v,'Unknown declaration '+v.path[0]);return b!;};
  if(['Table','ColumnChart'].includes(n.name)){const b=lookup('data');if(b.result?.maxRows===undefined||b.result.maxRows>MAX_RESULT_ROWS)err(n,'Presentation requires a proven bound <= 500; use order_by and take');}
  if(['Table','ColumnChart'].includes(n.name)){const b=lookup('data');if(b.type.kind!=='table'||b.type.inner!.kind!=='schema')err(n,'Expected Schema rows');for(const a of n.name==='ColumnChart'?['x','value']:[]){if(attrs[a].k!=='projection')err(attrs[a],'Use $.field to select a row field');const t=checkedProjection(attrs[a],b.type.inner!);let numeric=present(t);while(numeric.kind==='nominal')numeric=numeric.inner!;if(a==='value'&&!['Int','Float'].includes(numeric.name??''))err(attrs[a],'Chart value must be numeric or a newtype with numeric representation');}}
  if(n.name==='Table'){
   const fields=lookup('data').type.inner!.fields!,spec=attrs.spec?figureSpec(attrs.spec,fields,n,env):{};
   for(const key of Object.keys(spec))if(!['columns','labels','title','precision','allow_no_data','formats'].includes(key))err(n,'Unknown Table option '+key);
   const columns=spec.columns??Object.keys(fields);
   if(!Array.isArray(columns)||columns.some((key:unknown)=>typeof key!=='string'||!Object.hasOwn(fields,key as string)))err(n,'Table columns must reference existing fields');
   if(spec.labels!==undefined&&(!spec.labels||typeof spec.labels!=='object'||Array.isArray(spec.labels)||Object.entries(spec.labels).some(([key,label])=>!Object.hasOwn(fields,key)||typeof label!=='string')))err(n,'Table labels require existing field names and text labels');
   if(spec.allow_no_data!==undefined&&typeof spec.allow_no_data!=='boolean')err(n,'Table allow_no_data requires Bool');
   if(spec.title!==undefined&&typeof spec.title!=='string')err(n,'Table title requires static text');
   if(spec.precision!==undefined)try{precision(spec.precision);}catch(e){err(n,(e as Error).message);}
   n.checkedSpec=spec;n.checkedFields=fields;
  }
  if(n.name==='UseReport'&&lookup('ref').type.kind!=='report')err(n,'UseReport requires report');
  if(['UseValue','Lit','Table','ColumnChart','UseReport','br','hr'].includes(n.name)&&n.children.length)err(n,'Leaf component cannot have children');
  let invalidChild=false;
  function checkChild(c:Node,scope:Record<string,Type>){try{checkChildValue(c,scope);}catch(error){finding(error);invalidChild=true;}}
  function checkChildValue(c:Node,scope:Record<string,Type>){
   if(c.k==='literal'){
    if(typeof c.value==='string'&&/\p{N}/u.test(c.value))p.warnings.push({at:c.at,asset,stage:'type',code:'numeric-text',message:'文本包含数字，请确认是否为查询结果',suggestion:'数据值使用 UseValue(ref = ...) 引用；固定文案使用 Lit(value = '+JSON.stringify(c.value)+') 显式声明'});
    return;
   }
   if(c.k==='iflet'){const t=infer(c.test,scope);if(t.kind!=='option')err(c.test,'if let Some requires Option(T)');const nested={...scope,[c.name]:t.inner!};c.yes.forEach((child:Node)=>checkChild(child,nested));c.no.forEach((child:Node)=>checkChild(child,scope));return;}
   if(c.k==='if'){bool(c.test,infer(c.test,scope));[...c.yes,...c.no].forEach((child:Node)=>checkChild(child,scope));return;}
   if(['Report','Answer'].includes(c.name))err(c,'Declare report separately and reference it with UseReport; Answer is the unique root');
   const t=tree(c,scope);if(!['content','figure'].includes(t.kind))err(c,'Expected inline content or a chart component');
  }
  n.children.forEach((c:Node)=>checkChild(c,env));if(invalidChild)throw new UpstreamTypeUnavailable();
  return{kind:n.name==='Answer'?'answer':n.name==='Report'?'report':n.name==='ColumnChart'?'figure':'content'};
 }
 const syntaxFindings:Fault[]=[];const declarations=parse(source,syntaxFindings);
 for(const e of syntaxFindings)diagnostics.report(faultDiagnostic(e,'syntax'));
 let localId=0;
 for(let declarationIndex=0;declarationIndex<declarations.length;declarationIndex++){
  const d=declarations[declarationIndex];
  asset=d.owner?d.owner+(d.label?' / '+d.label:''):d.name;
  if(d.k==='declaration')d.value=resolvePlanNames(d.value);
  if(d.k==='declaration'&&d.value.k==='query'){
   try{d.value=lowerNodeBindings(d.value,model);}catch(error){finding(error);failed.add(d.name);continue;}
  }
  if(d.k==='declaration'&&hasPlanBindings(d.value)){
   try{const expanded=lowerPlanBindings(d,()=>`@block/${localId++}`,new Set(p.bindings.keys()));declarations.splice(declarationIndex,1,...expanded);declarationIndex--;}
   catch(error){finding(error);failed.add(d.name);}
   continue;
  }
  if(d.k==='invalid'){failed.add(d.name);continue;}
  try{
  if(p.types.has(d.name)||p.bindings.has(d.name))err(d,'Duplicate declaration '+d.name);
  if(d.k==='type'){const t=type(d.value);if(t.kind==='nominal'&&d.value.name==='struct')t.name=d.name;p.types.set(d.name,t);continue;}
  let t:Type,kind='value',plan:Plan|undefined,modelShape:CheckedIntent|undefined;const parameters:Node[]=[];
  if(d.value.k==='context'){
   if(d.declarationKind!=='data')err(d,'context! must directly initialize a top-level data declaration');
   if(p.contextType?.kind!=='schema')err(d,'context! requires a host-provided Schema contract');
   const fields:Record<string,Type>=Object.create(null);
   for(const field of d.value.fields){
    if(Object.hasOwn(fields,field.name))err(field,'Duplicate context field '+field.name);
    const selector=field.value;
    if(selector.k!=='ref'||selector.path.length!==1||!['Context::Now','Context::ClientTz'].includes(selector.path[0]))err(selector,'Context selection requires Context::Now or Context::ClientTz');
    const now=selector.path[0]==='Context::Now',key=now?'epochMillis':'timeZone';
    if(!p.contextType!.fields![key])err(selector,'Host does not provide '+selector.path[0]);
    field.contextKey=key;field.resolvedType=scalar(now?'EpochMillis':'TimeZone');fields[field.name]=field.resolvedType;
   }
   t=d.value.resolvedType={kind:'schema',fields};
  }
  else if(d.value.k==='call'&&d.value.name==='input'){
   if(d.value.args.length!==0)err(d.value,'input() accepts no arguments; declare the input type with data request: Params = input();');
   if(!d.annotation)err(d,'input() requires an explicit Schema type annotation');
   t=type(d.annotation);if(t.kind!=='schema')err(d,'input() annotation must be Schema');
  }
  else if(d.value.k==='call'&&d.value.name==='source'){if(!options.allowTestSources)err(d,'source is a test fixture capability; use model query');if(d.value.args.length!==1||d.value.args[0].k!=='literal'||typeof d.value.args[0].value!=='string'||!d.annotation)err(d,'source requires static name and Table(Schema) annotation');t=type(d.annotation);if(t.kind!=='table'||t.inner!.kind!=='schema')err(d,'source annotation must be Table(Schema)');for(const x of Object.values(t.inner!.fields!))if(!['scalar','nominal','option'].includes(x.kind))err(d,'Physical source fields must be scalar');kind='source';}
  else if(d.value.k==='call'&&d.value.name==='table'){
   if(d.value.args.length!==1||d.value.args[0].k!=='array')err(d,'table requires a finite array of Schema rows');
   const rows=d.value.args[0].items;let element:Type;
   if(d.annotation){const annotated=type(d.annotation);if(annotated.kind!=='table'||annotated.inner?.kind!=='schema')err(d,'table annotation must be Table(Schema)');element=annotated.inner!;}
   else {if(!rows.length)err(d,'Empty table requires an explicit Table(Schema) annotation');element=infer(rows[0]);if(element.kind!=='schema')err(d,'table elements must be Schema rows');}
   for(const row of rows)assign(row,element);
   for(const field of Object.values(element.fields!))if(!['scalar','nominal'].includes(present(field).kind))err(d,'table fields must be logical scalars');
   t={kind:'table',inner:element};kind='literal_table';
  }
  else if(d.value.k==='select'){plan=select(d.value);t={kind:plan.result.container==='option'?'option':'table',inner:plan.result.element};kind='select';}
  else if(d.value.k==='query'){
   if(!model)err(d,'query requires a model type/transform adapter');
   const intent=modelQuery(d.value,parameters);
   const encoded=encodeIntent(intent);
   const expectedProof=proofTarget(intent,model!.contractId,encoded);
   let shape!:CheckedIntent;try{shape=model!.check_type(intent,encoded);}catch(error){throw modelFailure(error,intent,d.value);}
   try{verifyReceipt(shape.receipt,expectedProof);}catch(e){err(d,(e as Error).message);}
   const projection=intent.steps.find(s=>s.kind==='project');
   if(projection?.kind!=='project'||projection.value.kind!=='record')return err(d,'Model query requires a named record projection');
   const expectedFields=Object.entries(projection.value.fields);
   const actualFields=Object.entries(shape.element.fields??{});
   const presence=modelPresence(intent.root,intent.pair,intent.steps,intent.nodes.length);
   if(shape.element.kind!=='schema'||actualFields.length!==expectedFields.length||expectedFields.some(([name,value],i)=>(()=>{const nonnull=value.kind==='call'&&value.name==='not_none',member=nonnull&&value.kind==='call'?value.args[0]:value;if(member.kind!=='member'&&member.kind!=='utc_bucket'&&member.kind!=='calendar_bucket'&&member.kind!=='to_datetime_utc')return true;const base=member.kind==='utc_bucket'||member.kind==='calendar_bucket'||member.kind==='to_datetime_utc'?(member.member.type.kind==='option'?optional(scalar('DateTimeUtc')):scalar('DateTimeUtc')):member.member.type;const expected=nonnull?present(base):member.member.kind==='dimension'&&presence.get(member.node)?optional(base):base;return actualFields[i]?.[0]!==name||!same(actualFields[i][1],expected);})()))err(d,'Model result Schema does not match the authored projection names, business types and nullability');
   const take=intent.steps.find(s=>s.kind==='take'||s.kind==='take_opt');
   if(take?.kind==='take_opt'&&(shape.maxRows===undefined||shape.maxRows>1))err(d,'Model result bound exceeds the authored take_opt');
   const expectedContainer=d.value.steps.at(-1)?.name==='take_opt'?'option':'table';
   if(shape.container!==expectedContainer)err(d,'Model result container does not match the authored query');
   if(take?.kind==='take'&&(shape.maxRows===undefined||shape.maxRows>take.count))err(d,'Model result bound exceeds the authored take('+take.count+')');
   if(shape.element.kind!=='schema'||shape.maxRows!==undefined&&(!Number.isInteger(shape.maxRows)||shape.maxRows<0||shape.maxRows>MAX_RESULT_ROWS))err(d,'Model query must publish a record Schema and valid result bound');
   for(const t of Object.values(shape.element.fields!)){const base=present(t);if(!['scalar','nominal'].includes(base.kind))err(d,'Model columns must be logical scalars');}
   t={kind:shape.container,inner:shape.element};kind='model';modelShape=shape;
  }
  else if(d.value.k==='tree'){t=tree(d.value.root);kind='tree';}
  else t=infer(d.value);
  if(!d.internal){
   const role=d.declarationKind;
   if(role==='data'&&['answer','figure','report','content'].includes(t!.kind))err(d,'data requires a data value; put charts inline in report or answer');
   if(['report','answer'].includes(role)&&(d.value.k!=='tree'||t!.kind!==role))err(d,role+' requires tree! with a '+(role==='answer'?'Answer':role==='report'?'Report':'chart or Table')+' root');
  }
  if(d.annotation){const wanted=type(d.annotation);if(!compatible(wanted,t!))err(d,'Declaration annotation expects '+show(wanted)+'; got '+show(t!),mismatchDetails(wanted,t!));}p.bindings.set(d.name,{internal:!!d.internal,type:t!,ast:d.value,kind,plan,modelPlan:modelShape?.plan,parameters,result:plan?.result??(modelShape?{element:modelShape.element,container:t!.kind==='option'?'option':'table',maxRows:modelShape.maxRows,ordering:[]}:kind==='literal_table'?{element:t!.inner!,container:'table',maxRows:d.value.args[0].items.length,ordering:[]}:kind==='source'?{element:t!.inner!,container:'table',ordering:[]}:undefined)});
  }catch(error){finding(error);if(!p.bindings.has(d.name)&&!p.types.has(d.name))failed.add(d.name);}
 }
 if(diagnostics.hasErrors())throw new DiagnosticFailure(source,diagnostics.list());
 if(p.bindings.get(p.answer)?.type.kind!=='answer')throw new Fault('One answer tree! { Answer [...] }; is required',source.length);return p;
}
