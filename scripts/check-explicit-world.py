#!/usr/bin/env python3
"""Explore explicit World coverage, publication equivalence and staged transform."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASE = Path(os.environ.get('TMPDIR') or Path.home() / '.cache/tmp')
BASE.mkdir(parents=True, exist_ok=True)
COMPILER = Path(os.environ.get('TELORA', ROOT / 'bin/telora')).resolve()
RUNNER = Path(os.environ.get('TELORA_RUN', ROOT / 'bin/telora-run')).resolve()
workspace = Path(tempfile.mkdtemp(prefix='explicit-world-', dir=BASE))
for name in ['ontology', 'relation_model']:
    shutil.copytree(ROOT / name, workspace / name, ignore=shutil.ignore_patterns('target', '*.wasm'))
(workspace / 'telora-config.json').write_text(json.dumps({'version': 1, 'members': ['ontology', 'relation_model']}))
lock = json.loads((ROOT / 'telora-lock.json').read_text())
lock['packages'] = {name: lock['packages'][name] for name in ['ontology', 'relation_model']}
(workspace / 'telora-lock.json').write_text(json.dumps(lock))
print(json.dumps({'workspace': str(workspace)}), flush=True)


def run(command, **options):
    result = subprocess.run([str(x) for x in command], text=True, capture_output=True, timeout=300, **options)
    assert result.returncode == 0, result.stderr + result.stdout
    return result


def evaluate(selector):
    return json.loads(run([COMPILER, '-C', workspace / 'relation_model', 'eval', selector,
                           '--initialization-fuel', '400000']).stdout)


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
        tag = data[cursor]
        cursor += 1
        size = word()
        end = cursor + size
        if tag == 0:
            size = word()
            name = data[cursor:cursor + size].decode()
            cursor += size
            if name == 'telora.build.information':
                return json.loads(data[cursor:end])['entries']['ontology.knowledge']
        cursor = end
    raise AssertionError('missing knowledge publication')


def collect(name, data):
    source = workspace / (name + '.json')
    target = workspace / (name + '.collected.json')
    source.write_text(json.dumps(data))
    plugin = ROOT.parent / 'dsh-oks'
    run(['node', '--import', plugin / 'packages/dsh-oks/scripts/markdown-loader.mjs',
         plugin / 'scripts/collect-model-knowledge.mjs', source, target])
    return json.loads(target.read_text())


def normalize(graph):
    facts = graph['facts']
    keys = {f['key'] for f in facts}
    assert len(keys) == len(facts)
    for fact in facts:
        assert set(fact['references']) <= keys, fact
    return {**graph, 'facts': sorted([{**f, 'references': sorted(set(f['references']))} for f in facts], key=lambda f: f['key'])}


library = workspace / 'relation_model/src/lib.telora'
service_source = library.read_text()
# eval initializes the selected crate's exports outside a build-time scope.
# Keep the same model modules, with the Service publication root absent.
library.write_text('mod model;\npub mod typed_relations;\npub mod explicit_world;\n')
issues = evaluate('@test/explicit_world:issues')
assert issues['valid'] == [] and issues['checked'] is True
assert issues['recursive_and_unreferenced'] == []
assert issues['missing_entity'] == [], 'referenced entities should be inferred'
expected = {'duplicate_entity': 'duplicate_entity',
            'missing_dataset': 'missing_dataset', 'duplicate_dataset': 'duplicate_dataset',
            'missing_relation': 'missing_relation', 'duplicate_relation': 'duplicate_relation',
            'conflicting_dataset': 'conflicting_dataset', 'missing_role': 'missing_role'}
for case, code in expected.items():
    assert any(issue['code'] == code and issue['path'] for issue in issues[case]), (case, issues[case])
extra = collect('extra', evaluate('@test/explicit_world:extra_publication'))
extra_graph = normalize(extra['graph'])
assert any(f['key'] == 'entities/unbound_entity' for f in extra_graph['facts'])
assert not any(f['value'].get('name', '').endswith('::Tree') for f in extra_graph['facts'] if isinstance(f['value'], dict) and isinstance(f['value'].get('name'), str))
(workspace / 'issues.json').write_text(json.dumps(issues, indent=2))
print(json.dumps({'coverageCases': len(expected), 'recursiveAndUnreferenced': True}), flush=True)

graph_source = (workspace / 'relation_model/tests/graph.telora').read_text()
graph_source = graph_source.replace('use crate::model::{ payload, Tenant, Site, Device, Connection, Route };',
    'use crate::model::{ Tenant, Site, Device, Connection, Route };\nuse crate::explicit_world::{model_world};\nuse ontology::world as world;\ndef payload: ontology::ontology::PreparedPayload = world::prepare(model_world).payload;')
(workspace / 'relation_model/tests/world_graph.telora').write_text(graph_source)
result = run([COMPILER, '-C', workspace / 'relation_model', 'test', 'world_graph',
              '--initialization-fuel', '400000', '--request-fuel', '1000000'])
summaries = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
summary = next(record for record in summaries if record.get('record') == 'summary')
assert summary['failed'] == 0 and summary['passed'] > 0 and not summary['aborted'], summary

runtime_source = (workspace / 'relation_model/tests/typed_relations.telora').read_text()
runtime_source = runtime_source.replace('t::payload', 'world::prepare(model_world).payload')
runtime_source = 'use crate::explicit_world::{model_world};\nuse ontology::world as world;\n' + runtime_source
(workspace / 'relation_model/tests/world_runtime.telora').write_text(runtime_source)
queries = workspace / 'queries.json'
queries.write_text(json.dumps(evaluate('@test/world_runtime:runtime_cases')))
runtime = run(['node', ROOT / 'relation_model/tests/typed-relations-runtime.mjs', queries])
print(runtime.stdout.strip(), flush=True)

artifacts = {}
graphs = {}
responses = {}
queries = [
    {'method': 'relation/transform', 'input': {'intents': [{'op': 'Graph', 'root': 'device', 'nodes': [{'id': 'device', 'entity': 'device'}], 'edges': [], 'select': [{'node': 'device', 'dimension': 'device_id'}]}]}},
    {'method': 'relation/transform', 'input': None},
]
for mode in ['discovery', 'world']:
    source = service_source
    if mode == 'discovery':
        source = source.replace('use ontology::world as world;', 'use ontology::world as build;')
        source = source.replace('world::stage(model_world,', 'build::stage_prepared(build::define(prepared.payload.revision, prepared.declarations, prepared.relations, prepared.alternatives, [], prepared.payload.profile), fn() { prepared },')
    library.write_text(source)
    artifact = workspace / (mode + '.wasm')
    result = run([COMPILER, '-C', workspace / 'relation_model', 'build', 'relation_model',
                  '--staged', '-o', artifact, '--initialization-fuel', '400000', '--with-memory-limit', '2048', '--report-usage'])
    (workspace / (mode + '.log')).write_text(result.stderr)
    phases = {p['phase']: p['elapsed_seconds'] for line in result.stderr.splitlines() if line.startswith('{')
              for p in [json.loads(line)] if p.get('code') == 'build-phase-timing'}
    data = metadata(artifact)
    collected = collect(mode, data)
    graphs[mode] = normalize(collected['graph'])
    responses[mode] = [json.loads(line) for line in run([RUNNER, artifact, '--serve', 'stdio+jsonl://'],
        input=''.join(json.dumps(q) + '\n' for q in queries)).stdout.splitlines()]
    artifacts[mode] = {'bytes': artifact.stat().st_size, 'phases': phases}
# World 内联匿名结构；比较业务节点以及具名类型的可见成员。
def semantic_graph(graph):
    anonymous = {f['key'] for f in graph['facts']
                 if f['key'].startswith('types/') and '#' not in f['key'] and f['value'].get('name') is None}
    facts = []
    for fact in graph['facts']:
        if fact['key'] in anonymous:
            continue
        value = dict(fact['value'])
        if fact['key'].startswith('types/') and '#' not in fact['key']:
            value.pop('representation', None)
        facts.append({**fact, 'value': value, 'references': [r for r in fact['references'] if r not in anonymous]})
    return {**graph, 'facts': facts}


assert semantic_graph(graphs['discovery']) == semantic_graph(graphs['world']), 'semantic graph differs'
assert responses['discovery'] == responses['world'], responses
assert responses['world'][0]['ok']['accepted'] is True and responses['world'][1]['error'] is True
report = {'workspace': str(workspace), 'coverageCases': len(expected), 'semanticGraphEquivalent': True,
          'facts': len(graphs['world']['facts']), 'graphRegressionCases': summary['passed'],
          'responsesIdentical': True, 'artifacts': artifacts}
(workspace / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report), flush=True)
