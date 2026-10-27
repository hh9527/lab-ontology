#!/usr/bin/env python3
"""Generate scale models and export unchanged JSON for external JS/jq comparisons."""
import json
from pathlib import Path
import subprocess
ROOT = Path(__file__).resolve().parents[2]
r = subprocess.run(['node',str(ROOT/'scripts/generate-dataset-scale-samples.mjs'),'--counts','5,10,20,40','--dimensions','10','--field-types','distinct'],capture_output=True,text=True,check=True)
meta = json.loads(r.stdout); workspace = Path(meta['output'])
print(json.dumps(meta),flush=True)
for case in meta['cases']:
 package = case['name']; path = workspace/package/'src/lib.telora'
 path.write_text(path.read_text()+'\nuse ontology::knowledge as knowledge;\nuse ontology::world as knowledge_world;\npub def compact: Value = knowledge_world::publication(knowledge_world::define(prepared.payload.revision, prepared.declarations, prepared.relations, prepared.alternatives, [], prepared.payload.profile), prepared);\n')
 r = subprocess.run([str(ROOT/'bin/telora'),'-C',str(workspace/package),'eval',package+':compact','--initialization-fuel','400000'],capture_output=True,text=True,timeout=120)
 assert r.returncode == 0,r.stderr
 publication = workspace/(package+'.json'); publication.write_text(r.stdout)
 # Also retain only the model JSON, independently of either external program.
 (workspace/(package+'.data.json')).write_text(json.dumps(json.loads(r.stdout)['data']))
 print(json.dumps({'publication':str(publication)}),flush=True)
