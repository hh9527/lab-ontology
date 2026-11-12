import {infoContracts} from './info-contract.ts';
// JSONL language host. Source remains a declarative plan, never executable JS.
import {createInterface} from 'node:readline';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {check,show,type Program,type Type} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {openModel} from './model-bridge.ts';
import {renderDiagnostics} from './src/diagnostics.ts';
import {pathToFileURL} from 'node:url';
import type {HostPort} from './src/host.ts';

const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
// Start buffering requests before asynchronous model/renderer initialization.
const requests=lines[Symbol.asyncIterator]();
const [artifact,runner,database,hostModule]=process.argv.slice(2);
const presentation:HostPort|undefined=hostModule?(await import(pathToFileURL(hostModule).href)).dariHost:undefined;
const host=await openModel(artifact,runner);
const scalar=(name:string):Type=>({kind:'scalar',name});
const contextType:Type={kind:'schema',fields:{now:scalar('DateTimeUtc'),epochMillis:scalar('EpochMillis'),timeZone:{kind:'option',inner:scalar('String')}}};
const programs=new Map<string,Program>();
try{
 for await(const line of requests){
  let id:unknown;
  try{
   const request=JSON.parse(line);id=request.id;let result:unknown;
   if(request.method==='info_contracts'){
    result=infoContracts(host.model,request.points);
   }else if(['check','resolve'].includes(request.method)){
    if(typeof request.source!=='string'||Buffer.byteLength(request.source)>262144)throw Error('Expected source up to 256 KiB');
    const key=createHash('sha256').update(request.source).digest('hex');let p=programs.get(key);
    if(!p){p=check(request.source,host.model,{contextType,contextContractId:'dari-context/v2',host:presentation});if(programs.size>=8)programs.delete(programs.keys().next().value!);programs.set(key,p);}
    if(request.method==='check')result={types:[...p.bindings].filter(([,b])=>!b.internal).map(([name,b])=>({name,type:show(b.type)})),warnings:p.warnings.length?renderDiagnostics(p.source,p.warnings,'Warnings'):undefined};
    else{
     const db=new DatabaseSync(database,{readOnly:true});
     try{const run=resolve(p,db,request.inputs??{},{context:request.context,contextContractId:request.contextContractId});result={answer:run.answer,artifacts:run.artifacts,queries:run.queries};}finally{db.close();}
    }
   }else throw Error('Unknown DARI service method');
   process.stdout.write(JSON.stringify({id,result})+'\n');
  }catch(e){process.stdout.write(JSON.stringify({id,error:e instanceof Error?e.message:String(e)})+'\n');}
 }
}finally{await host.close();}
