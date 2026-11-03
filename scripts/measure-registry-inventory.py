#!/usr/bin/env python3
"""在隔离的 relation_model 中测量原始声明与分类收集；不准备 transform 或发布知识。"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repeats', type=int, default=1)
args = parser.parse_args()
if args.repeats < 1:
    parser.error('--repeats must be positive')
base = Path(os.environ.get('TMPDIR') or Path.home() / '.cache/tmp')
base.mkdir(parents=True, exist_ok=True)
output = Path(tempfile.mkdtemp(prefix='registry-inventory-', dir=base))
workspace = output / 'workspace'
workspace.mkdir()
for name in ('ontology', 'relation_model'):
    shutil.copytree(ROOT / name, workspace / name)
for name in ('telora-config.json', 'telora-lock.json'):
    shutil.copy2(ROOT / name, workspace / name)
config = json.loads((workspace / 'telora-config.json').read_text())
config['members'] = ['ontology', 'relation_model']
config['runtime'].update(initializationFuel=20000, requestFuel=20000, memoryLimit=256)
(workspace / 'telora-config.json').write_text(json.dumps(config))
lock = json.loads((workspace / 'telora-lock.json').read_text())
lock['packages'] = {key: value for key, value in lock['packages'].items() if key in config['members']}
(workspace / 'telora-lock.json').write_text(json.dumps(lock))
ontology = workspace / 'ontology/src'
shutil.copy2(ROOT / 'scripts/registry-inventory/collect.telora', ontology / 'inventory.telora')
with (ontology / 'lib.telora').open('a') as file:
    file.write('\npub mod inventory;\n')
# A selected entry cannot accidentally use full Registry initialization.
p = ontology / 'registry.telora'
p.write_text(p.read_text().replace('t::local_definition(compute_declaration(row))',
                                 'fail!("inventory called full Registry initialization")'))
p = workspace / 'relation_model/src/typed_relations.telora'
source = p.read_text()
start = source.index('def prepared:')
end = source.index('pub use self::{', start)
source = source[:start] + source[end:]
source = source.replace('    prepared,\n', '').replace('    payload\n', '')
p.write_text(source)
(workspace / 'relation_model/src/lib.telora').write_text('pub mod typed_relations;\n')
prefix = '''use crate::typed_relations as original;
use ontology::inventory as inventory;
use std::array as array;
use std::codec as codec;
use std::value::{Value};
type Counts = struct { datasets: Int, entities: Int, relations: Int };
def roots: Array(Type) = [original::TenantIdentity.type, original::SiteIdentity.type,
    original::DeviceIdentity.type, original::ConnectionIdentity.type, original::RouteIdentity.type];
'''
entries = {
    'declarations': 'codec::encode({datasets: array::length(original::datasets), entities: array::length(roots), relations: array::length(original::declarations)}.ty!(Counts))',
    'inventory': '''inventory::manifest(inventory::collect_declarations(
        original::datasets, roots,
        array::concat([original::declarations, [original::connected.a, original::connected.z,
            original::upstream.a, original::upstream.z]])
    ))''',
}
def information(path):
    data = path.read_bytes()
    def leb(pos):
        result = shift = 0
        while True:
            value = data[pos]
            pos += 1
            result |= (value & 127) << shift
            if value < 128:
                return result, pos
            shift += 7
    pos = 8
    while pos < len(data):
        tag = data[pos]
        size, start = leb(pos + 1)
        end = start + size
        if tag == 0:
            length, body = leb(start)
            if data[body:body + length] == b'telora.build.information':
                return json.loads(data[body + length:end])['entries']['inventory.summary']
        pos = end
    raise AssertionError('build information missing')

service = r"""
use std::build as build;
use std::transform_service as service;
def result: Value = build::stage(
    fn() {
        let result = EXPRESSION;
        {runtime: result, information: {"inventory.summary": result}}
    },
    fn(result) { result }
);
type QueryService = struct { value: Value };
impl service::TransformService for QueryService {
    init: fn(ctx) { {value: result}.ty!(Self) },
    transform: fn(self, input) { self.value },
};
@service::collection
pub type MainService = struct {
    @service::slot("inventory/summary") query: QueryService,
};
"""
tests = workspace / 'relation_model/tests'
shutil.copy2(ROOT / 'scripts/registry-inventory/tests.telora', tests / 'inventory.telora')
completed = subprocess.run([str(ROOT / 'bin/telora'), '-C', str(workspace / 'relation_model'), 'test', 'inventory'],
                           capture_output=True, text=True, timeout=120)
(output / 'tests.log').write_text(completed.stdout + completed.stderr)
if completed.returncode:
    print(completed.stdout + completed.stderr)
    print(f'Logs: {output}')
    raise SystemExit(completed.returncode)
print('Inventory contracts passed', flush=True)
rows = []
for mode, expression in entries.items():
    (workspace / 'relation_model/src/lib.telora').write_text(
        'pub mod typed_relations;\n' + prefix + service.replace('EXPRESSION', expression))
    for repeat in range(args.repeats):
        artifact = output / f'{mode}-{repeat}.wasm'
        start = time.monotonic()
        completed = subprocess.run([
            str(ROOT / 'bin/telora'), '-C', str(workspace / 'relation_model'), 'build',
            'relation_model', '--staged', '-o', str(artifact), '--report-usage',
        ], capture_output=True, text=True, timeout=120)
        elapsed = time.monotonic() - start
        (output / f'{mode}-{repeat}.stdout').write_text(completed.stdout)
        (output / f'{mode}-{repeat}.stderr').write_text(completed.stderr)
        diagnostics = [json.loads(line) for line in completed.stderr.splitlines() if line.startswith('{')]
        row = {'mode': mode, 'repeat': repeat, 'elapsed_seconds': elapsed, 'exit_code': completed.returncode,
               'phases': {d['phase']: d['elapsed_seconds'] for d in diagnostics if d.get('code') == 'build-phase-timing'},
               'usage': [d for d in diagnostics if d.get('record') == 'buildtime-usage']}
        rows.append(row)
        print(json.dumps(row), flush=True)
        if completed.returncode:
            print(completed.stderr[-6000:], flush=True)
            print(f'Logs: {output}', flush=True)
            raise SystemExit(completed.returncode)
        row['manifest'] = information(artifact)
        row['counts'] = row['manifest'].get('counts', row['manifest'])
        expected = {'datasets': 5, 'entities': 5, 'relations': 8}
        if mode == 'inventory':
            expected.update(fields=23, dimensions=3, measures=1, dimension_groups=3, measure_groups=0, types=5)
        assert row['counts'] == expected, row
        print(json.dumps(row['counts']), flush=True)
(output / 'measurements.json').write_text(json.dumps(rows, indent=2) + '\n')
print(f'Logs: {output}', flush=True)
