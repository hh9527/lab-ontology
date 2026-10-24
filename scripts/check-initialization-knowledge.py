#!/usr/bin/env python3
"""在隔离 relation 样本验证同 Group 多次绑定与 full/runtime 发布一致。"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--telora', required=True, type=Path)
parser.add_argument('--runner', required=True, type=Path)
args = parser.parse_args()
workspace = Path(tempfile.mkdtemp(prefix='initialization-knowledge-', dir=os.environ.get('TMPDIR') or Path.home() / '.cache/tmp'))
for package in ['ontology', 'relation_model']:
    shutil.copytree(ROOT / package, workspace / package, ignore=shutil.ignore_patterns('target', '*.wasm'))
(workspace / 'telora-config.json').write_text(json.dumps({'version': 1, 'members': ['ontology', 'relation_model']}))
lock = json.loads((ROOT / 'telora-lock.json').read_text())
lock['packages'] = {name: lock['packages'][name] for name in ['ontology', 'relation_model']}
(workspace / 'telora-lock.json').write_text(json.dumps(lock))
path = workspace / 'relation_model/src/typed_relations.telora'
source = path.read_text().replace('type TenantRow = struct { id: TenantId };', 'type TenantRow = struct { id: TenantId, load: Float, capacity: Float };')
original = '[id_dimension(tenants, TenantId.type, "id", "tenant_id")]'
extra = ', '.join(f'g::numeric_binding(tenants, g::numeric_group("shared_numeric", Float.type, [g::Statistic::Mean]), g::input(m::field(TenantRow.type, Float.type, "{field}")), [{{member: g::Statistic::Mean, publish: "{field}_mean"}}])' for field in ['load', 'capacity'])
assert original in source
source = source.replace(original, original[:-1] + ', ' + extra + ']')
source = source.replace('allowed_aggregates: [qb::AggregateFunction::Count]', 'allowed_aggregates: [qb::AggregateFunction::Count, qb::AggregateFunction::Avg]')
source = source.replace('g::dimension(dataset,', 'g::checked_dimension(dataset,')
path.write_text(source)
print(json.dumps({'workspace': str(workspace)}), flush=True)


def run(command, **options):
    result = subprocess.run([str(x) for x in command], capture_output=True, text=True, timeout=600, **options)
    assert result.returncode == 0, result.stderr + result.stdout
    return result


def metadata(path):
    data = path.read_bytes()
    cursor = 8

    def word():
        nonlocal cursor
        value, shift = 0, 0
        while True:
            byte = data[cursor]
            cursor += 1
            value |= (byte & 127) << shift
            if not byte & 128:
                return value
            shift += 7

    found = []
    while cursor < len(data):
        kind = data[cursor]
        cursor += 1
        size = word()
        end = cursor + size
        if kind == 0:
            length = word()
            name = data[cursor:cursor + length].decode()
            cursor += length
            if name == 'telora.service.metadata':
                found.append(json.loads(data[cursor:end]))
        cursor = end
    assert len(found) == 1
    return found[0]['entries']['ontology.knowledge']


artifacts = {}
for mode in ['full', 'runtime']:
    artifact = workspace / f'relation-{mode}.wasm'
    result = run([args.telora.resolve(), '-C', workspace / 'relation_model', 'build', 'relation_model', f'--snapshot={mode}', '-o', artifact, '--initialization-fuel', '400000', '--with-memory-limit', '2048', '--report-usage'])
    artifact.with_suffix('.log').write_text(result.stderr)
    artifacts[mode] = artifact
full, runtime = [metadata(artifacts[mode]) for mode in ['full', 'runtime']]
assert full == runtime
assert "<TypeId:" not in json.dumps(runtime)
facts = {fact['key']: fact for fact in runtime['facts']}
for fact in facts.values():
    for reference in fact['references']:
        assert reference in facts, (fact['key'], reference)
groups = [f for f in facts.values() if f['key'].startswith('measure_groups/') and f['value'].get('name') == 'shared_numeric']
assert len(groups) == 1
bindings = [f for f in facts.values() if '#bindings/' in f['key'] and f['value'].get('group') == groups[0]['key']]
assert len(bindings) == 2
assert bindings[0]['key'] != bindings[1]['key']
assert {b['value']['members'][0]['input']['input']['name'] for b in bindings} == {'load', 'capacity'}
query = {'method': 'relation/transform', 'input': {'intents': [{'op': 'Graph', 'root': 'r', 'nodes': [{'id': 'r', 'entity': 'tenant'}], 'edges': [], 'select': [{'node': 'r', 'dimension': 'tenant_id'}], 'measures': [{'node': 'r', 'measure': 'load_mean'}, {'node': 'r', 'measure': 'capacity_mean'}]}]}}
requests = [query, {'method': 'relation/transform', 'input': None}, query]
responses = []
for mode, artifact in artifacts.items():
    result = run([args.runner.resolve(), artifact, '--serve', 'stdio+jsonl://'], input=''.join(json.dumps(q) + '\n' for q in requests))
    responses.append([json.loads(line) for line in result.stdout.splitlines()])
assert responses[0] == responses[1]
assert responses[0][0]['ok']['accepted'] is True, responses[0][0]
assert responses[0][1]['error'] is True
report = {'workspace': str(workspace), 'artifacts': {mode: {'path': str(path), 'bytes': path.stat().st_size} for mode, path in artifacts.items()}, 'facts': len(facts), 'shared_group_bindings': len(bindings), 'responses_identical': True, 'metadata_identical': True}
(workspace / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report), flush=True)
