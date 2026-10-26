#!/usr/bin/env python3
"""Compare jq discovery, single-fold jq and static JS on identical published JSON."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import tempfile
ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('publications', nargs='+', type=Path)
p.add_argument('--repeats', type=int, default=3)
a = p.parse_args()
assert a.repeats > 0
base = Path(os.environ.get('TMPDIR') or Path.home()/'.cache/tmp')
base.mkdir(parents=True, exist_ok=True)
out = Path(tempfile.mkdtemp(prefix='javascript-knowledge-', dir=base))
report = {'workspace': str(out), 'repeats': a.repeats, 'jsSha256': hashlib.sha256((Path(__file__).with_name('build.js')).read_bytes()).hexdigest(), 'cases': []}
print(json.dumps({'workspace': str(out)}), flush=True)
for i, publication in enumerate(a.publications):
 case = {'input': str(publication.resolve()), 'sha256': hashlib.sha256(publication.read_bytes()).hexdigest(), 'observations': []}
 expected = out/f'{i}-reference.json'
 # Each sample runs in a fresh Node process; rotate order to reduce ordering bias.
 modes = ['jq', 'jq-single', 'js', 'js-ops']
 for repeat in range(a.repeats):
  for mode in modes[repeat % len(modes):] + modes[:repeat % len(modes)]:
   output = out/f'{i}-{repeat}-{mode}.json'
   command = ['node', '--import', str(ROOT.parent/'dsh-oks/packages/dsh-oks/scripts/markdown-loader.mjs'), str(Path(__file__).with_name('measure.mjs')), str(publication.resolve()), mode, str(output)]
   if expected.exists(): command.append(str(expected))
   result = subprocess.run(command, capture_output=True, text=True, timeout=120)
   assert result.returncode == 0, result.stderr
   if not expected.exists(): expected.write_bytes(output.read_bytes())
   observation = json.loads(result.stdout)
   case['observations'].append(observation)
   print(json.dumps({'case':i,'repeat':repeat,**observation}), flush=True)
 case['medians'] = {mode: {key: statistics.median(x[key] for x in case['observations'] if x['mode']==mode)
   for key in ['parseMs','compileMs','collectMs','deriveMs','vocabularyMs','serializeMs','totalMs','maxRssKiB']}
   for mode in modes}
 report['cases'].append(case)
 (out/'report.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps({'report':str(out/'report.json'),'medians':[c['medians'] for c in report['cases']]}), flush=True)
