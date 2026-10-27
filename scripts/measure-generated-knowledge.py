#!/usr/bin/env python3
"""用 JS 生成样本的累积截断构建，诊断知识准备各阶段成本；只写隔离临时目录。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
STAGES = ['prepare', 'seeds', 'types', 'type_facts', 'dataset_facts', 'capabilities', 'merge', 'encode']
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--counts', default='5,10,20,40')
parser.add_argument('--dimensions', type=int, default=10)
parser.add_argument('--field-types', choices=['plain', 'shared', 'distinct'], default='distinct')
parser.add_argument('--repeats', type=int, default=1)
parser.add_argument('--reverse', action='store_true', help='反向运行阶段，检查顺序偏差')
parser.add_argument('--telora', type=Path, default=ROOT / 'bin/telora')
parser.add_argument('--runner', type=Path, default=ROOT / 'bin/telora-run')
args = parser.parse_args()
assert args.repeats > 0
compiler, runner = args.telora.resolve(), args.runner.resolve()
base = Path(os.environ.get('TMPDIR') or Path.home() / '.cache/tmp')
base.mkdir(parents=True, exist_ok=True)
output = Path(tempfile.mkdtemp(prefix='knowledge-distribution-', dir=base))
generated = subprocess.run(['node', str(ROOT / 'scripts/generate-dataset-scale-samples.mjs'),
    '--output', str(output / 'workspace'), '--counts', args.counts,
    '--dimensions', str(args.dimensions), '--field-types', args.field_types],
    check=True, capture_output=True, text=True)
workspace = Path(json.loads(generated.stdout)['output'])
cases = json.loads((workspace / 'experiment.json').read_text())['cases']
knowledge = workspace / 'ontology/src/knowledge.telora'
original = knowledge.read_text()
start = original.index('    let seeds =', original.index('def export:'))
passes = original.index('    let passes =', start)
merge = original.index('    # 类内重复', passes)
finish = original.index('    object([("knowledge_contract"', merge)
end = original.index('\n};', finish)
seed_part = original[start:passes]
seed_end = seed_part.index('    let types =')
merge_part = original[merge:finish]
result_part = original[finish:end]
type_facts = 'array::map(array::filter(types, fn(ty) { !inline_type(ty) }), type_fact)'
dataset_facts = 'array::flat_map(array::enumerate(prepared.declarations), fn(pair) { dataset_facts(pair.1, prepared.payload.entities[pair.0]) })'


def export_source(stage):
    parts = []
    if stage == 'prepare':
        body = '    codec::encode(array::length(prepared.declarations))'
    else:
        parts.append(seed_part[:seed_end])
        count = 'array::length(seeds)'
        if STAGES.index(stage) >= STAGES.index('types'):
            parts.append(seed_part[seed_end:])
            count = 'array::length(types)'
        if STAGES.index(stage) >= STAGES.index('type_facts'):
            parts.append(f'    let type_pass = {type_facts};\n')
            count = 'array::length(type_pass)'
        if STAGES.index(stage) >= STAGES.index('dataset_facts'):
            parts.append(f'    let dataset_pass = {dataset_facts};\n')
            count += ' + array::length(dataset_pass)'
        if STAGES.index(stage) >= STAGES.index('capabilities'):
            parts.append('    let capability_pass = capability_facts(prepared.payload);\n    let relation_pass = relation_sources(prepared);\n')
            count += ' + array::length(capability_pass) + array::length(relation_pass)'
        if STAGES.index(stage) >= STAGES.index('merge'):
            parts.append('    let passes = [type_pass, dataset_pass, capability_pass, relation_pass];\n' + merge_part)
            count = 'array::length(dict::values(merged))'
        parts.append(result_part if stage == 'encode' else f'    codec::encode({count})')
        body = ''.join(parts)
    return original[:start] + body + original[end:]

# Every variant has the same model, transform path and stage boundary.
for case in cases:
    path = workspace / case['name'] / 'src/lib.telora'
    source = path.read_text()
    source = 'use ontology::world as build;\n' + source
    source = source.replace('type QueryService =', '''def lower: Fn(Value) -> Value = build::stage_prepared(build::define(prepared.payload.revision, prepared.declarations, prepared.relations, prepared.alternatives, [], prepared.payload.profile), fn() { prepared }, fn(payload) {
    intent::query_request_method_factory(payload, sqlite::build_query)
});
type QueryService =''')
    source = source.replace('lower: intent::query_request_method_factory(prepared.payload, sqlite::build_query)', 'lower: lower')
    path.write_text(source)

report = {'workspace': str(workspace), 'compiler': str(compiler),
    'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    'knowledgeSourceSha256': hashlib.sha256(original.encode()).hexdigest(),
    'compilerSha256': hashlib.sha256(compiler.read_bytes()).hexdigest(),
    'dimensions': args.dimensions, 'fieldTypes': args.field_types,
    'method': 'Cumulative truncation of actual build-time knowledge export; differences are estimates, not nested timers. GC/liveness and output-size differences can affect deltas. No model self-check or plugin link derivation.',
    'observations': []}
print(json.dumps({'output': str(output), 'cases': cases}), flush=True)
for repeat in range(args.repeats):
    # Alternate ordering on subsequent rounds to reduce warm/order bias.
    for case in cases:
        for stage in (STAGES if (repeat + int(args.reverse)) % 2 == 0 else list(reversed(STAGES))):
            knowledge.write_text(export_source(stage))
            label = f"{case['name']}-{stage}-{repeat}"
            artifact, log = output / f'{label}.wasm', output / f'{label}.log'
            began = time.monotonic()
            with log.open('w') as stream:
                result = subprocess.run([str(compiler), '-C', str(workspace / case['name']),
                    'build', case['name'], '--staged', '-o', str(artifact),
                    '--initialization-fuel', '400000', '--request-fuel', '100000',
                    '--with-memory-limit', '2048', '--report-usage'], stdout=stream, stderr=stream, timeout=600)
            assert result.returncode == 0, log.read_text()
            phases = {}
            for line in log.read_text().splitlines():
                if line.startswith('{'):
                    record = json.loads(line)
                    if record.get('code') == 'build-phase-timing':
                        phases[record['phase']] = record['elapsed_seconds']
            request = (workspace / case['name'] / 'request.json').read_text()
            response = subprocess.run([str(runner), str(artifact)], input=request,
                capture_output=True, text=True, check=True, timeout=120)
            value = json.loads(response.stdout)
            assert value['accepted'], response.stdout
            # Compare all variants against the same model's transform response.
            expected = output / f"{case['name']}-response.json"
            if expected.exists():
                assert json.loads(expected.read_text()) == value
            else:
                expected.write_text(response.stdout)
            observation = {'datasets': case['count'], 'stage': stage, 'repeat': repeat,
                'phases': phases, 'bytes': artifact.stat().st_size,
                'wallSeconds': time.monotonic() - began, 'log': str(log)}
            if stage == 'encode':
                data = artifact.read_bytes()
                cursor = 8
                def word():
                    global cursor
                    value, shift = 0, 0
                    while True:
                        byte = data[cursor]
                        cursor += 1
                        value |= (byte & 127) << shift
                        if not byte & 128:
                            return value
                        shift += 7
                while cursor < len(data):
                    kind = data[cursor]
                    cursor += 1
                    size = word()
                    section_end = cursor + size
                    if kind == 0:
                        length = word()
                        name = data[cursor:cursor + length].decode()
                        cursor += length
                        if name == 'telora.build.information':
                            publication = json.loads(data[cursor:section_end])['entries']['ontology.knowledge']
                            facts = publication['facts']
                            observation['knowledge'] = {'facts': len(facts),
                                'typeNodes': sum(f['key'].startswith('types/') for f in facts),
                                'sectionBytes': section_end - cursor}
                    cursor = section_end
                assert 'knowledge' in observation
            report['observations'].append(observation)
            (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps({'datasets': case['count'], 'stage': stage, 'repeat': repeat,
                'prepareSeconds': phases['service_prepare'], 'buildSeconds': phases['total']}), flush=True)
            artifact.unlink()  # Diagnostic variants are not deployable; retain source and logs.
knowledge.write_text(original)
summary = []
for case in cases:
    medians = {stage: statistics.median(o['phases']['service_prepare'] for o in report['observations']
        if o['datasets'] == case['count'] and o['stage'] == stage) for stage in STAGES}
    summary.append({'datasets': case['count'], 'cumulativeSeconds': medians,
        'incrementalSeconds': {stage: medians[stage] - (medians[STAGES[i - 1]] if i else 0)
            for i, stage in enumerate(STAGES)}})
report['summary'] = summary
(output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'report': str(output / 'report.json'), 'summary': summary}), flush=True)
