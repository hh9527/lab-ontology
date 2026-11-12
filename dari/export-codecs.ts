import {writeFileSync} from 'node:fs';
import {openModel} from './model-bridge.ts';

const [artifact,sink]=process.argv.slice(2);
if(!artifact||!sink)throw Error('Usage: node dari/export-codecs.ts model.wasm codecs.mjs');
const host=await openModel(artifact);
try{writeFileSync(sink,host.codecModuleSource);console.log(sink);}finally{await host.close();}
