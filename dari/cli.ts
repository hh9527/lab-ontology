import {createFixtureModel} from './fixture-model.ts';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve as pathResolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {renderDiagnostics} from './src/diagnostics.ts';
const arguments_=process.argv.slice(2);
const fixture=arguments_.includes('--fixture-model');
const [command,file,database,parameters='{}',directory]=arguments_.filter(arg=>arg!=='--fixture-model');
try {
 if(!['check','resolve'].includes(command)||!file)throw Error('Usage: node cli.ts check file.dari [--fixture-model] | resolve file.dari database.sqlite [inputs-json] [output-directory] [--fixture-model]');
 const source=readFileSync(file,'utf8'),program=check(source,fixture?createFixtureModel().model:undefined);
 if(command==='check'){console.log([...program.bindings].filter(([,b])=>!b.internal).map(([name,b])=>name+': '+show(b.type)).join('\n'));if(program.warnings.length)console.log(renderDiagnostics(source,program.warnings,'Warnings'));}
 else {
  if(!database)throw Error('resolve requires an existing SQLite database');
  const db=new DatabaseSync(database,{readOnly:true});
  try {const result=resolve(program,db,JSON.parse(parameters));
   if(Object.keys(result.artifacts).length&&!directory)throw Error('This answer has artifacts; provide an output directory');
   if(directory){const target=pathResolve(directory);mkdirSync(target,{recursive:true});for(const [name,content]of Object.entries(result.artifacts))writeFileSync(join(target,name),content);writeFileSync(join(target,'answer.md'),result.answer);}
   console.log(result.answer);
  }finally{db.close();}
 }
}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}
