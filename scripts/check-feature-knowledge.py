#!/usr/bin/env python3
"""Compare all generated Group/expression branches against the reference graph."""
import subprocess,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
r=subprocess.run(['node',str(ROOT/'scripts/generate-staged-feature-samples.mjs'),'--copies','1'],capture_output=True,text=True,check=True)
w=Path(json.loads(r.stdout)['output'])
p=w/'features_runtime/src/lib.telora'
p.write_text(p.read_text().split('pub def reference_graph:')[0]+'use ontology::knowledge as knowledge;\nuse ontology::world as knowledge_world;\n'+'\npub def reference_graph: Value = knowledge::export(prepared);\npub def compact: Value = knowledge_world::publication(knowledge_world::define(prepared.payload.revision, prepared.declarations, prepared.relations, prepared.alternatives, [], prepared.payload.profile), prepared);\n')
for name in ['reference_graph','compact']:
 r=subprocess.run([str(ROOT/'bin/telora'),'-C',str(w/'features_runtime'),'eval','features_runtime:'+name,'--initialization-fuel','400000'],capture_output=True,text=True,timeout=120)
 assert r.returncode==0,r.stderr
 (w/(name+'.json')).write_text(r.stdout)
r=subprocess.run(['node','--import',str(ROOT.parent/'dsh-oks/packages/dsh-oks/scripts/markdown-loader.mjs'),str(ROOT.parent/'dsh-oks/scripts/collect-model-knowledge.mjs'),str(w/'compact.json'),str(w/'collected.json')],capture_output=True,text=True,timeout=120)
assert r.returncode==0,r.stderr
left=json.loads((w/'reference_graph.json').read_text());right=json.loads((w/'collected.json').read_text())['graph']
from knowledge_comparison import normalize_graph
assert normalize_graph(left)==normalize_graph(right),'graphs differ'
print(json.dumps({'workspace':str(w),'facts':len(left['facts']),'equivalent':True,'collection':json.loads(r.stdout)}))
