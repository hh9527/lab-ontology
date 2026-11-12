import {Fault,type Node} from './syntax.ts';
import type {ModelPort,DatasetSymbol} from './model.ts';

// Postfix bindings name nodes, while the expression continues to carry a plan.
// Lower to the same explicit endpoints consumed by the model proof ABI.
export function lowerNodeBindings(block:Node,model?:ModelPort):Node {
 if(block.k!=='query')return block;
 const contains=(n:Node):boolean=>n.k==='alias'||Object.values(n).some(v=>Array.isArray(v)?v.some(x=>x&&typeof x==='object'&&'k'in x&&contains(x)):v&&typeof v==='object'&&'k'in v&&contains(v as Node));
 if(!contains(block))return block;
 const fail=(n:Node,message:string):never=>{throw new Fault(message,n.at);};
 const names=new Set(block.bindings.map((b:Node)=>b.name)),nodes:Node[]=[],datasets=new Map<string,DatasetSymbol>(),currents=new Map<string,string>();
 let next=0;
 const ref=(name:string,at:number):Node=>({k:'ref',path:[name],at});
 function add(name:string,dataset:DatasetSymbol,at:number){
  if(name==='out'||names.has(name))fail(block,'Duplicate or reserved node binding '+name);
  names.add(name);datasets.set(name,dataset);currents.set(name,name);
  nodes.push({k:'let',name,value:{k:'call',name:'from',args:[ref(dataset.symbol,at)],at},at});
 }
 function dataset(call:Node):DatasetSymbol{
  const arg=call.args[0];
  if(call.args.length!==1||arg.k!=='ref'||arg.path.length!==1||!model||!Object.hasOwn(model.datasets,arg.path[0]))return fail(call,'from requires a published Dataset symbol');
  return model.datasets[arg.path[0]];
 }
 function chain(start:Node,steps:Node[]){
  const bound=start.k==='alias'?start:undefined,first=bound?.value??start;
  let current:string,root:Node;
  if(first.k==='call'&&first.name==='from'){
   current=bound?.name??'__node_'+next++;add(current,dataset(first),first.at);root=ref(current,first.at);
  }else if(first.k==='ref'&&first.path.length===1&&currents.has(first.path[0])){
   root=bound??first;current=currents.get(first.path[0])!;
  }else {
   root=bound??first;current='';
  }
  if(bound&&current)currents.set(bound.name,current);
  const result:Node[]=[];
  for(const wrapped of steps){
   const binding=wrapped.k==='alias'?wrapped:undefined,step=binding?.value??wrapped;
   if(step.k!=='call')fail(step,'Expected a plan operation');
   if(step.name!=='connect'){
    result.push(wrapped);if(step.name==='project')current='';
    if(binding&&current)currents.set(binding.name,current);
    continue;
   }
   if(step.args.length!==1)fail(step,'Use connect(Relation).as!(peer) when traversing from the current node');
   const symbol=step.args[0],relation=symbol.k==='ref'&&symbol.path.length===1?model?.relations?.[symbol.path[0]]:undefined;
   if(!relation)fail(step,'connect requires a published Relation symbol');
   const source=datasets.get(current);
   if(!source)fail(step,'connect requires a current model node before projection');
   if(relation!.from===relation!.to)fail(step,'Self Relation requires explicit endpoint nodes and direction');
   const forward=relation!.from===source!.id;
   if(!forward&&relation!.to!==source!.id)fail(step,'Relation does not connect the current Dataset '+source!.symbol);
   const peerId=forward?relation!.to:relation!.from;
   const peers=Object.values(model!.datasets).filter(d=>d.id===peerId);
   if(peers.length!==1)fail(step,'Relation peer must resolve to exactly one published Dataset');
   const peer=binding?.name??'__node_'+next++;add(peer,peers[0],step.at);
   const from=ref(forward?current:peer,step.at),to=ref(forward?peer:current,step.at);
   result.push({...step,args:[symbol,from,to]});current=peer;
  }
  return {start:root,steps:result,current};
 }
 const bindings:Node[]=[];
 for(const binding of block.bindings){
  if(binding.value.k==='call'&&binding.value.name==='from'){
   datasets.set(binding.name,dataset(binding.value));currents.set(binding.name,binding.name);bindings.push(binding);continue;
  }
  const value=binding.value;
  const part=chain(value.k==='pipeline'?value.start:value,value.k==='pipeline'?value.steps:[]);
  currents.set(binding.name,part.current);
  bindings.push({...binding,value:part.steps.length?{k:'pipeline',start:part.start,steps:part.steps,at:value.at}:part.start});
 }
 const final=chain(block.start,block.steps);
 return {...block,bindings:[...nodes,...bindings],start:final.start,steps:final.steps};
}
