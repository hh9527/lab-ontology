export type Node = {k:string;at:number;[key:string]:any};
export type Token = {text:string;at:number;kind:string};
export type FaultDetails={code?:string;reason?:string;suggestion?:string;stage?:'syntax'|'type'|'model'|'runtime'};
export class Fault extends Error {
 at:number;line?:number;column?:number;details:FaultDetails;
 constructor(message:string,at:number,details:FaultDetails={}){super(message);this.at=at;this.details=details;}
 locate(source:string){if(this.line!==undefined)return this;const prefix=source.slice(0,this.at);this.line=prefix.split('\n').length;this.column=this.at-(prefix.lastIndexOf('\n')+1)+1;this.message='L'+this.line+':'+this.column+': '+this.message;return this;}
}
export function parse(source:string,findings?:Fault[]):Node[]{
 const ts:Token[]=[];const re=/\s+|#[^\n]*|"(?:\\.|[^"\\])*"|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z_0-9]*|::|\|>|==|!=|<=|>=|&&|\|\||[{}()[\],;:.$?=<>!&+*/%-]/gy;
 let offset=0;while(offset<source.length){re.lastIndex=offset;const m=re.exec(source);if(!m)throw new Fault('Unexpected character',offset);offset=re.lastIndex;const text=m[0];if(/^\s|^#/.test(text))continue;ts.push({text,at:m.index,kind:text[0]==='"'?'string':/^\d/.test(text)?'number':/^[A-Za-z_]/.test(text)?'id':'symbol'});}ts.push({text:'<eof>',at:source.length,kind:'end'});
 let pos=0;const peek=()=>ts[pos].text;const take=()=>ts[pos++];const is=(v:string)=>peek()===v;const eat=(v:string)=>is(v)?(take(),true):false;const need=(v:string)=>{if(!eat(v))throw new Fault('Expected '+v+', got '+peek(),ts[pos].at);};const ident=()=>{const t=take();if(t.kind!=='id')throw new Fault('Expected identifier',t.at);return t.text;};
 const object=()=>{const at=ts[pos].at;need('{');const fields:Node[]=[];while(!is('}')){const t=take();if(!['id','string'].includes(t.kind))throw new Fault('Expected field name',t.at);const name=t.kind==='string'?JSON.parse(t.text):t.text;const value=eat(':')?expr():{k:'ref',path:[name],at:t.at};fields.push({k:'field',name,value,at:t.at});if(!eat(','))break;}need('}');return{k:'object',fields,at};};
 const list=(end:string,read:()=>Node)=>{const items:Node[]=[];while(!is(end)){items.push(read());if(!eat(','))break;}need(end);return items;};
 function type():Node{let t=typeAtom();while(eat('&'))t={k:'intersect',left:t,right:typeAtom(),at:t.at};return t;}
 function typeAtom():Node{const at=ts[pos].at;let name=ident();while(eat('::'))name+='::'+ident();if(!eat('('))return{k:'type',name,at};if(name==='Schema'){const fields:Node[]=[];need('{');while(!is('}')){const f=take();if(!['id','string'].includes(f.kind))throw new Fault('Expected schema field',f.at);need(':');fields.push({k:'field',name:f.kind==='string'?JSON.parse(f.text):f.text,value:type(),at:f.at});if(!eat(','))break;}need('}');need(')');return{k:'schema',fields,at};}const inner=type();need(')');return{k:'type',name,inner,at};}
 const precedence:Record<string,number>={'||':1,'&&':2,'==':3,'!=':3,'<':4,'>':4,'<=':4,'>=':4,'+':5,'-':5,'*':6,'/':6,'%':6};
 function expr(min=0):Node{let n=atom();while(precedence[peek()]!==undefined&&precedence[peek()]>=min){const op=take().text;n={k:'binary',op,left:n,right:expr(precedence[op]+1),at:n.at};}return n;}
 function atom():Node{let value=primary();while(eat('.')){const macro=take();if(!['as','unwrap_or'].includes(macro.text)||!eat('!'))throw new Fault('Unknown postfix macro '+macro.text,macro.at);need('(');if(macro.text==='as'){const name=ident();need(')');value={k:'alias',value,name,at:macro.at};}else value={k:'call',name:'unwrap_or',args:[value,...list(')',()=>expr())],at:macro.at};}return value;}
 function primary():Node{const t=ts[pos];if(eat('$')){need('.');const segment=()=>{const key=ident();return key+(eat('?')?'?':'');};const path=[segment()];while(is('.')&&ts[pos+2]?.text!=='!'){take();path.push(segment());}return{k:'projection',path,at:t.at};}if(eat('-'))return{k:'unary',op:'-',value:atom(),at:t.at};if(t.kind==='string'||t.kind==='number'){take();return{k:'literal',value:JSON.parse(t.text),literal:t.kind==='number'?(t.text.includes('.')?'Float':'Int'):'String',at:t.at};}if(eat('True'))return{k:'literal',value:true,literal:'Bool',at:t.at};if(eat('False'))return{k:'literal',value:false,literal:'Bool',at:t.at};if(eat('None'))return{k:'literal',value:null,literal:'None',at:t.at};if(is('{'))return object();if(eat('['))return{k:'array',items:list(']',()=>expr()),at:t.at};if(eat('(')){const v=expr();need(')');return v;}if(eat('do')){need('{');const bindings:Node[]=[];while(eat('let')){const at=ts[pos].at,name=ident();need('=');const value=expr();need(';');bindings.push({k:'let',name,value,at});}const result=expr();eat(';');need('}');return{k:'do',bindings,result,at:t.at};}let name=ident();while(eat('::'))name+='::'+ident();if(name==='query'&&is('{'))throw new Fault('Use query! { ... } for relational plans',t.at);if(name==='query_remote'&&is('{'))throw new Fault('Use query_remote! { ... } for model acquisition',t.at);if(eat('!')){if(name==='unwrap_or'){need('(');return{k:'call',name,args:list(')',()=>expr()),at:t.at};}if(name==='query')return select(t.at);if(name==='query_remote'){const block=select(t.at);block.k='query';return block;}if(name==='context'){const selection=object();return{k:'context',fields:selection.fields,at:t.at};}if(name==='time_context'||name==='tz_context')throw new Fault('Use context! { now: Context::Now, tz: Context::ClientTz }',t.at);if(name==='tree'){need('{');const root=treeNode();need('}');return{k:'tree',root,at:t.at};}throw new Fault('Unknown macro '+name,t.at);}if(name==='query'&&is('('))throw new Fault('Use query! { ... } for relational plans',t.at);if(['context','time_context','query_remote'].includes(name)&&is('('))throw new Fault('Use '+(name!=='query_remote'?'context! { now: Context::Now }':'query_remote! { ... }')+' for acquisition',t.at);if(name==='unwrap_or'&&is('('))throw new Fault('unwrap_or! requires macro syntax',t.at);if(eat('('))return{k:'call',name,args:list(')',()=>expr()),at:t.at};const path:any[]=[name];while(true){if(is('.')&&ts[pos+2]?.text==='!')break;else if(eat('.'))path.push(ident());else if(is('[')&&ts[pos+1]?.kind==='number'&&ts[pos+2]?.text===']'){take();const key=take();if(key.kind!=='number'||!Number.isSafeInteger(Number(key.text)))throw new Fault('Array index must be a static nonnegative integer',key.at);path.push(Number(key.text));need(']');}else break;}return{k:'ref',path,at:t.at};}
 function select(at:number):Node{need('{');const bindings:Node[]=[];while(eat('let')){const name=ident();need('=');const start=expr(),steps:Node[]=[];while(eat('|>')){const step=expr();if(step.k!=='call'&&step.k!=='alias')throw new Fault('Pipeline step requires a built-in operation',step.at);steps.push(step);}const value=steps.length?{k:'pipeline',start,steps,at:start.at}:start;need(';');bindings.push({k:'let',name,value,at:start.at});}const start=expr(),steps:Node[]=[];while(eat('|>')){const step=expr();if(step.k!=='call'&&step.k!=='alias')throw new Fault('Pipeline step requires a built-in operation',step.at);steps.push(step);}eat(';');need('}');return{k:'select',bindings,start,steps,at};}
 function children():Node[]{need('[');const result:Node[]=[];while(!is(']')){result.push(is('if')?condition():ts[pos].kind==='string'?expr():treeNode());if(!eat(','))break;}need(']');return result;}
 function condition():Node{const at=take().at;if(eat('let')){need('Some');need('(');const name=ident();need(')');need('=');const test=expr(),yes=children();need('else');const no=children();return{k:'iflet',name,test,yes,no,at};}const test=expr();const yes=children();need('else');const no=children();return{k:'if',test,yes,no,at};}
 function report(error:unknown){if(!(error instanceof Fault)||!findings)throw error;findings.push(error);}
 function skipAttributes(open:number){let depth=0;for(let i=open;i<ts.length;i++){if(ts[i].text==='(')depth++;else if(ts[i].text===')'&&--depth===0){pos=i+1;return true;}}return false;}
 function nextDeclaration(start:number){
  const stack:string[]=[];const closes:Record<string,string>={')':'(',']':'[','}':'{'};
  for(let i=start;i<ts.length-1;i++){
   const text=ts[i].text;
   if(i>start&&['data','report','answer','type'].includes(text)&&(ts[i-1].text===';'||source.slice(ts[i-1].at+ts[i-1].text.length,ts[i].at).includes('\n'))){pos=i;return;}
   if(['(','[','{'].includes(text))stack.push(text);else if(closes[text]===stack.at(-1))stack.pop();
   if(text===';'&&!stack.length){pos=i+1;return;}
  }
  pos=ts.length-1;
 }
 function treeNode():Node{
  const t=ts[pos],name=ident(),attrs:Node[]=[];let invalid=false;
  const litDetails={code:'literal-text',suggestion:'固定文案写 Lit(value = "最近 3 天")；查询结果用 UseValue(ref = ...) 引用；普通文字可直接作为子节点写 "文字"'};
  if(name==='Lit'&&ts[pos].kind==='string')throw new Fault('Lit requires named attribute value',ts[pos].at,litDetails);
  if(is('(')){
   const open=pos;
   try{take();while(!is(')')){const a=take();if(a.kind!=='id')throw new Fault('Expected attribute name',a.at);if(is(':'))throw new Fault('Node attributes use "=", not ":"; write '+name+'('+a.text+' = ...)',ts[pos].at);need('=');const start=ts[pos].at,value=expr(),end=ts[pos-1];attrs.push({k:'field',name:a.text,value,sourceText:source.slice(start,end.at+end.text.length),at:a.at});if(!eat(','))break;}need(')');}
   catch(error){if(error instanceof Fault&&name==='Lit'&&error.message==='Expected attribute name')error.details=litDetails;if(!findings||!(error instanceof Fault)||!skipAttributes(open))throw error;report(error);attrs.length=0;invalid=true;}
  }
  const nodes=is('[')?children():[];return{k:'element',name,attrs,children:nodes,invalid,at:t.at};
 }
 const declarations:Node[]=[];
 while(!is('<eof>')){
  const start=pos;let name:string|undefined;
  try{const t=take();if(!['type','data','report','answer'].includes(t.text))throw new Fault('Use type, data, report or answer declarations',t.at);name=t.text==='answer'?'answer':ident();const annotation=t.text==='data'&&eat(':')?type():undefined;if(t.text==='answer'&&is('='))throw new Fault('Use answer tree! { Answer [...] }; without =',ts[pos].at);if(t.text!=='answer')need('=');const value=t.text==='type'?type():expr();need(';');declarations.push({k:t.text==='type'?'type':'declaration',declarationKind:t.text,name,value,annotation,at:t.at});}
  catch(error){report(error);if(name)declarations.push({k:'invalid',name,at:ts[start].at});nextDeclaration(start);}
 }
 return declarations;
}
