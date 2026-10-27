#!/usr/bin/env python3
"""隔离对照完整 v4 导出与模型提供 jq 的 discovery/expand；不改运行环境。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import tempfile
import time
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--engine',required=True,type=Path)
p.add_argument('--counts',default='5,10,20,40')
p.add_argument('--dimensions',type=int,default=10)
p.add_argument('--field-types',choices=['plain','shared','distinct'],default='distinct')
p.add_argument('--batch-size',type=int,default=1000000)
p.add_argument('--repeats',type=int,default=3)
args=p.parse_args()
base=Path(os.environ.get('TMPDIR') or Path.home()/'.cache/tmp');base.mkdir(parents=True,exist_ok=True)
out=Path(tempfile.mkdtemp(prefix='discovery-experiment-',dir=base))
gen=subprocess.run(['node',str(ROOT/'scripts/generate-dataset-scale-samples.mjs'),'--output',str(out/'workspace'),
 '--counts',args.counts,'--dimensions',str(args.dimensions),'--field-types',args.field_types],capture_output=True,text=True,check=True)
workspace=Path(json.loads(gen.stdout)['output']);cases=json.loads((workspace/'experiment.json').read_text())['cases']
knowledge=workspace/'ontology/src/knowledge.telora';original=knowledge.read_text()
start=original.index('def export:');seed_start=original.index('    let seeds =',start);seed_end=original.index('    let passes =',seed_start)
program=(HERE/'expand.jq').read_text()
raw_source=original[:start]+(HERE/'raw-export.telora').read_text()+'''\ndef export: Fn(t::Prepared) -> Value = fn(prepared) {
    if prepared.relations != [] || prepared.alternatives != [] || prepared.payload.business_links != [] {
        fail!("discovery experiment does not cover relations")
    } else { () };
'''+original[seed_start:seed_end]+'''
    object([("schema", codec::encode("experiment.knowledge-discovery/v1")),
        ("program", codec::encode('''+json.dumps(program,ensure_ascii=False)+''')),
        ("data", object([("revision", codec::encode(prepared.payload.revision)),
            ("types", Value::Array(array::map(types, raw_type))),
            ("datasets", Value::Array(array::map(array::enumerate(prepared.declarations), fn(pair) {
                raw_dataset(pair.1, prepared.payload.entities[pair.0], prepared.payload, pair.0)
            })))]))])
};
pub use self::{export, type_id};
'''
for case in cases:
 path=workspace/case['name']/'src/lib.telora';s=path.read_text()
 s='use ontology::world as build;\n'+s
 s=s.replace('type QueryService =','''def lower: Fn(Value) -> Value = build::stage_prepared(build::define(prepared.payload.revision, prepared.declarations, prepared.relations, prepared.alternatives, [], prepared.payload.profile), fn() { prepared }, fn(payload) {
    intent::query_request_method_factory(payload, sqlite::build_query)
});
type QueryService =''').replace('lower: intent::query_request_method_factory(prepared.payload, sqlite::build_query)','lower: lower')
 path.write_text(s)
def information(path):
 data=path.read_bytes();cursor=8
 def word():
  nonlocal cursor
  value=shift=0
  while True:
   byte=data[cursor];cursor+=1;value|=(byte&127)<<shift
   if not byte&128:return value
   shift+=7
 while cursor<len(data):
  kind=data[cursor];cursor+=1;length=word();end=cursor+length
  if kind==0:
   length=word();name=data[cursor:cursor+length].decode();cursor+=length
   if name=='telora.build.information':
    return json.loads(data[cursor:end])['entries']['ontology.knowledge'],end-cursor
  cursor=end
 raise AssertionError('missing build information')
def normalize(publication):
 facts=publication['facts']; keys={f['key'] for f in facts}
 assert len(keys)==len(facts),'duplicate keys'
 for fact in facts:
  assert set(fact['references'])<=keys,('dangling refs',fact)
 return {**publication,'facts':sorted([{**f,'references':sorted(set(f['references']))} for f in facts],key=lambda f:f['key'])}
report={'workspace':str(workspace),'engine':str(args.engine),'compiler':str((ROOT/'bin/telora').resolve()),
 'engineSha256':hashlib.sha256(args.engine.read_bytes()).hexdigest(),'dimensions':args.dimensions,'fieldTypes':args.field_types,
 'scope':'Generated column dimensions, composite identity, record counts. Type collection unchanged. Keys and graph assembly in model-provided jq. Isolated jaq adds generic sha256 only.',
 'cases':[]}
print(json.dumps({'output':str(out)}),flush=True)
for case in cases:
 entry={'datasets':case['count'],'variants':{}};graphs={};responses={}
 for variant,source in [('baseline',original),('discovery',raw_source)]:
  knowledge.write_text(source)
  artifact=out/f"{case['name']}-{variant}.wasm";log=artifact.with_suffix('.log')
  began=time.monotonic()
  with log.open('w') as f:
   result=subprocess.run([str(ROOT/'bin/telora'),'-C',str(workspace/case['name']),'build',case['name'],'--staged','-o',str(artifact),
    '--initialization-fuel','400000','--request-fuel','100000','--with-memory-limit','2048','--report-usage'],stdout=f,stderr=f,timeout=600)
  assert result.returncode==0,log.read_text()
  phases={}
  for line in log.read_text().splitlines():
   if line.startswith('{'):
    r=json.loads(line)
    if r.get('code')=='build-phase-timing':phases[r['phase']]=r['elapsed_seconds']
  publication,section_bytes=information(artifact)
  meta=artifact.with_suffix('.json');meta.write_text(json.dumps(publication))
  entry['variants'][variant]={'phases':phases,'wasmBytes':artifact.stat().st_size,'sectionBytes':section_bytes,'log':str(log)}
  request=(workspace/case['name']/'request.json').read_text()
  response=subprocess.run([str(ROOT/'bin/telora-run'),str(artifact)],input=request,capture_output=True,text=True,check=True)
  responses[variant]=json.loads(response.stdout);assert responses[variant]['accepted']
  if variant=='baseline':graphs[variant]=publication
  else:
   graph_file=out/f"{case['name']}.graph.json"
   collect=subprocess.run(['node',str(HERE/'collect.mjs'),str(args.engine),str(meta),str(graph_file),str(args.batch_size),str(args.repeats)],capture_output=True,text=True,timeout=180)
   assert collect.returncode==0,collect.stderr
   entry['collection']=json.loads(collect.stdout);graphs[variant]=json.loads(graph_file.read_text())
  print(json.dumps({'datasets':case['count'],'variant':variant,'prepareSeconds':phases['service_prepare'],'buildSeconds':phases['total'],'sectionBytes':section_bytes}),flush=True)
 assert responses['baseline']==responses['discovery'],'transform mismatch'
 left,right=normalize(graphs['baseline']),normalize(graphs['discovery'])
 if left!=right:
  lf={f['key']:f for f in left['facts']};rf={f['key']:f for f in right['facts']}
  diff={'missing':sorted(lf.keys()-rf.keys()),'extra':sorted(rf.keys()-lf.keys()),'changed':[{'key':k,'baseline':lf[k],'discovery':rf[k]} for k in lf.keys()&rf.keys() if lf[k]!=rf[k]]}
  (out/'graph-diff.json').write_text(json.dumps(diff,indent=2));raise AssertionError(str(out/'graph-diff.json'))
 entry['facts']=len(left['facts']);entry['typeNodes']=sum(f['key'].startswith('types/') for f in left['facts'])
 entry['graphEquivalent']=entry['transformIdentical']=True
 entry['collectMedianMs']=statistics.median(o['collectMs'] for o in entry['collection']['observations'])
 report['cases'].append(entry);(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'datasets':case['count'],'facts':entry['facts'],'collectMedianMs':entry['collectMedianMs'],'graphEquivalent':True}),flush=True)
knowledge.write_text(original)
print(json.dumps({'report':str(out/'report.json')}),flush=True)
