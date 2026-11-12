import assert from 'node:assert/strict';
import {openModel} from './model-bridge.ts';
import {check} from './src/compiler.ts';
const host=await openModel(process.argv[2]);
try{
    let datasets=0;
    for(const [symbol,dataset] of Object.entries(host.model.datasets)){
        const dimension=Object.values(dataset.members).find(m=>m.kind==='dimension');
        assert(dimension,dataset.id);
        const source=`data rows = query_remote! {
            let a = from(${symbol});
            a |> project({value: a.${dimension.id}})
              |> order_by(asc(a.${dimension.id})) |> take(5)
        };
        answer tree! { Answer [UseTable(ref = rows)] };`;
        try {assert.equal(check(source,host.model).bindings.get('rows')!.type.kind,'table');}
        catch(error){throw Error(dataset.id+': '+(error as Error).message);}
        datasets++;
    }
    console.log(JSON.stringify({status:'passed',datasets,types:Object.keys(host.model.types!).length}));
}finally{await host.close();}
