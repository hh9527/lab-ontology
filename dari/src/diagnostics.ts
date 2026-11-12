import {Fault,type FaultDetails} from './syntax.ts';

export type Diagnostic=FaultDetails&{at:number;message:string;stage:'syntax'|'type'|'model'|'runtime';asset?:string};
const publicName=(text:string|undefined)=>text?.replace(/@local\/\d+\/([A-Za-z_][A-Za-z_0-9]*)/g,'$1');
export function faultDiagnostic(error:Fault,stage:Diagnostic['stage'],asset?:string):Diagnostic {
 return {at:error.at,message:publicName(error.message)!,stage,asset:publicName(asset),...error.details,reason:publicName(error.details.reason),suggestion:publicName(error.details.suggestion)};
}
// Same collection contract as DARI: scoped findings, checkpoints, stable deduplication.
export class DiagnosticCollector {
 private entries:Diagnostic[]=[];
 report(d:Diagnostic){this.entries.push(d);}
 checkpoint(){return this.entries.length;}
 hasErrors(since=0){return this.entries.length>since;}
 list(){return [...new Map(this.entries.map(d=>[JSON.stringify([d.at,d.message,d.stage,d.asset]),d])).values()].sort((a,b)=>a.at-b.at||a.message.localeCompare(b.message));}
}
export class UpstreamTypeUnavailable extends Error {}
export function repairSuggestion(message:string):string|undefined {
 if(/Node attributes use|Expected =, got :/.test(message))return 'tree! 节点属性使用 =，例如 Value(value = prepared)，对象字段才使用冒号';
 if(/Unknown (?:field|model member)/.test(message))return '使用该输入 Schema 中列出的字段；模型成员的精确符号可从 oks_info 获取';
 if(/Unknown binding out/.test(message))return '首次 project 使用输入别名；结果显式绑定，例如 let output = project({value:a.value}); output |> order_by(asc(output.value))';
 if(/Predicate requires Bool; got Option\(Bool\)/.test(message))return '条件可能为空；若空值按不满足处理，使用 coalesce(condition, False)';
 if(/case_when requires/.test(message))return 'case_when(condition, thenValue, elseValue) 恰好接受三个参数；多个分支嵌套在 elseValue 中，标签查表也可用 lookup';
 if(/Unknown built-in from|Expected ;, got \|>/.test(message))return '数据流水线写在 query! { let r = from(rows); r |> project({...}) } 中';
 if(/supported as a query! starting expression/.test(message))return '在 query! 中先 let a = from(left); let b = from(right); 然后以 join({a,b}, a.key == b.key) 或 semi_join({a,b}, a.key == b.key) 起手，再 |> project({...})；集合运算以 intersect({a,b}) 等起手，不放在 |> 后';
 if(/Set inputs must/.test(message))return '按列出的输入、字段和类型差异修正；统一字段业务类型及可空性，保留需要的指标，不靠删除输入来绕过错误';
 if(/Unknown (?:binding|declaration|type)/.test(message))return '核对名称与大小写，并将定义放在使用它的声明之前';
 if(/Unknown (?:figure )?attribute/.test(message))return '核对组件支持的属性；图表配置写在 spec = {...} 中';
 if(/requires.*order_by|requires an ordering|on multiple rows requires/.test(message))return '先依据业务口径选择排序字段，用当前计划的具名绑定声明 order_by，再 take(n)；不要依赖数据库默认行序';
 if(/proven bound|terminal take/.test(message))return '在交付前通过 order_by(...) |> take(n) 证明上界，n 为 1..500；中间计划可继续在 query! 中处理，不要提前截断参与计算的数据';
 if(/stack requires Stack::/.test(message))return 'stack 使用 Stack::None、Stack::Total 或 Stack::Percent，按需要选择并列、原值堆叠或构成比堆叠';
 if(/Stacking requires an additive|does not allow Sum/.test(message))return '堆叠使用允许 Sum 的同类指标；同一指标只需并列时选择 GroupedBarChart，不同指标并列时选择 MultiBarChart，保留业务类型';
 if(/precision requires/.test(message))return 'precision 使用 0..12 的静态整数；它只改变展示，不改变原始数据精度';
 if(/allow_no_data|图表没有数据/.test(message))return '先核对筛选口径；若业务允许无数据，显式设置 spec.allow_no_data: True，否则保留错误，不填造占位数据';
 if(/Use project!/.test(message))return '字段选择写为 project!(field)，不使用字符串或匿名函数';
 if(/Unknown component/.test(message))return '核对组件名称与大小写；扩展组件使用 PascalCase，普通标签使用小写';
 return undefined;
}
export function renderDiagnostics(source:string,diagnostics:Diagnostic[],status='CheckFailed'):string {
 const lines=[status,'-'.repeat(status.length),'','## diagnostics'];
 for(const d of diagnostics.slice(0,20)){
  const prefix=source.slice(0,d.at),line=prefix.split('\n').length,column=d.at-prefix.lastIndexOf('\n');
  lines.push('- L'+line+':'+column+(d.asset?' ['+d.asset+']':'')+': '+d.message.replace(/[\r\n]+/g,' '));
  if(d.reason)lines.push('  原因：'+d.reason.replace(/[\r\n]+/g,' '));
  const suggestion=d.suggestion??repairSuggestion(d.message);if(suggestion)lines.push('  修复建议：'+suggestion);
 }
 if(diagnostics.length>20)lines.push('- 另有 '+(diagnostics.length-20)+' 条错误未列出；修复上述错误后再次检查');
 return lines.join('\n');
}
export class DiagnosticFailure extends Fault {
 diagnostics:Diagnostic[];
 constructor(source:string,diagnostics:Diagnostic[]){super(renderDiagnostics(source,diagnostics),diagnostics[0]?.at??0);this.diagnostics=diagnostics;}
}
// Model diagnostics are data internally; only their messages belong in the public receipt.
export function modelErrorText(value:unknown):string {
 if(typeof value==='string'){try{return modelErrorText(JSON.parse(value));}catch{return value;}}
 if(Array.isArray(value))return value.map(modelErrorText).filter(Boolean).join('; ');
 if(value&&typeof value==='object'){
  const v=value as Record<string,any>;
  if(v.diagnostics)return modelErrorText(v.diagnostics);
  if(typeof v.message==='string')return v.message;
  if(v.error)return modelErrorText(v.error);
 }
 return 'Model query validation failed';
}
