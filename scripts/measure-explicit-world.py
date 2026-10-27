#!/usr/bin/env python3
"""Measure discovery, explicit World and type memoization independently."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--counts', default='5,20,40')
parser.add_argument('--ic', action='store_true', help='also compare IC with/without type-id memoization')
args = parser.parse_args()
compiler = Path(os.environ.get('TELORA', ROOT / 'bin/telora')).resolve()


def run(command):
    result = subprocess.run([str(x) for x in command], text=True, capture_output=True, timeout=600)
    assert result.returncode == 0, result.stderr + result.stdout
    return result


generated = json.loads(run(['node', ROOT / 'scripts/generate-dataset-scale-samples.mjs',
    '--counts', args.counts, '--dimensions', '10', '--field-types', 'distinct']).stdout)
workspace = Path(generated['output'])
print(json.dumps({'workspace': str(workspace)}), flush=True)
knowledge_file = workspace / 'ontology/src/knowledge.telora'
knowledge_source = knowledge_file.read_text()
assert 'memo::computed_with_type(type_ids, ty)' in knowledge_source
cases = generated['cases']
if args.ic:
    shutil.copytree(ROOT / 'icloud_model', workspace / 'icloud_model', ignore=shutil.ignore_patterns('target', '*.wasm'))
    config = json.loads((workspace / 'telora-config.json').read_text())
    config['members'].append('icloud_model')
    (workspace / 'telora-config.json').write_text(json.dumps(config))
    lock = json.loads((workspace / 'telora-lock.json').read_text())
    lock['packages']['icloud_model'] = json.loads((ROOT / 'telora-lock.json').read_text())['packages']['icloud_model']
    (workspace / 'telora-lock.json').write_text(json.dumps(lock))
    cases.append({'name': 'icloud_model', 'count': 50})


def metadata(path):
    data = path.read_bytes()
    cursor = 8

    def word():
        nonlocal cursor
        value = shift = 0
        while True:
            byte = data[cursor]
            cursor += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value
            shift += 7

    while cursor < len(data):
        kind = data[cursor]
        cursor += 1
        size = word()
        end = cursor + size
        if kind == 0:
            size = word()
            name = data[cursor:cursor + size].decode()
            cursor += size
            if name == 'telora.build.information':
                return json.loads(data[cursor:end])['entries']['ontology.knowledge']
        cursor = end
    raise AssertionError('missing publication')


def normalize(graph):
    facts = graph['facts']
    keys = {f['key'] for f in facts}
    assert len(keys) == len(facts)
    for fact in facts:
        assert set(fact['references']) <= keys
    return {**graph, 'facts': sorted([{**f, 'references': sorted(set(f['references']))} for f in facts], key=lambda f: f['key'])}


report = {'workspace': str(workspace), 'cases': []}
for case in cases:
    name = case['name']
    path = workspace / name / 'src/lib.telora'
    original = path.read_text()
    if name != 'icloud_model':
        n = case['count']
        # The generator knows every declaration; the manifest is emitted from
        # those inputs, not discovered through runtime reflection.
        manifest = '''
use ontology::world as world;
use ontology::world as staged_build;
def model_world: world::World = world::define("dataset-scale-v1", declarations, [], [], [], profile);
def lower: Fn(Value) -> Value = STAGE(fn(payload) { intent::query_request_method_factory(payload, sqlite::build_query) });
'''
    graphs = {}
    measurements = {}
    for variant in (['discovery', 'memo'] if name == 'icloud_model' else ['discovery', 'world', 'world_memo']):
        memo = variant in ['memo', 'world_memo']
        knowledge_file.write_text(knowledge_source if memo else knowledge_source.replace('memo::computed_with_type(type_ids, ty)', 'compute_type_id(ty)'))
        if name != 'icloud_model':
            stage = 'staged_build::stage_prepared(staged_build::define(prepared.payload.revision, prepared.declarations, prepared.relations, prepared.alternatives, [], prepared.payload.profile), fn() { prepared }, ' if variant == 'discovery' else 'world::stage(model_world, '
            source = original.replace('type QueryService =', manifest.replace('STAGE(', stage) + '\ntype QueryService =')
            source = source.replace('{lower: intent::query_request_method_factory(prepared.payload, sqlite::build_query)}', '{lower: lower}')
            path.write_text(source)
        artifact = workspace / (name + '-' + variant + '.wasm')
        result = run([compiler, '-C', workspace / name, 'build', name, '--staged', '-o', artifact,
            '--initialization-fuel', '400000', '--request-fuel', '100000', '--with-memory-limit', '2048', '--report-usage'])
        (workspace / (name + '-' + variant + '.log')).write_text(result.stderr)
        phases = {p['phase']: p['elapsed_seconds'] for line in result.stderr.splitlines() if line.startswith('{')
                  for p in [json.loads(line)] if p.get('code') == 'build-phase-timing'}
        publication = metadata(artifact)
        publication_path = workspace / (name + '-' + variant + '.json')
        publication_path.write_text(json.dumps(publication))
        collected_path = publication_path.with_suffix('.collected.json')
        plugin = ROOT.parent / 'dsh-oks'
        run(['node', '--import', plugin / 'packages/dsh-oks/scripts/markdown-loader.mjs',
             plugin / 'scripts/collect-model-knowledge.mjs', publication_path, collected_path])
        graphs[variant] = normalize(json.loads(collected_path.read_text())['graph'])
        assert graphs[variant] == graphs['discovery'], (name, variant, 'graph differs')
        measurements[variant] = {'bytes': artifact.stat().st_size, 'phases': phases}
        print(json.dumps({'model': name, 'variant': variant, 'prepare': phases['service_prepare'],
                          'total': phases['total'], 'bytes': artifact.stat().st_size, 'graphEquivalent': True}), flush=True)
    report['cases'].append({'model': name, 'datasets': case['count'], 'facts': len(graphs['discovery']['facts']), 'measurements': measurements})
    (workspace / 'world-report.json').write_text(json.dumps(report, indent=2) + '\n')
knowledge_file.write_text(knowledge_source)
print(json.dumps({'report': str(workspace / 'world-report.json')}), flush=True)
