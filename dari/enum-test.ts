import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {DatabaseSync} from 'node:sqlite';
import type {ModelPort,ValueCodec} from './src/model.ts';
import {check as checkProgram} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';

type FieldMapping={cases:{name:string;wires:(string|number)[]}[];fallback:string|null;map(value:unknown):unknown};
export function testEnums(model:ModelPort,codecs:Record<string,ValueCodec>,mappings:Record<string,FieldMapping>,db:DatabaseSync){
    let enumCodecs=0,wires=0;
    for(const [key,codec] of Object.entries(codecs)){
        if(!codec.variants)continue;
        enumCodecs++;
        for(const name of codec.variants){
            assert.deepEqual(codec.decode(codec.encode(name)),{tag:name},key);
            if(key.endsWith('@String'))assert.equal(codec.encode(name),name,key);
            else assert(Number.isSafeInteger(codec.encode(name)),key);
        }
        assert.throws(()=>codec.decode('!not-an-enum'),/unknown closed enum/);
        assert.throws(()=>codec.parse({tag:'Unknown',value:'raw'}),/expected closed enum/);
    }
    for(const [key,mapping] of Object.entries(mappings)){
        for(const item of mapping.cases)for(const wire of item.wires){
            assert.deepEqual(mapping.map(wire),{tag:item.name},key);wires++;
        }
        const sample=mapping.cases[0].wires[0];
        const unknown=typeof sample==='number'?Number.MAX_SAFE_INTEGER:'!unmapped-source';
        if(mapping.fallback!==null)assert.deepEqual(mapping.map(unknown),{tag:mapping.fallback},key);
        else assert.throws(()=>mapping.map(unknown),/unmapped strict/,key);
        assert.equal(mapping.map(null),null,key);
        assert.throws(()=>mapping.map(typeof sample==='number'?'wrong-type':42),/invalid field mapping source/,key);
    }
    const category=model.types!['ic::DeviceClass'].codec!;
    assert.deepEqual(category.decode('Lsw'),{tag:'Lsw'});
    assert.throws(()=>category.decode('LSW'),/unknown closed enum/);
    assert.deepEqual(mappings['device/device_class'].map('LSW'),{tag:'Lsw'});
    assert.deepEqual(mappings['device/device_class'].map('new-device-category'),{tag:'Unknown'});
    db.exec(`CREATE TABLE enum_alarms(id TEXT,severity TEXT,category TEXT,status TEXT);
        INSERT INTO enum_alarms VALUES ('a','Critical','Lsw','Up'),('b','Critical','Lsw','Unknown'),('c','Major','Lsw',NULL);`);
    const source=readFileSync(new URL('./examples/enum.dari',import.meta.url),'utf8');
    const program=check(source,model);
    const result=resolve(program,db,{request:{severity:'Critical',category:'Lsw'}});
    assert.deepEqual(result.values.rows,[
        {id:'a',severity:{tag:'Critical'},category:{tag:'Lsw'},status:{tag:'Up'}},
        {id:'b',severity:{tag:'Critical'},category:{tag:'Lsw'},status:{tag:'Unknown'}}
    ]);
    const optional=source.replace('category: ic::DeviceClass});','category: ic::DeviceClass, optional: Option(ic::OpenStatus)});')
        .replace('status: a.status','status: unwrap_or!(request.optional, ic::OpenStatus::Up)');
    const optionalPlan=check(optional,model);
    assert.deepEqual(resolve(optionalPlan,db,{request:{severity:'Critical',category:'Lsw',optional:null}}).values.rows[0].status,{tag:'Up'});
    assert.deepEqual(resolve(optionalPlan,db,{request:{severity:'Critical',category:'Lsw',optional:'Unknown'}}).values.rows[0].status,{tag:'Unknown'});
    const labeled=source.replace('status: a.status','status: unwrap_or!(lookup(a.status, [{value: ic::OpenStatus::Up, label: "在线"}]), "其他")');
    assert.deepEqual(resolve(check(labeled,model),db,{request:{severity:'Critical',category:'Lsw'}}).values.rows.map((r:any)=>r.status),['在线','其他']);
    assert.throws(()=>check(optional.replace('ic::OpenStatus::Up','ic::OpenStatus::Missing'),model),/Unknown enum variant/);
    assert.throws(()=>check(optional.replace('ic::OpenStatus::Up','ic::OpenStatus("Up")'),model),/static enum variant/);
    db.exec('CREATE TABLE T_CURRENT_ALARM(CSN INTEGER,SEVERITY INTEGER); INSERT INTO T_CURRENT_ALARM VALUES (1,1),(2,2)');
    const graph=readFileSync(new URL('./examples/ic-enum.dari',import.meta.url),'utf8');
    const graphResult=resolve(check(graph,model),db);
    assert.deepEqual(graphResult.values.rows,[{id:1,severity:{tag:'Critical'}},{id:2,severity:{tag:'Major'}}]);
    db.exec('INSERT INTO T_CURRENT_ALARM VALUES(3,99)');
    assert.throws(()=>resolve(check(graph,model),db),/unknown closed enum/,'strict SQL mapping must retain invalid source for decoder rejection');
    db.exec('DELETE FROM T_CURRENT_ALARM WHERE CSN=3');
    db.exec(`CREATE TABLE I_EntNetworkElement(id TEXT,classification TEXT);
        INSERT INTO I_EntNetworkElement VALUES ('one','LSW'),('two','ne.category.switch'),('three','brand-new');`);
    const classes=check(`data rows = query_remote! {
        let a = from(ic::device);
        a |> project({id: a.device_id, raw: a.device_class_raw, category: a.device_class}).as!(out)
          |> order_by(asc(a.device_id)) |> take(10)
    };
    answer tree! { Answer [Table(data = rows)] };`,model);
    const classRows=resolve(classes,db).values.rows;
    assert.deepEqual(classRows.map((r:any)=>[r.raw,r.category.tag]),[['LSW','Lsw'],['brand-new','Unknown'],['ne.category.switch','Lsw']]);
    db.exec(`CREATE TABLE I_EnterpriseFrame(frameDn TEXT,operState INTEGER);
        INSERT INTO I_EnterpriseFrame VALUES ('a',NULL),('b',1),('c',3);`);
    const frame=check(`data rows = query_remote! {
        let a = from(ic::frame);
        a |> project({id: a.frame__frameDn, raw: a.frame_oper_state_raw, state: a.frame_oper_state}).as!(out)
          |> order_by(asc(a.frame__frameDn)) |> take(10)
    };
    answer tree! { Answer [Table(data = rows)] };`,model);
    assert.deepEqual(resolve(frame,db).values.rows.map((r:any)=>[r.raw,r.state]),[[null,null],[1,{tag:'Unknown'}],[3,{tag:'Normal'}]]);
    db.exec("CREATE TABLE enum_sort(raw TEXT,logical TEXT); INSERT INTO enum_sort VALUES('Alpha','Alpha'),('Zeta','Zeta')");
    const orderedSource=`type Row = Schema({raw: String, logical: ic::CodecOrder});
    data source_rows: Table(Row) = source("enum_sort");
    data rows = query! { let a = from(source_rows);
        a |> project({raw: a.raw, logical: a.logical}).as!(out) |> order_by(asc(out.logical)) |> take(10)
    };
    answer tree! { Answer [Table(data = rows)] };`;
    assert.deepEqual(resolve(check(orderedSource,model),db).values.rows.map((r:any)=>r.raw),['Zeta','Alpha']);
    assert.deepEqual(resolve(check(orderedSource.replace('asc(out.logical)','asc(out.raw)'),model),db).values.rows.map((r:any)=>r.raw),['Alpha','Zeta']);
    assert.deepEqual(model.types!['ic::AlarmSeverity'].codec!.parse(1),{tag:'Critical'});
    console.log(JSON.stringify({enumCodecs,mappings:Object.keys(mappings).length,sourceWires:wires}));
}

function check(source: string, model?: import("./src/model.ts").ModelPort){return checkProgram(source,model,{allowTestSources:true});}
