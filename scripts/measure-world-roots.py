#!/usr/bin/env python3
"""Isolate explicit World roots, type projection and Dataset JSON preparation."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def build_information(path):
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
    raise AssertionError('missing build information')


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--model', default='ns_model', choices=['ns_model'])
parser.add_argument('--cases', default='prepare_only,roots,types,datasets,full')
args = parser.parse_args()
base = Path(os.environ.get('TMPDIR') or Path.home() / '.cache/tmp')
base.mkdir(parents=True, exist_ok=True)
workspace = Path(tempfile.mkdtemp(prefix='world-roots-', dir=base))
import io
import tarfile
archive = subprocess.run(['git', '-C', str(ROOT), 'archive', 'HEAD', 'ontology', args.model], capture_output=True, check=True).stdout
with tarfile.open(fileobj=io.BytesIO(archive)) as packed:
    packed.extractall(workspace, filter='data')
config = json.loads((ROOT / 'telora-config.json').read_text())
config['members'] = ['ontology', args.model]
(workspace / 'telora-config.json').write_text(json.dumps(config))
lock = json.loads((ROOT / 'telora-lock.json').read_text())
lock['packages'] = {name: lock['packages'][name] for name in config['members']}
(workspace / 'telora-lock.json').write_text(json.dumps(lock))
knowledge_path = workspace / 'ontology/src/knowledge.telora'
knowledge_path.write_text(knowledge_path.read_text() + '\npub use self::{raw_type, raw_dataset};\n')
world_path = workspace / 'ontology/src/world.telora'
world_source = world_path.read_text()
start = world_source.index('    ', world_source.index('def publication:'))
end = world_source.index('\n};', start)
expressions = {
    'prepare_only': 'codec::encode(True)',
    'roots': '''codec::encode({
        entities: array::map(world.entities, fn(e) { {id: e.id, identity: k::type_id(e.identity)}.ty!(RootEntity) }),
        datasets: array::map(world.datasets, fn(d) { {id: d.dataset.id, row: k::type_id(d.dataset.row)}.ty!(RootDataset) }),
        types: array::map(world.types, k::type_id)
    }.ty!(RootInventory))''',
    'types': 'Value::Array(array::map(knowledge_types(world), k::raw_type))',
    'datasets': '''Value::Array(array::map(array::enumerate(prepared.declarations), fn(pair) {
        k::raw_dataset(pair.1, prepared.payload.entities[pair.0])
    }))''',
    'full': world_source[start:end].strip(),
    'type_projection': 'codec::encode(array::map(knowledge_types(world), k::type_id))',
}
headers = '''codec::encode(array::map(world.types, fn(ty) {
    {id: k::type_id(ty), name: td::name(ty), kind: td::kind(ty),
     reverse_references: policy::allows_reverse_references(ty)}.ty!(RootTypeHeader)
}))'''
expressions['type_headers'] = headers
expressions['type_headers_json'] = f'codec::encode(json::stringify({headers}))'
report = {'workspace': str(workspace), 'model': args.model, 'measurements': {}}
print(json.dumps(report), flush=True)
for case in args.cases.split(','):
    expression = expressions[case]
    world_path.write_text(world_source[:start] + '    ' + expression + world_source[end:]
                          + '''
use std::codec as codec;
use std::json as json;
use crate::knowledge_policy as policy;
type RootTypeHeader = struct { id: String, name: Option(String), kind: td::TypeDescKind, reverse_references: Bool };
type RootEntity = struct { id: String, identity: String };
type RootDataset = struct { id: String, row: String };
type RootInventory = struct { entities: Array(RootEntity), datasets: Array(RootDataset), types: Array(String) };
''')
    artifact = workspace / f'{case}.wasm'
    result = subprocess.run([str((ROOT / 'bin/telora').resolve()), '-C', str(workspace / args.model),
                             'build', args.model, '--staged', '-o', str(artifact), '--report-usage'],
                            text=True, capture_output=True, timeout=600)
    (workspace / f'{case}.log').write_text(result.stderr + result.stdout)
    if result.returncode:
        raise RuntimeError(f'{case}: {result.stderr}')
    diagnostics = [json.loads(line) for line in result.stderr.splitlines() if line.startswith('{')]
    phases = {d['phase']: d['elapsed_seconds'] for d in diagnostics if d.get('code') == 'build-phase-timing'}
    report['measurements'][case] = {'phases': phases, 'bytes': artifact.stat().st_size,
                                    'usage': [d for d in diagnostics if d.get('record') == 'buildtime-usage']}
    information = build_information(artifact)
    (workspace / f'{case}.information.json').write_text(json.dumps(information, indent=2) + '\n')
    if case == 'roots':
        report['rootCounts'] = {key: len(items) for key, items in information.items()}
        for key, items in information.items():
            ids = items if key == 'types' else [item['id'] for item in items]
            assert len(ids) == len(set(ids)), f'duplicate {key} root'
    (workspace / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'case': case, **report['measurements'][case]}), flush=True)
