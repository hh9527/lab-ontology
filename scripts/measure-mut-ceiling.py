#!/usr/bin/env python3
"""Build isolated hand-written Mut variants; never edits deployed tools/configuration."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BOUNDS = {'no-knowledge', 'types-only'}

def information(path):
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
                return json.loads(data[cursor:end])
        cursor = end
    raise AssertionError('missing build information')

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--telora', type=Path, required=True)
    p.add_argument('--models', nargs='+', default=['icloud_model', 'ns_model'])
    p.add_argument('--variants', nargs='+', default=['baseline', 'literal', 'best', 'no-knowledge', 'types-only'])
    p.add_argument('--repeats', type=int, default=1)
    p.add_argument('--output', type=Path)
    args = p.parse_args()
    assert args.repeats > 0 and args.variants[0] == 'baseline'
    out = args.output or Path(tempfile.mkdtemp(prefix='mut-ceiling-measure-'))
    out.mkdir(parents=True, exist_ok=True)
    compiler = args.telora.resolve()
    report = {'feature': 'experimental-mut-oracle (default disabled)',
              'baselineGitRef': subprocess.check_output(['git', 'rev-parse', 'main'], cwd=ROOT, text=True).strip(),
              'compiler': str(compiler), 'compilerSha256': hashlib.sha256(compiler.read_bytes()).hexdigest(),
              'cases': [], 'note': 'bounds intentionally omit information; single timings are screening observations'}
    print(json.dumps({'output': str(out)}), flush=True)
    for variant in args.variants:
        subprocess.run(['python3', str(ROOT / 'scripts/prepare-mut-ceiling.py'), '--variant', variant,
                        '--output', str(out / ('workspace-' + variant))], check=True, capture_output=True, text=True)
    if 'text-writer' in args.variants:
        base = out / 'workspace-baseline/ontology/src'
        text_writer = out / 'workspace-text-writer/ontology/src'
        assert all(path.read_bytes() == (text_writer / path.relative_to(base)).read_bytes()
                   for path in base.rglob('*.telora'))
        report['textWriterOntologySourcesIdentical'] = True
        report['textWriterCompilerFlags'] = ['TELORA_EXPERIMENTAL_TEXT_WRITER=1']
    if 'automatic' in args.variants:
        base = out / 'workspace-baseline/ontology/src'
        automatic = out / 'workspace-automatic/ontology/src'
        assert all(path.read_bytes() == (automatic / path.relative_to(base)).read_bytes()
                   for path in base.rglob('*.telora')), 'automatic must not rewrite ontology source'
        report['automaticOntologySourcesIdentical'] = True
        report['automaticCompilerFlags'] = ['TELORA_EXPERIMENTAL_LITERAL_PAIRS=1',
            'TELORA_EXPERIMENTAL_PRIVATE_BUILDERS=1', 'TELORA_EXPERIMENTAL_LITERAL_PAIRS_REPORT=1']
    for model in args.models:
        expected = None
        for repeat in range(args.repeats):
            for variant in args.variants:
                artifact = out / f'{model}-{repeat}-{variant}.wasm'
                environment = dict(os.environ)
                for flag in ['TELORA_EXPERIMENTAL_LITERAL_PAIRS', 'TELORA_EXPERIMENTAL_LITERAL_PAIRS_REPORT', 'TELORA_EXPERIMENTAL_PRIVATE_BUILDERS', 'TELORA_EXPERIMENTAL_TEXT_WRITER']:
                    environment.pop(flag, None)
                if variant == 'text-writer':
                    environment['TELORA_EXPERIMENTAL_TEXT_WRITER'] = '1'
                if variant == 'automatic':
                    environment['TELORA_EXPERIMENTAL_LITERAL_PAIRS'] = '1'
                    environment['TELORA_EXPERIMENTAL_LITERAL_PAIRS_REPORT'] = '1'
                    environment['TELORA_EXPERIMENTAL_PRIVATE_BUILDERS'] = '1'
                result = subprocess.run([str(compiler), '-C', str(out / ('workspace-' + variant) / model),
                    'build', model, '--staged', '-o', str(artifact), '--report-usage'],
                    capture_output=True, text=True, timeout=600, env=environment)
                artifact.with_suffix('.log').write_text(result.stderr + result.stdout)
                assert result.returncode == 0, result.stderr
                data = information(artifact)
                if expected is None:
                    expected = data
                if variant not in BOUNDS:
                    assert data == expected, f'full build information differs: {model}/{variant}'
                records = []
                for line in result.stderr.splitlines():
                    try:
                        records.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
                row = {'model': model, 'variant': variant, 'repeat': repeat, 'artifactBytes': artifact.stat().st_size,
                       'diagnosticBound': variant in BOUNDS, 'completeBuildInformationIdentical': variant not in BOUNDS,
                       'phases': {r['phase']: r['elapsed_seconds'] for r in records if r.get('code') == 'build-phase-timing'},
                       'lowerings': [r for r in records if r.get('record') == 'collection-lowering'],
                       'usage': next(r for r in records if r.get('record') == 'buildtime-usage')}
                report['cases'].append(row)
                (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
                print(json.dumps(row), flush=True)

if __name__ == '__main__':
    main()
