#!/usr/bin/env python3
"""验证知识导出内联内置类型，保留具名类型及容器内的模型引用。"""
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
args = parser.parse_args()
workspace = Path(tempfile.mkdtemp(prefix='inline-type-knowledge-', dir=os.environ.get('TMPDIR') or Path.home() / '.cache/tmp'))
packages = ['ontology', 'relation_model']
for package in packages:
    shutil.copytree(ROOT / package, workspace / package, ignore=shutil.ignore_patterns('target', '__pycache__', '*.wasm'))
(workspace / 'telora-config.json').write_text(json.dumps({'version': 1, 'members': packages}))
lock = json.loads((ROOT / 'telora-lock.json').read_text())
lock['packages'] = {name: lock['packages'][name] for name in packages}
(workspace / 'telora-lock.json').write_text(json.dumps(lock))
# 只求值知识夹具，不执行真实 Service 的 build::stage。
(workspace / 'relation_model/src/lib.telora').write_text('pub mod typed_relations;\n')
result = subprocess.run([str(args.telora.resolve()), '-C', str(workspace / 'relation_model'), 'eval', '@test/inline_type_knowledge:publication', '--initialization-fuel', '400000'], capture_output=True, text=True, timeout=120)
assert result.returncode == 0, result.stderr
publication = json.loads(result.stdout)
# 同一夹具通过正式插件采集，验证容器与具名类型在新路径保持语义。
result = subprocess.run([str(args.telora.resolve()), '-C', str(workspace / 'relation_model'), 'eval', '@test/inline_type_knowledge:javascript_publication', '--initialization-fuel', '400000'], capture_output=True, text=True, timeout=120)
assert result.returncode == 0, result.stderr
compact = workspace / 'compact.json'; compact.write_text(result.stdout)
plugin = ROOT.parent / 'dsh-oks'
collected = workspace / 'collected.json'
result = subprocess.run(['node', '--import', str(plugin / 'packages/dsh-oks/scripts/markdown-loader.mjs'), str(plugin / 'scripts/collect-model-knowledge.mjs'), str(compact), str(collected)], capture_output=True, text=True, timeout=120)
assert result.returncode == 0, result.stderr
actual = json.loads(collected.read_text())['graph']
def canonical(graph):
    return {**graph, 'facts': sorted([{**fact, 'references': sorted(set(fact['references']))} for fact in graph['facts']], key=lambda fact: fact['key'])}
assert canonical(actual) == canonical(publication), 'programmed inline type graph differs'
facts = {fact['key']: fact for fact in publication['facts']}
for fact in facts.values():
    assert all(reference in facts for reference in fact['references']), fact
    if fact['key'].startswith('types/'):
        assert fact['value'].get('kind') not in ['Int', 'Float', 'String', 'Array', 'Dict'], fact
        assert not (fact['value'].get('name') is None and [v['name'] for v in fact['value'].get('variants', [])] in [['False', 'True'], ['None', 'Some']]), fact

def named(suffix):
    matches = [fact for fact in facts.values() if str(fact['value'].get('name', '')).endswith('::' + suffix)]
    assert len(matches) == 1, (suffix, matches)
    return matches[0]

metadata = named('Metadata')
business = named('Business')
fields = {field['name']: field['type'] for field in metadata['value']['field_types']}
assert {name: fields[name] for name in ['integer', 'decimal', 'flag', 'text', 'optional', 'array', 'dictionary']} == {
    'integer': 'Int', 'decimal': 'Float', 'flag': 'Bool', 'text': 'String', 'optional': 'Option(Int)', 'array': 'Array(Float)', 'dictionary': 'Dict(Bool)',
}, fields
assert fields['nested'] == f"Array(Option(Dict({business['key']})))", fields
assert business['key'] in metadata['references']
assert fields['business'] == business['key']
assert named('NamedArray')['key'] == fields['named_array']
assert any('NamedOption' in str(f['value'].get('name')) and f['key'] == fields['named_option'] for f in facts.values())
assert all(fact['key'] not in ['types/Int', 'types/Float', 'types/Bool', 'types/String'] for fact in facts.values())
(workspace / 'publication.json').write_text(json.dumps(publication, ensure_ascii=False))
print(json.dumps({'workspace': str(workspace), 'facts': len(facts), 'inlineTypes': {name: fields[name] for name in ['optional', 'array', 'dictionary', 'nested']}, 'namedTypeReferencesPreserved': True}))
