#!/usr/bin/env python3
"""Measure identical model sources with default formatter regions and diagnostic opt-out."""
import argparse
import os, json, subprocess, runpy, hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--telora',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
out=args.output.resolve();out.mkdir(exist_ok=True,parents=True)
workspace=out/'workspace'
if not workspace.exists(): subprocess.run(['python3',str(root/'scripts/prepare-mut-ceiling.py'),'--variant','baseline','--output',str(workspace)],check=True,capture_output=True)
compiler=args.telora.resolve()
information=runpy.run_path(str(root/'scripts/measure-mut-ceiling.py'))['information']
report={'compilerSha256':hashlib.sha256(compiler.read_bytes()).hexdigest(),'cases':[]}
for model in ['icloud_model','ns_model']:
    expected=None
    for variant in ['baseline','automatic']:
        env=dict(os.environ)
        for key in list(env):
            if key.startswith('TELORA_EXPERIMENTAL_') or key=='TELORA_DISABLE_FORMAT_REGIONS':env.pop(key)
        if variant=='baseline':env['TELORA_DISABLE_FORMAT_REGIONS']='1'
        artifact=out/f'{model}-{variant}.wasm'
        result=subprocess.run([str(compiler),'-C',str(workspace/model),'build',model,'--staged','-o',str(artifact),'--report-usage'],capture_output=True,text=True,env=env,timeout=600)
        artifact.with_suffix('.log').write_text(result.stderr+result.stdout)
        assert result.returncode==0,result.stderr
        data=information(artifact)
        if expected is None:expected=data
        assert data==expected,model
        records=[]
        for line in result.stderr.splitlines():
            try:records.append(json.loads(line))
            except ValueError:pass
        row={'model':model,'variant':variant,'artifactBytes':artifact.stat().st_size,'completeBuildInformationIdentical':True,'phases':{r['phase']:r['elapsed_seconds'] for r in records if r.get('code')=='build-phase-timing'},'usage':next(r for r in records if r.get('record')=='buildtime-usage')}
        report['cases'].append(row);(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(row),flush=True)
