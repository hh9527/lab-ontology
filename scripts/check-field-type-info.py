#!/usr/bin/env python3
"""Build HEAD/unified World publications in isolation and compare semantics."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--model', default='ns_model', choices=['ns_model', 'icloud_model'])
parser.add_argument('--reuse', type=Path, help='Reuse a measured baseline and refresh candidate sources')
args = parser.parse_args()
base = Path(os.environ.get('TMPDIR') or Path.home() / '.cache/tmp')
base.mkdir(parents=True, exist_ok=True)
workspace = args.reuse.resolve() if args.reuse else Path(tempfile.mkdtemp(prefix='field-type-info-', dir=base))
for name in ['ontology', args.model]:
    if (workspace / name).exists():
        shutil.rmtree(workspace / name)
    shutil.copytree(ROOT / name, workspace / name, ignore=shutil.ignore_patterns('target', '*.wasm', '__pycache__'))
config = json.loads((ROOT / 'telora-config.json').read_text())
config['members'] = ['ontology', args.model]
(workspace / 'telora-config.json').write_text(json.dumps(config))
lock = json.loads((ROOT / 'telora-lock.json').read_text())
lock['packages'] = {name: lock['packages'][name] for name in config['members']}
(workspace / 'telora-lock.json').write_text(json.dumps(lock))


def run(command, **kwargs):
    result = subprocess.run([str(x) for x in command], text=True, capture_output=True, timeout=600, **kwargs)
    assert result.returncode == 0, result.stderr
    return result


def information(path):
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


report = {'workspace': str(workspace), 'model': args.model, 'measurements': {}}
print(json.dumps(report), flush=True)
graphs = {}
# Baseline is a complete HEAD workspace, so it uses its own publication program.
import io
import tarfile
baseline_dir = workspace / 'baseline-source'
baseline_dir.mkdir(exist_ok=True)
archive = subprocess.run(['git', '-C', str(ROOT), 'archive', 'HEAD', 'ontology', args.model,
                          'telora-config.json', 'telora-lock.json'], capture_output=True, check=True).stdout
with tarfile.open(fileobj=io.BytesIO(archive)) as packed:
    packed.extractall(baseline_dir, filter='data')
for variant, context in [('baseline', baseline_dir), ('world', workspace)]:
    config = json.loads((context / 'telora-config.json').read_text())
    config['members'] = ['ontology', args.model]
    (context / 'telora-config.json').write_text(json.dumps(config))
    lock = json.loads((context / 'telora-lock.json').read_text())
    lock['packages'] = {name: lock['packages'][name] for name in config['members']}
    (context / 'telora-lock.json').write_text(json.dumps(lock))
    artifact = workspace / f'{variant}.wasm'
    if variant == 'baseline' and args.reuse and artifact.exists():
        from types import SimpleNamespace
        built = SimpleNamespace(stderr=(workspace / 'baseline.log').read_text())
    else:
        built = run([ROOT / 'bin/telora', '-C', context / args.model, 'build', args.model,
                     '--staged', '-o', artifact, '--report-usage'])
        (workspace / f'{variant}.log').write_text(built.stderr)
    diagnostics = [json.loads(line) for line in built.stderr.splitlines() if line.startswith('{')]
    publication = information(artifact)
    publication_path = workspace / f'{variant}.json'
    publication_path.write_text(json.dumps(publication))
    instructions = publication['data']['instructions']
    collected = workspace / f'{variant}.collected.json'
    plugin = ROOT.parent / 'dsh-oks'
    run(['node', '--import', plugin / 'packages/dsh-oks/scripts/markdown-loader.mjs',
         plugin / 'scripts/collect-model-knowledge.mjs', publication_path, collected])
    graph = json.loads(collected.read_text())['graph']
    facts = {f['key']: f for f in graph['facts']}
    assert len(facts) == len(graph['facts'])
    for fact in facts.values():
        assert set(fact['references']) <= facts.keys(), fact
    graphs[variant] = facts
    report['measurements'][variant] = {
        'phases': {d['phase']: d['elapsed_seconds'] for d in diagnostics if d.get('code') == 'build-phase-timing'},
        'usage': next(d for d in diagnostics if d.get('record') == 'buildtime-usage'),
        'bytes': artifact.stat().st_size,
        'publicationBytes': len(json.dumps(publication, separators=(',', ':')).encode()),
        'typeDescriptions': len(instructions[0][1]), 'facts': len(facts),
        'fieldTypeDescriptions': sum(len(data) for op, data in instructions if op == 'field_types'),
    }
    (workspace / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'variant': variant, **report['measurements'][variant]}), flush=True)

def normalized(facts):
    return {key: {**fact, 'references': sorted(set(fact['references']))}
            for key, fact in facts.items() if not (key.startswith('types/') and '#' not in key)}


# Promotion changes qualified standard-type names and content-derived group IDs.
# Normalize only the former namespace and pair groups by their complete value.
old_text = json.dumps(list(graphs['baseline'].values())).replace('ontology%2Fexperimental%2F', 'ontology%2F').replace('ontology/experimental/', 'ontology/')
old_facts = json.loads(old_text)
new_groups = {(f['key'].split('/')[0], json.dumps(f['value'], sort_keys=True)): f['key']
              for f in graphs['world'].values()
              if f['key'].startswith(('dimension_groups/', 'measure_groups/'))}
renames = {}
for fact in old_facts:
    if fact['key'].startswith(('dimension_groups/', 'measure_groups/')):
        signature = (fact['key'].split('/')[0], json.dumps(fact['value'], sort_keys=True))
        if signature in new_groups:
            renames[fact['key']] = new_groups[signature]
def rename(value):
    if isinstance(value, str):
        return renames.get(value, value)
    if isinstance(value, list):
        return [rename(item) for item in value]
    if isinstance(value, dict):
        return {k: rename(v) for k, v in value.items()}
    return value
graphs['baseline'] = {f['key']: f for f in rename(old_facts)}

old_members = normalized(graphs['baseline'])
new_members = normalized(graphs['world'])
assert all(new_members.get(key) == fact for key, fact in old_members.items()), 'non-type knowledge changed'
removed = set(graphs['baseline']) - set(graphs['world'])
unused = {key for key in removed if graphs['baseline'][key]['value'].get('name') is not None}
assert all(key.startswith('types/') and '#' not in key for key in removed)
for key in unused:
    assert not any(key in fact['references'] for other, fact in graphs['baseline'].items() if other != key), key
added = set(graphs['world']) - set(graphs['baseline'])
assert all((key.startswith('types/') and '#' not in key and graphs['world'][key]['value'].get('name'))
           or key.startswith('entities/') for key in added), added
for key, fact in graphs['world'].items():
    if key.startswith('types/') and '#' not in key and key in graphs['baseline']:
        old = graphs['baseline'][key]
        for field in ['name', 'kind', 'reverse_references', 'arguments', 'field_types', 'variants']:
            assert fact['value'][field] == old['value'][field], (key, field)
report['verification'] = {'nonTypeFactsEquivalent': True, 'namedTypeFieldsEquivalent': True,
                          'noDanglingReferences': True, 'removedAnonymousTypeNodes': len(removed - unused), 'removedUnusedTypeNodes': sorted(unused),
                          'addedIndependentRoots': sorted(added)}
(workspace / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report['verification']), flush=True)
