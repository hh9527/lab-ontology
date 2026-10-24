#!/usr/bin/env python3
import json,statistics,subprocess
from pathlib import Path
import argparse
parser = argparse.ArgumentParser(description='对照关闭知识、完整知识和精简知识制品的体积与冷启动')
for name in ['runner', 'baseline', 'full', 'runtime', 'output']:
    parser.add_argument('--' + name, required=True, type=Path)
args = parser.parse_args()
runner = str(args.runner.resolve())
artifacts = {'withoutKnowledge': args.baseline, 'full': args.full, 'runtime': args.runtime}
query={'method':'ic/transform','input':{'intents':[{'op':'Graph','root':'r','nodes':[{'id':'r','entity':'device'}],'edges':[],'select':[{'node':'r','dimension':'device_id'}]}]}}
expected=None; observations={name:[] for name in artifacts}
for iteration in range(3):
    order=list(artifacts) if iteration%2==0 else list(reversed(artifacts))
    for name in order:
        result=subprocess.run([runner,str(artifacts[name]),'--serve','stdio+jsonl://','--report-timings'],input=(json.dumps(query)+'\n')*3,text=True,capture_output=True,timeout=120)
        assert result.returncode==0,result.stderr
        responses=[json.loads(line) for line in result.stdout.splitlines()]
        assert len(responses)==3 and all(r['ok']['accepted'] for r in responses),responses
        if expected is None:expected=responses[0]
        assert all(r==expected for r in responses)
        observations[name].append([r['timings'] for line in result.stderr.splitlines() if (r:=json.loads(line)).get('code')=='execution-timings'])

def sections(path):
    data=path.read_bytes();cursor=8;custom={};standard={};metadata=None
    def word():
        nonlocal cursor
        value=0;shift=0
        while True:
            b=data[cursor];cursor+=1;value|=(b&127)<<shift
            if b<128:return value
            shift+=7
    while cursor<len(data):
        kind=data[cursor];cursor+=1;size=word();end=cursor+size
        if kind==0:
            n=word();name=data[cursor:cursor+n].decode();cursor+=n;custom[name]=end-cursor
            if name=='telora.service.metadata':metadata=json.loads(data[cursor:end])
        else:standard[str(kind)]=size
        cursor=end
    return {'bytes':len(data),'standard':standard,'custom':custom},metadata
report={'observations':observations,'artifacts':{},'summary':{}}
metadata={}
for name,path in artifacts.items():
    report['artifacts'][name],metadata[name]=sections(path)
    rounds=observations[name]
    report['summary'][name]={'firstRequestMs':statistics.median(r[0]['request_ms'] for r in rounds),'thirdRequestMs':statistics.median(r[2]['request_ms'] for r in rounds),'coldTotalMs':statistics.median(sum(r[0].get(k,0) for k in ['read_ms','metadata_ms','module_ms','instance_ms','initialize_ms','reset_ms','request_ms']) for r in rounds)}
assert metadata['runtime']==metadata['full']
report['metadataIdentical']=True
args.output.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'summary':report['summary'],'artifacts':report['artifacts'],'metadataIdentical':True}))
