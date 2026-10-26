#!/usr/bin/env python3
"""用 JS 生成的小模型验证连续的 M -> A -> A.result -> B 构建。"""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--telora', required=True)
parser.add_argument('--runner', required=True)
parser.add_argument('--counts', default='5')
parser.add_argument('--self-check', action='store_true')
args = parser.parse_args()
compiler, runner = str(Path(args.telora).resolve()), str(Path(args.runner).resolve())


def run(command, **options):
    result = subprocess.run(command, capture_output=True, text=True, timeout=300, **options)
    assert result.returncode == 0, result.stderr + result.stdout
    return result


generated = json.loads(run(['node', str(ROOT / 'scripts/generate-dataset-scale-samples.mjs'),
    '--counts', args.counts, '--field-types', 'distinct', '--staged', '--runtime-only']).stdout)
workspace = Path(generated['output'])
print(f'Experiment: {workspace}', flush=True)
report = {'workspace': str(workspace), 'selfCheck': args.self_check, 'cases': []}
for sample in generated['cases']:
    cwd = workspace / sample['name']
    if args.self_check:
        path = cwd / 'src/lib.telora'
        source = path.read_text()
        preparation = 'staged::prepare("dataset-scale-v1", declarations, profile)'
        assert preparation in source
        path.write_text(source.replace(preparation,
            '{ staged::self_check("dataset-scale-v1", declarations, profile); ' + preparation + ' }'))

    def build(name, specialized):
        artifact = workspace / f'{sample["name"]}-{name}.wasm'
        result = run([compiler, '-C', str(cwd), 'build', sample['name'],
            '--snapshot' if specialized else '--snapshot=full', '-o', str(artifact),
            '--initialization-fuel', '400000', '--request-fuel', '100000',
            '--with-memory-limit', '2048', '--report-usage'])
        artifact.with_suffix('.log').write_text(result.stderr)
        records = [json.loads(line) for line in result.stderr.splitlines() if line.startswith('{')]
        return {'artifact': str(artifact), 'bytes': artifact.stat().st_size,
            'phases': {r['phase']: r['elapsed_seconds'] for r in records if r.get('code') == 'build-phase-timing'},
            'specialization': next((r for r in records if r.get('schema') == 'telora.runtime-specialization/v1'), None)}

    baseline, specialized = build('baseline', False), build('runtime', True)
    query = json.loads((cwd / 'request.json').read_text())
    requests = [query, query,
        {'method': 'scale/transform', 'input': {'intents': [{'op': 'Graph', 'root': 'r',
            'nodes': [{'id': 'r', 'entity': 'missing'}], 'edges': [], 'select': [{'node': 'r', 'dimension': 'dataset_1_id'}]}]}},
        {'method': 'scale/transform', 'input': {'intents': 'invalid'}},
        {'method': 'scale/transform', 'input': None},
        {'method': 'missing/method', 'input': None}, query]

    def responses(artifact):
        result = run([runner, artifact, '--serve', 'stdio+jsonl://', '--request-fuel', '100000',
            '--with-memory-limit', '2048'], input=''.join(json.dumps(r) + '\n' for r in requests))
        values = [json.loads(line) for line in result.stdout.splitlines()]
        assert len(values) == len(requests), result
        return values

    expected, actual = responses(baseline['artifact']), responses(specialized['artifact'])
    (cwd / 'responses-baseline.json').write_text(json.dumps(expected, indent=2) + '\n')
    (cwd / 'responses-runtime.json').write_text(json.dumps(actual, indent=2) + '\n')
    assert actual == expected, 'B changed SQL, input rejection, routing, or repeated request behavior'
    assert actual[0]['error'] is False and actual[0]['ok']['accepted'] is True, actual[0]
    assert actual[2]['ok']['accepted'] is False, actual[2]
    assert actual[3]['error'] is True and actual[4]['error'] is True, actual[3:5]
    assert actual[5]['error'] is True, actual[5]
    stats = specialized['specialization']
    assert stats['prepared_getters'] > 0 and stats['retained_functions'] < stats['generated_functions'], stats
    assert specialized['bytes'] < baseline['bytes'], 'runtime artifact did not shrink'
    item = {**sample, 'requests': len(requests), 'baseline': baseline, 'specialized': specialized,
        'savedBytes': baseline['bytes'] - specialized['bytes'],
        'savedFraction': 1 - specialized['bytes'] / baseline['bytes']}
    report['cases'].append(item)
    (workspace / 'specialization-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(item), flush=True)
