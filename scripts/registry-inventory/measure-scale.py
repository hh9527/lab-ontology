import ast,json,os,re,subprocess,tempfile,time,shutil
from pathlib import Path
repo=Path(__file__).resolve().parents[2]
out=Path(tempfile.mkdtemp(prefix='inventory-scale-',dir=os.environ.get('TMPDIR') or Path.home()/'.cache/tmp'))
s= (repo/'scripts/measure-registry-inventory.py').read_text()
service=s.split('service = r"""',1)[1].split('"""',1)[0]
ns={'json':json}
node=next(n for n in ast.parse(s).body if isinstance(n,ast.FunctionDef) and n.name=='information')
exec(compile(ast.Module(body=[node],type_ignores=[]),'harness','exec'),ns)
subprocess.run(['node',str(repo/'scripts/generate-dataset-scale-samples.mjs'),'--output',str(out/'workspace'),'--counts','151','--dimensions','10','--field-types','distinct'],check=True,capture_output=True,text=True)
w=out/'workspace'
shutil.copy2(repo/'scripts/registry-inventory/collect.telora',w/'ontology/src/inventory.telora')
with (w/'ontology/src/lib.telora').open('a') as f:f.write('\npub mod inventory;\n')
# Poison the default thunk initializer: successful collection cannot have forced it.
p=w/'ontology/src/inventory.telora'
x=p.read_text()
a=x.index('def defer:');b=x.index('def type_name:',a)
x=x[:a]+'def defer: for(A) Fn(Array(A), Fn(A) -> String) -> Array((String, Fn() -> A)) = fn(items, key) { defer_with(items, key, fn(item) { fail!("collection forced a thunk") }) };\n'+x[b:]
p.write_text(x)
c=json.loads((repo/'telora-config.json').read_text());c['members']=json.loads((w/'telora-config.json').read_text())['members'];(w/'telora-config.json').write_text(json.dumps(c))
rows=[]
print('OUTPUT',out,flush=True)
for case in json.loads((w/'experiment.json').read_text())['cases']:
 name,n=case['name'],case['count'];p=w/name/'src/lib.telora';original=p.read_text().split('def prepared:',1)[0]
 original=original.replace('use std::transform_service as service;','')
 # Keep nine fields per Dataset but share two custom types inside each Dataset.
 original=re.sub(r'type TextValue(\d+)_(\d+) = struct\(String\);',lambda m:m.group(0) if int(m[2])<=2 else '',original)
 original=re.sub(r'TextValue(\d+)_(\d+)',lambda m:f'TextValue{m[1]}_{1+(int(m[2])-1)%2}',original)
 original=re.sub(r'(type Row\d+ = struct \{)',r'\1 reading: Percent,',original)
 original=original.replace('def declarations: Array(t::Declaration)', 'def original_declarations: Array(t::Declaration)')
 extra='\nuse ontology::samples as samples;\nuse ontology::relations as relations;\nuse std::array as array;\ntype Percent = struct(Float);\ntype PeerIdentity = struct { tenant: TenantId, local: ItemId };\ndef common: m::Entity(PeerIdentity) = m::entity("peer", PeerIdentity.type);\n'
 for i in range(1,n+1):
  extra+=f'def peer{i}: m::Role(Row{i}) = m::role(dataset{i}, common, "peer", False, [m::identity_part(m::field(Row{i}.type,TenantId.type,"tenant_id"),m::field(PeerIdentity.type,TenantId.type,"tenant")),m::identity_part(m::field(Row{i}.type,ItemId.type,"id"),m::field(PeerIdentity.type,ItemId.type,"local"))]);\n'
  j=i%n+1
  extra+=f'def edge{i}: relations::Relation = relations::relation("edge_{i}",dataset{i},peer{i},dataset{j},peer{j},{{from: edsl::Cardinality::Optional,to: edsl::Cardinality::Optional}});\n'
  extra+=f'def reverse{i}: relations::Relation = relations::relation("reverse_{i}",dataset{j},peer{j},dataset{i},peer{i},{{from: edsl::Cardinality::Optional,to: edsl::Cardinality::Optional}});\n'
 extra+='def edges: Array(relations::Relation) = ['+', '.join(x for i in range(1,n+1) for x in (f'edge{i}',f'reverse{i}'))+'];\n'
 extra+='def declarations: Array(t::Declaration) = ['
 for i in range(1,n+1):
  extra+=f't::with_samples(declaration{i},[samples::bind(dataset{i},samples::group("sample_{1+(i-1)%27}",Percent.type,samples::Statistic::Mean,[samples::Statistic::Min,samples::Statistic::Max],Some("%")),m::field(Row{i}.type,Percent.type,"reading"),[{{statistic:samples::Statistic::Mean,publish:"mean_load"}},{{statistic:samples::Statistic::Min,publish:"min_load"}},{{statistic:samples::Statistic::Max,publish:"max_load"}}])]),'
 extra+='];\n'
 original+='\nuse ontology::ontology as edsl;\n'+extra

 prefix=original+'\nuse ontology::inventory as inventory;\nuse std::codec as codec;\ntype Counts = struct {datasets: Int, entities: Int, relations: Int};\ndef roots: Array(Type) = ['+', '.join(f'Identity{i}.type' for i in range(1,n+1))+', PeerIdentity.type];\n'
 for mode,expr in [('baseline','codec::encode({datasets: array::length(declarations), entities: array::length(roots), relations: array::length(edges)}.ty!(Counts))'),('collect','inventory::summary(inventory::collect_declarations(declarations, roots, edges))')]:
  p.write_text(prefix+service.replace('EXPRESSION',expr))
  artifact=out/f'{name}-{mode}.wasm';start=time.monotonic()
  r=subprocess.run([str(repo/'bin/telora'),'-C',str(w/name),'build',name,'--staged','-o',str(artifact),'--report-usage'],capture_output=True,text=True,timeout=120)
  (out/f'{name}-{mode}.log').write_text(r.stdout+r.stderr)
  if r.returncode:print(r.stderr[-4000:],flush=True);raise SystemExit(r.returncode)
  ds=[json.loads(line) for line in r.stderr.splitlines() if line.startswith('{')]
  phases={d['phase']:d['elapsed_seconds'] for d in ds if d.get('code')=='build-phase-timing'}
  usage=next(d for d in ds if d.get('record')=='buildtime-usage')
  row={'datasets':n,'mode':mode,'prepare_seconds':phases['service_prepare'],'total_seconds':phases['total'],'fuel':usage['fuel_consumed'],'memory_bytes':usage['linear_memory_bytes'],'counts':ns['information'](artifact)}
  if mode=='collect':
   assert row['counts']['datasets']==n and row['counts']['entities']==n+1
   assert row['counts']['dimensions']==n*10 and row['counts']['types']==n*2+3 and row['counts']['measure_groups']==27 and row['counts']['measures']==n*4 and row['counts']['relations']==n*2,row
  rows.append(row);print(json.dumps(row),flush=True)
  (out/'report.json').write_text(json.dumps(rows,indent=2))
