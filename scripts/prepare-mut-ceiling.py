#!/usr/bin/env python3
"""Prepare isolated handwritten collection-oracle variants (experimental compiler only)."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def balanced_end(s, start):
    pairs = {'(': ')', '[': ']', '{': '}'}
    stack, quote, i = [], None, start
    while i < len(s):
        c = s[i]
        if quote:
            if c == '\\':
                i += 1
            elif c == quote:
                quote = None
        elif c in ['"', '`']:
            quote = c
        elif c in pairs:
            stack.append(pairs[c])
        elif c in pairs.values():
            assert stack.pop() == c
            if not stack:
                return i + 1
        i += 1
    raise AssertionError('unclosed source expression')

def split(s):
    parts, begin, i = [], 0, 0
    while i < len(s):
        if s[i] in '([{':
            i = balanced_end(s, i)
            continue
        if s[i] in ['"', '`']:
            q = s[i]
            i += 1
            while i < len(s):
                if s[i] == '\\':
                    i += 2
                elif s[i] == q:
                    i += 1
                    break
                else:
                    i += 1
            continue
        if s[i] == ',':
            parts.append(s[begin:i].strip())
            begin = i + 1
        i += 1
    parts.append(s[begin:].strip())
    return [p for p in parts if p]

def objects(s, literal=False):
    prefix = 'object(['
    count = 0
    # Replace innermost literals first, retaining evaluation order.
    while prefix in s:
        start = s.rindex(prefix)
        end = balanced_end(s, start + len('object'))
        expression = s[start + len('object('):end - 1].strip()
        assert expression.startswith('[') and expression.endswith(']')
        statements = []
        keys = set()
        for pair in split(expression[1:-1]):
            assert pair.startswith('(') and pair.endswith(')'), pair
            key, value = split(pair[1:-1])
            assert key.startswith('"'), 'only fixed, unique literal object keys are supported'
            assert key not in keys, 'duplicate literal key requires preserving diagnostic behavior'
            keys.add(key)
            statements.append(f'put({key}, {value});')
        statements = [line.replace('put(', 'pipeline::oracle_dict_put(oracle_output, ', 1) for line in statements]
        replacement = ('{ let oracle_output = pipeline::oracle_dict_new(); '
                       + ' '.join(statements)
                       + ' Value::Object(pipeline::oracle_dict_finish(oracle_output)) }')
        if literal:
            fields = []
            for pair in split(expression[1:-1]):
                key, value = split(pair[1:-1])
                name = json.loads(key)
                assert name.isidentifier()
                fields.append(name + ': ' + value)
            replacement = 'Value::Object({' + ', '.join(fields) + '}.ty!(Dict(Value)))'
        s = s[:start] + replacement + s[end:]
        count += 1
    return s, count

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--variant', choices=['baseline', 'array', 'map', 'string', 'object', 'all', 'no-knowledge', 'types-only', 'literal', 'best', 'dense', 'sealed', 'automatic', 'text-writer'], required=True)
    args = p.parse_args()
    out = args.output.resolve()
    assert not out.exists(), 'use a fresh output directory'
    for name in ['ontology', 'icloud_model', 'ns_model', 'relation_model']:
        shutil.copytree(ROOT / name, out / name, ignore=shutil.ignore_patterns('target', '*.wasm'))
    for name in ['telora-config.json', 'telora-lock.json']:
        shutil.copy2(ROOT / name, out / name)
    def original(name):
        return subprocess.check_output(['git', 'show', 'main:ontology/src/' + name], cwd=ROOT, text=True)
    fk = original('field_knowledge.telora')
    k = original('knowledge.telora')
    fti = original('field_type_info.telora')
    if args.variant in ['array', 'all', 'best', 'dense', 'sealed']:
        current = (ROOT / 'benchmarks/collection-mut-ceiling/array-declaration.telora').read_text()
        start = current.index('def each:')
        end = len(current)
        a = fk.index('def declaration_types:')
        b = fk.index('\ndef publication_from:', a)
        fk = fk[:a] + current[start:end] + fk[b:]
    if args.variant in ['map', 'all', 'best', 'dense', 'sealed']:
        a = fk.index('    discover_indexed(referenced_types(seeds), {}.ty!(Dict(Type)))')
        fk = fk[:a] + fk[a:].replace('    discover_indexed(referenced_types(seeds), {}.ty!(Dict(Type)))',
            '    pipeline::oracle_discover(referenced_types(seeds), type_id, fn(ty) { root_info(ty).types })', 1)
    if args.variant in ['object', 'all', 'literal', 'best', 'dense', 'sealed']:
        fk, nf = objects(fk, args.variant in ['literal', 'best', 'dense', 'sealed'])
        # Legacy graph publication is not part of the active build; touch only the raw publication path.
        a = k.index('def raw_capabilities:')
        raw, nk = objects(k[a:], args.variant in ['literal', 'best', 'dense', 'sealed'])
        k = k[:a] + raw
        print('object literals rewritten:', nf, nk)
    if args.variant in ['dense', 'sealed']:
        fk = fk.replace('pipeline::oracle_discover(referenced_types(seeds), type_id, fn(ty) { root_info(ty).types })',
                        'pipeline::oracle_type_discover(referenced_types(seeds), type_id, fn(ty) { root_info(ty).types })')
        fk = fk.replace('pipeline::run(pipeline::from_array(types) |> pipeline::distinct_by(type_id) |> pipeline::collect())',
                        'pipeline::oracle_type_unique(types)')
    if args.variant == 'sealed':
        # Reuse existing fixed-computation memoizers; never substitute a visited flag.
        assert 'memo::computed_with_type(root_infos, ty)' in fk
        assert 'memo::computed_with_type(m, ty)' in fti
        assert 'oracle_type_first' not in fk and 'oracle_type_set' not in fk
    if args.variant in ['string', 'all']:

        # Replace only map+join's intermediate chunk array. Keep cached child projections.
        prefix = 'string::join(array::map('
        while prefix in fti:
            start = fti.index(prefix)
            end = balanced_end(fti, start + len('string::join'))
            exprs = split(fti[start + len('string::join('):end - 1])
            assert len(exprs) == 2
            mapping, separator = exprs
            assert mapping.startswith('array::map(')
            items, mapper = split(mapping[len('array::map('):-1])
            fti = fti[:start] + f'oracle_join({items}, {mapper}, {separator})' + fti[end:]
        fti += '''
use std::pipeline as pipeline;
def oracle_join: for(A) Fn(Array(A), Fn(A) -> String, String) -> String = fn(items, render, separator) {
    let output = pipeline::oracle_string_new();
    array::fold(items, False, fn(started, item) {
        if started { pipeline::oracle_string_push(output, separator) } else { False };
        pipeline::oracle_string_push(output, render(item));
        True
    });
    pipeline::oracle_string_finish(output)
};
'''
    for name, text in [('field_knowledge.telora', fk), ('knowledge.telora', k), ('field_type_info.telora', fti)]:
        (out / 'ontology/src' / name).write_text(text)
    if args.variant in ['no-knowledge', 'types-only']:
        world = 'use std::codec as oracle_codec;\n' + original('world.telora')
        a = world.index('def publication:')
        b = world.index('\ndef stage_prepared:', a)
        if args.variant == 'no-knowledge':
            body = '    Value::None\n};\n'
        else:
            body = world[a:b].split('= fn(world, prepared) {\n', 1)[1]
            body = body[:body.index('    fk::publication_from(')] + '    oracle_codec::encode(array::length(types))\n};\n'
        world = world[:a] + 'def publication: Fn(World, t::Prepared) -> Value = fn(world, prepared) {\n' + body + world[b:]
        (out / 'ontology/src/world.telora').write_text(world)
    print(out)

if __name__ == '__main__':
    main()
