#!/usr/bin/env python3
"""真实构建同一模型的 v4 基线与程序式发布，使用正式插件采集并校验图及词表。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('package',choices=['relation_model','icloud_model'])
p.add_argument('--reuse',type=Path,help='复用本脚本的隔离工作区及已有 v4 基线，仅重建程序式制品')
p.add_argument('--plugin-root',type=Path,default=ROOT.parent/'dsh-oks')
args=p.parse_args()
base=Path(os.environ.get('TMPDIR') or Path.home()/'.cache/tmp');base.mkdir(parents=True,exist_ok=True)
workspace=args.reuse or Path(tempfile.mkdtemp(prefix='programmed-knowledge-',dir=base))
for name in ['ontology',args.package]:
 shutil.copytree(ROOT/name,workspace/name,ignore=shutil.ignore_patterns('target','__pycache__','*.wasm'),dirs_exist_ok=True)
(workspace/'telora-config.json').write_text(json.dumps({'version':1,'members':['ontology',args.package]}))
lock=json.loads((ROOT/'telora-lock.json').read_text());lock['packages']={name:lock['packages'][name] for name in ['ontology',args.package]};(workspace/'telora-lock.json').write_text(json.dumps(lock))
def run(command,**options):
 r=subprocess.run([str(x) for x in command],capture_output=True,text=True,timeout=600,**options)
 assert r.returncode==0,r.stderr+r.stdout
 return r

def publication(path):
 data=path.read_bytes();cursor=8
 def word():
  nonlocal cursor
  n=shift=0
  while True:
   b=data[cursor];cursor+=1;n|=(b&127)<<shift
   if not b&128:return n
   shift+=7
 while cursor<len(data):
  kind=data[cursor];cursor+=1;size=word();end=cursor+size
  if kind==0:
   size=word();name=data[cursor:cursor+size].decode();cursor+=size
   if name=='telora.build.information':return json.loads(data[cursor:end])['entries']['ontology.knowledge'],end-cursor
  cursor=end
 raise AssertionError('missing publication')

def normalize(p):
 facts=p['facts'];keys={f['key'] for f in facts};assert len(keys)==len(facts)
 for f in facts:assert set(f['references'])<=keys,('unresolved reference',f)
 return {**p,'facts':sorted([{**f,'references':sorted(set(f['references']))} for f in facts],key=lambda f:f['key'])}
report={'workspace':str(workspace),'model':args.package,'variants':{}}
print(json.dumps(report),flush=True)
factory=workspace/'ontology/src/experimental/build.telora';source=factory.read_text();graphs={}
for variant in ['baseline','programmed']:
 factory.write_text(source.replace('knowledge::publication(prepared)','knowledge::export(prepared)') if variant=='baseline' else source)
 artifact=workspace/f'{variant}.wasm'
 if variant=='baseline' and args.reuse:
  stderr=(workspace/f'{variant}.log').read_text()
 else:
  result=run([ROOT/'bin/telora','-C',workspace/args.package,'build',args.package,'--staged','-o',artifact,
   '--initialization-fuel','400000','--request-fuel','100000','--with-memory-limit','2048','--report-usage'])
  (workspace/f'{variant}.log').write_text(result.stderr)
  stderr=result.stderr
 phases={}
 for line in stderr.splitlines():
  if line.startswith('{'):
   r=json.loads(line)
   if r.get('code')=='build-phase-timing':phases[r['phase']]=r['elapsed_seconds']
 data,size=publication(artifact);path=workspace/f'{variant}.json';path.write_text(json.dumps(data))
 report['variants'][variant]={'artifact':str(artifact),'bytes':artifact.stat().st_size,'informationBytes':size,'phases':phases}
 if variant=='baseline':graphs[variant]=data
 else:
  result=run(['node','--import',args.plugin_root/'packages/dsh-oks/scripts/markdown-loader.mjs',args.plugin_root/'scripts/collect-model-knowledge.mjs',path,workspace/'collected.json'])
  built=json.loads((workspace/'collected.json').read_text());graphs[variant]=built['graph']
  report['collection']=json.loads(result.stdout);assert report['collection']['terms']>0
 print(json.dumps({'variant':variant,**report['variants'][variant]}),flush=True)
left,right=normalize(graphs['baseline']),normalize(graphs['programmed'])
if left!=right:
 lf={f['key']:f for f in left['facts']};rf={f['key']:f for f in right['facts']}
 diff={'missing':sorted(lf.keys()-rf.keys()),'extra':sorted(rf.keys()-lf.keys()),'changed':[{'key':k,'baseline':lf[k],'programmed':rf[k]} for k in lf.keys()&rf.keys() if lf[k]!=rf[k]]}
 (workspace/'graph-diff.json').write_text(json.dumps(diff,indent=2));raise AssertionError(str(workspace/'graph-diff.json'))
report['graphEquivalent']=True;report['facts']=len(left['facts'])
(workspace/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'report':str(workspace/'report.json'),'graphEquivalent':True,'facts':report['facts']}),flush=True)
