import {same,present,optional,type Type} from './src/compiler.ts';
import {proofTarget,type EncodedIntent} from './src/model.ts';
import {MAX_RESULT_ROWS} from './src/plan.ts';
import {storage,type DatasetSymbol,type MemberSymbol,type ModelPort,type IntentType,type QueryExprType,type ResultColumn} from './src/model.ts';

// Small executable model fixture, not an IC exporter or a complete Graph transform.
export function createFixtureModel(){
    const string:Type={kind:'scalar',name:'String'},number:Type={kind:'scalar',name:'Float'};
    const deviceId:Type={kind:'nominal',name:'ic::DeviceId',inner:string};
    const tenantId:Type={kind:'nominal',name:'ic::TenantId',inner:string};
    const dataset:DatasetSymbol={kind:'dataset',id:'fixture/device_kpi',symbol:'ic::DeviceKpi',members:{
        device_id:{symbol:'device_id',kind:'dimension',id:'device_id',owner:'fixture/device_kpi',type:deviceId},
        name:{symbol:'name',kind:'dimension',id:'name',owner:'fixture/device_kpi',type:string},
        tenant_id:{symbol:'tenant_id',kind:'dimension',id:'tenant_id',owner:'fixture/device_kpi',type:tenantId},
        cpu_usage:{symbol:'cpu_usage',kind:'measure',id:'cpu_usage',owner:'fixture/device_kpi',type:optional(number)}
    }};
    const stats={checks:0,bindings:0};
    type Slot={kind:'literal';value:any}|{kind:'parameter';index:number;type:Type};
    type Prepared={sql:string;slots:Slot[];columns:ResultColumn[];max_rows?:number};
    const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
    function fail(message:string):never{throw Error(message);}
    const model:ModelPort={
        contractId:'dari-fixture-v2',
        implementationId:'dari-fixture-implementation-v2',
        types:{'ic::DeviceId':deviceId,'ic::TenantId':tenantId},
        datasets:{'ic::DeviceKpi':dataset},
        check_type(intent:IntentType,encoded:EncodedIntent){
            stats.checks++;
            if(intent.nodes.length!==1||intent.root!==0||intent.nodes[0].dataset!==dataset)fail('Fixture model supports one DeviceKpi node');
            const output:Record<string,QueryExprType>=Object.create(null);
            const fields:Record<string,Type>=Object.create(null);
            const slots:Slot[]=[];
            let filter:QueryExprType|undefined;
            let order:{direction:'Asc'|'Desc';value:QueryExprType}[]=[];
            let take:number|undefined,projected=false,ordered=false;
            const consumed=new Set<string>();
            function member(e:QueryExprType):MemberSymbol{
                if(e.kind!=='member'||e.node!==0||!Object.values(dataset.members).includes(e.member))fail('Model member is outside the query node');
                return e.member;
            }
            function outputRef(e:QueryExprType):QueryExprType{
                if(e.kind!=='output')return e;
                return output[e.name]??fail('Unknown projected model field '+e.name);
            }
            function type(e:QueryExprType):Type{
                e=outputRef(e);
                if(e.kind==='member')return member(e).type;
                if(e.kind==='literal'||e.kind==='parameter')return e.type;
                if(e.kind==='binary'){
                    if(!['>','>=','<','<=','==','!='].includes(e.op))fail('Unsupported model operator '+e.op);
                    const left=type(e.left),right=type(e.right),a=present(left),b=present(right);
                    const numeric=['Int','Float'].includes(a.name??'')&&['Int','Float'].includes(b.name??'');
                    if(!same(a,b)&&!numeric)fail('Model predicate compares incompatible business types');
                    if(!['Int','Float'].includes(a.name??'')&&!['==','!='].includes(e.op))fail('Model type does not allow ordered comparison');
                    if(right.kind==='option'||left.kind==='option'&&!(e.left.kind==='member'&&e.left.member.kind==='measure'))fail('Fixture predicates require a nonnullable threshold');
                    return {kind:'scalar',name:'Bool'};
                }
                return fail('Unsupported model expression '+e.kind);
            }
            for(const step of intent.steps){
                if(!step.id||consumed.has(step.id))fail('step identity must be nonempty and unique');
                if(take!==undefined)fail('take is terminal in a model query');
                if(step.kind==='filter'){
                    if(filter||projected)fail('Fixture supports one filter before project');
                    if(type(step.predicate).name!=='Bool')fail('Model filter requires Bool');
                    filter=step.predicate;
                }else if(step.kind==='project'){
                    if(projected||step.value.kind!=='record'||!Object.keys(step.value.fields).length)fail('Model projection requires a nonempty record');
                    for(const [name,e]of Object.entries(step.value.fields)){
                        member(e); // The fixture projects declared members; the full model defines further abilities.
                        output[name]=e;fields[name]=type(e);
                    }
                    projected=true;
                }else if(step.kind==='order_by'){
                    if(!projected||ordered||!step.terms.length)fail('Model ordering requires a projection');
                    for(const term of step.terms){member(outputRef(term.value));type(term.value);}
                    order=step.terms;ordered=true;
                }else if(step.kind==='take'||step.kind==='take_opt'){
                    const count=step.kind==='take_opt'?1:step.count;
                    if((!ordered&&!Object.values(output).every(e=>member(e).kind==='measure'))||!Number.isInteger(count)||count<1||count>MAX_RESULT_ROWS)fail('Model query requires order_by and a static take <= 500');
                    take=count;
                }else fail('Unsupported model operation '+(step as {kind:string}).kind);
                consumed.add(step.id);
            }
            if(!projected)fail('Model query requires a projection');
            function hasMeasure(e:QueryExprType):boolean{
                e=outputRef(e);
                return e.kind==='member'?member(e).kind==='measure':e.kind==='binary'&&(hasMeasure(e.left)||hasMeasure(e.right));
            }
            function sql(e:QueryExprType):string{
                e=outputRef(e);
                if(e.kind==='member'){
                    const m=member(e);
                    const mapping:Record<string,string>={device_id:'"id"',name:'"name"',tenant_id:'"tenant"',cpu_usage:'AVG("cpu")'};
                    return mapping[m.id];
                }
                if(e.kind==='literal'||e.kind==='parameter'){slots.push(e);return '?';}
                if(e.kind==='binary')return '('+sql(e.left)+' '+({'==':'=','!=':'<>'}[e.op]??e.op)+' '+sql(e.right)+')';
                return fail('Unsupported SQL expression');
            }
            const aggregate=Object.values(output).some(hasMeasure)||!!filter&&hasMeasure(filter)||order.some(term=>hasMeasure(term.value));
            let text='SELECT '+Object.entries(output).map(([name,e])=>sql(e)+' AS '+quote(name)).join(', ')+' FROM "devices"';
            if(filter&&!hasMeasure(filter))text+=' WHERE '+sql(filter);
            const dimensions=Object.values(output).filter(e=>member(e).kind==='dimension');
            if(aggregate&&dimensions.length)text+=' GROUP BY '+[...new Set(dimensions.map(sql))].join(', ');
            if(filter&&hasMeasure(filter))text+=' HAVING '+sql(filter);
            for(const term of order)if(aggregate&&member(outputRef(term.value)).kind==='dimension'&&!dimensions.includes(outputRef(term.value))) {
                const id=member(outputRef(term.value)).id;
                if(!dimensions.some(e=>member(e).id===id))fail('Model ordering uses an ungrouped dimension');
            }
            if(order.length)text+=' ORDER BY '+order.map(term=>sql(term.value)+' '+term.direction.toUpperCase()).join(', ');
            if(take!==undefined)text+=' LIMIT '+take;
            const maxRows=aggregate&&!dimensions.length?1:take;
            if(aggregate&&!dimensions.length)for(const [name,e]of Object.entries(output)) {
                if(member(e).kind==='measure')fields[name]=optional(fields[name]);
            }
            const columns=Object.entries(fields).map(([name,t])=>({name,...storage(t)}));
            return {element:{kind:'schema',fields},container:intent.steps.at(-1)?.kind==='take_opt'?'option':'table',receipt:proofTarget(intent,model.contractId,encoded),maxRows,plan:{sql:text,slots,columns,max_rows:maxRows} satisfies Prepared};
        },
        bind(plan:unknown,parameters:unknown[]){
            stats.bindings++;
            const checked=plan as Prepared;
            const bindings=checked.slots.map(slot=>{
                const v=slot.kind==='literal'?slot.value:parameters[slot.index];
                if(v===undefined)fail('Missing model parameter');
                // Value constraints live at bind time; the fixture's CPU domain is 0..100.
                if(slot.kind==='parameter'&&present(slot.type).name==='Float'&&(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100))fail('CPU threshold must be within 0..100');
                return typeof v==='boolean'?Number(v):v;
            });
            return {sql:checked.sql,bindings,columns:checked.columns.map(c=>({...c})),max_rows:checked.max_rows};
        }
    };
    return {model,stats};
}
