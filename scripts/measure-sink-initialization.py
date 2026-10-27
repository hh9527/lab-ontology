#!/usr/bin/env python3
"""Compare array-scan discovery with private lazy-pipeline collection.

Only temporary model copies are modified. Extra diagnostic variants can isolate
preparation, type discovery, or the existing fused Seq Array collector.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--telora', type=Path, required=True)
p.add_argument('--counts', default='5,40')
p.add_argument('--ic', action='store_true')
p.add_argument('--variants', default='baseline,current')
p.add_argument('--baseline-ref', default='1232a99', help='Git revision of the array-scan baseline')
args = p.parse_args()
base = Path(os.environ.get('TMPDIR') or Path.home() / '.cache/tmp')
base.mkdir(parents=True, exist_ok=True)
output = Path(tempfile.mkdtemp(prefix='sink-initialization-', dir=base))


def run(command, **options):
    result = subprocess.run([str(x) for x in command], capture_output=True,
                            text=True, timeout=600, **options)
    assert result.returncode == 0, result.stderr + result.stdout
    return result


generated = json.loads(run(['node', ROOT / 'scripts/generate-dataset-scale-samples.mjs',
    '--output', output / 'workspace', '--counts', args.counts,
    '--dimensions', '10', '--field-types', 'distinct']).stdout)
workspace = Path(generated['output'])
cases = generated['cases']
if args.ic:
    shutil.copytree(ROOT / 'icloud_model', workspace / 'icloud_model',
                    ignore=shutil.ignore_patterns('target', '*.wasm'))
    config = json.loads((workspace / 'telora-config.json').read_text())
    config['members'].append('icloud_model')
    (workspace / 'telora-config.json').write_text(json.dumps(config))
    lock = json.loads((workspace / 'telora-lock.json').read_text())
    lock['packages']['icloud_model'] = json.loads((ROOT / 'telora-lock.json').read_text())['packages']['icloud_model']
    (workspace / 'telora-lock.json').write_text(json.dumps(lock))
    cases.append({'name': 'icloud_model', 'count': 50})
for case in cases:
    if case['name'] == 'icloud_model':
        continue
    path = workspace / case['name'] / 'src/lib.telora'
    source = 'use ontology::experimental::build as staged_build;\n' + path.read_text()
    source = source.replace('type QueryService =', '''def lower: Fn(Value) -> Value = staged_build::stage(fn() { prepared }, fn(payload) {
    intent::query_request_method_factory(payload, sqlite::build_query)
});
type QueryService =''')
    source = source.replace('lower: intent::query_request_method_factory(prepared.payload, sqlite::build_query)', 'lower: lower')
    path.write_text(source)
knowledge = workspace / 'ontology/src/experimental/knowledge.telora'
current_source = knowledge.read_text()
original = run(['git', 'show', args.baseline_ref + ':ontology/src/experimental/knowledge.telora'], cwd=ROOT).stdout
start = original.index('def collect_types:')
end = original.index('def type_fact:', start)
indexed = '''use std::pipeline as pipeline;
def collect_types: Fn(Array(Type), Array(Type)) -> Array(Type) = fn(pending, seen) {
    collect_indexed(pending, dict::from_pairs(array::map(seen, fn(ty) { (type_id(ty), ty) })))
};
# 每轮组合既有类型与待发现类型，索引和去重状态封装在 pipeline 内。
def collect_indexed: Fn(Array(Type), Dict(Type)) -> Array(Type) = fn(pending, seen) {
    let nodes = pipeline::merge(pipeline::from_array(dict::values(seen)), pipeline::from_array(pending));
    let next = pipeline::run(nodes |> pipeline::collect_dict(type_id, fn(ty) { ty }));
    let fresh = array::filter(dict::values(next), fn(ty) { dict::get(seen, type_id(ty)) == None });
    if fresh == [] { dict::values(next) }
    else { collect_indexed(array::flat_map(fresh, type_dependencies), next) }
};
'''


def array_fusion(source):
    prefix = 'codec::encode(array::map('
    while prefix in source:
        start = source.index(prefix)
        cursor, depth, quote = start + len('codec::encode('), 1, None
        while depth:
            char = source[cursor]
            if quote:
                if char == '\\':
                    cursor += 1
                elif char == quote:
                    quote = None
            elif char in ['"', '`']:
                quote = char
            elif char == '(':
                depth += 1
            elif char == ')':
                depth -= 1
            cursor += 1
        assert source[cursor - 2:cursor] == '))'
        source = source[:start] + 'encode_map(' + source[start + len(prefix):cursor - 2] + ')' + source[cursor:]
    return source + '''
use std::seq as seq;
def encode_map: for(A, B: codec::Encode) Fn(Array(A), Fn(A) -> B) -> Value = fn(items, mapper) {
    Value::Array(seq::collect(seq::map(seq::map(seq::from_array(items), mapper), fn(value) { codec::encode(value) })))
};
'''


def metadata(path):
    data, cursor = path.read_bytes(), 8
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


def normalize(data):
    # Type emission order is not semantic. Check every descriptor, instruction
    # and all other array order exactly; no graph links are omitted here.
    data = json.loads(json.dumps(data))
    instructions = data['data']['instructions']
    assert instructions[0][0] == 'types'
    types = instructions[0][1]
    assert len({t['id'] for t in types}) == len(types)
    types.sort(key=lambda t: t['id'])
    return data


report = {'workspace': str(workspace), 'compiler': str(args.telora.resolve()),
          'compilerSha256': hashlib.sha256(args.telora.read_bytes()).hexdigest(),
          'baselineRef': args.baseline_ref,
          'knowledgeSha256': hashlib.sha256(original.encode()).hexdigest(),
          'currentKnowledgeSha256': hashlib.sha256(current_source.encode()).hexdigest(), 'cases': []}
print(json.dumps({'output': str(output), 'cases': cases}), flush=True)
for case in cases:
    baseline = response = None
    for variant in args.variants.split(','):
        assert variant in ['baseline', 'dict', 'array', 'both', 'prepare', 'types', 'current']
        source = original[:start] + indexed + original[end:] if variant in ['dict', 'both'] else original
        if variant == 'current':
            source = current_source
        if variant in ['array', 'both']:
            source = array_fusion(source)
        if variant in ['prepare', 'types']:
            a = source.index('    let instructions =', source.index('def publication_from:'))
            b = source.index('\n};', a)
            source = source[:a] + ('    codec::encode(array::length(types))' if variant == 'types'
                else '    codec::encode(array::length(prepared.declarations))') + source[b:]
            if variant == 'prepare':
                a = source.index('    let seeds =', source.index('def publication:'))
                b = source.index('\n};', a)
                source = source[:a] + '    codec::encode(array::length(prepared.declarations))' + source[b:]
        knowledge.write_text(source)
        label = case['name'] + '-' + variant
        artifact = output / (label + '.wasm')
        result = run(['/usr/bin/time', '-f', 'SINK_MAX_RSS_KIB=%M', args.telora.resolve(),
            '-C', workspace / case['name'], 'build', case['name'], '--staged', '-o', artifact,
            '--initialization-fuel', '400000', '--request-fuel', '100000',
            '--with-memory-limit', '2048', '--report-usage'])
        (output / (label + '.log')).write_text(result.stderr)
        phases = {r['phase']: r['elapsed_seconds'] for line in result.stderr.splitlines()
                  if line.startswith('{') for r in [json.loads(line)] if r.get('code') == 'build-phase-timing'}
        rss = int(result.stderr.split('SINK_MAX_RSS_KIB=')[-1].splitlines()[0])
        observation = {'model': case['name'], 'variant': variant, 'phases': phases,
                       'bytes': artifact.stat().st_size, 'maxRssKiB': rss}
        if variant not in ['prepare', 'types']:
            publication = normalize(metadata(artifact))
            if baseline is None:
                baseline = publication
            assert baseline == publication, (label, 'publication differs')
            observation['publicationEquivalent'] = True
            observation['types'] = len(publication['data']['instructions'][0][1])
        query = (workspace / case['name'] / 'request.json').read_text() if case['name'] != 'icloud_model' else json.dumps({
            'method': 'ic/transform', 'input': {'intents': [{'op': 'Graph', 'root': 'r',
            'nodes': [{'id': 'r', 'entity': 'device'}], 'edges': [],
            'select': [{'node': 'r', 'dimension': 'device_id'}]}]}})
        value = json.loads(run([ROOT / 'bin/telora-run', artifact], input=query).stdout)
        assert value['accepted'], value
        if response is None:
            response = value
        assert response == value
        observation['transformEquivalent'] = True
        report['cases'].append(observation)
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(observation), flush=True)
knowledge.write_text(current_source)
print(json.dumps({'report': str(output / 'report.json')}), flush=True)
