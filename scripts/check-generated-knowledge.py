#!/usr/bin/env python3
"""Verify generated scale models publish identical static JS and equivalent facts."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--counts', default='5,10,20,40')
a = p.parse_args()
r = subprocess.run(['node',str(ROOT/'scripts/generate-dataset-scale-samples.mjs'),'--counts',a.counts,'--dimensions','10','--field-types','distinct'],capture_output=True,text=True,check=True)
meta=json.loads(r.stdout); workspace=Path(meta['output']); plugin=ROOT.parent/'dsh-oks'
source=(ROOT/'ontology/src/knowledge.js').read_text()
print(json.dumps({'workspace':str(workspace)}),flush=True)
report=[]
for case in meta['cases']:
 name=case['name']; path=workspace/name/'src/lib.telora'
 path.write_text(path.read_text()+'\nuse ontology::knowledge as knowledge;\nuse ontology::world as knowledge_world;\npub def reference_graph: Value = knowledge::export(prepared);\npub def compact: Value = knowledge_world::publication(knowledge_world::define(prepared.payload.revision, prepared.declarations, prepared.relations, prepared.alternatives, [], prepared.payload.profile), prepared);\n')
 outputs={}
 for entry in ['reference_graph','compact']:
  r=subprocess.run([str(ROOT/'bin/telora'),'-C',str(workspace/name),'eval',name+':'+entry,'--initialization-fuel','400000'],capture_output=True,text=True,timeout=600)
  assert r.returncode==0,r.stderr
  outputs[entry]=json.loads(r.stdout)
  (workspace/(name+'.'+entry+'.json')).write_text(r.stdout)
 publication=outputs['compact']
 assert publication['program']==source,'model-dependent JS source'
 output=workspace/(name+'.collected.json')
 r=subprocess.run(['node','--import',str(plugin/'packages/dsh-oks/scripts/markdown-loader.mjs'),str(plugin/'scripts/collect-model-knowledge.mjs'),str(workspace/(name+'.compact.json')),str(output)],capture_output=True,text=True,timeout=120)
 assert r.returncode==0,r.stderr
 built=json.loads(output.read_text())
 from knowledge_comparison import normalize_graph
 assert normalize_graph(outputs['reference_graph'])==normalize_graph(built['graph'])
 assert len(built['vocabulary'])==len(built['graph']['facts'])
 item={'datasets':case['count'],'facts':len(built['graph']['facts']),'instructions':len(publication['data']['instructions']),
  'staticProgramSha256':hashlib.sha256(source.encode()).hexdigest(),'graphEquivalent':True,'collection':json.loads(r.stdout)}
 report.append(item);print(json.dumps(item),flush=True)
(workspace/'knowledge-report.json').write_text(json.dumps(report,indent=2)+'\n')
