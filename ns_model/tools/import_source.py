#!/usr/bin/env python3
"""Extract the regular NeoSight declarations into a reviewable migration contract.

This is a fail-closed adapter for the recorded declaration format, not a Telora
parser. Runtime model code never imports the old model or reflects its attributes.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

DOMAINS = ['core', 'network', 'pon_fc', 'server', 'storage_cloud', 'storage_ent_kpi', 'storage_ent_res']
ENTITY = re.compile(r'@edsl::entity_id\("(?P<id>[^"\n]+)"\)(?P<header>.*?)\btype (?P<type>\w+) = struct \{(?P<body>.*?)^\};', re.S | re.M)
FIELD = re.compile(r'(?P<attrs>@edsl::column\("(?P<column>[^"]+)"\).*?)^    (?P<name>\w+): (?P<type>\w+(?:\(\w+\))?),', re.S | re.M)


def clean(text):
    return re.sub(r'"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|#[^\n]*', lambda m: '' if m[0].startswith('#') else m[0], text)


def split(text, delimiter=','):
    parts, start, depth, quote, escaped = [], 0, 0, None, False
    for i, char in enumerate(text):
        if quote:
            if escaped: escaped = False
            elif char == '\\': escaped = True
            elif char == quote: quote = None
        elif char in ['"', '`']: quote = char
        elif char in '([{': depth += 1
        elif char in ')]}': depth -= 1
        elif char == delimiter and depth == 0:
            parts.append(text[start:i].strip()); start = i + 1
    if text[start:].strip(): parts.append(text[start:].strip())
    return parts


def calls(text, name):
    result = []
    for match in re.finditer(r'@edsl::'+name+r'\(', clean(text)):
        tail = clean(text)[match.end():]
        depth, quote, escaped = 1, None, False
        for i, c in enumerate(tail):
            if quote:
                if escaped: escaped = False
                elif c == '\\': escaped = True
                elif c == quote: quote = None
            elif c in ['"', '`']: quote = c
            elif c == '(': depth += 1
            elif c == ')':
                depth -= 1
                if depth == 0:
                    result.append(split(tail[:i])); break
        else: raise ValueError('unterminated annotation '+name)
    return result


def expression(text):
    text = clean(text).strip()
    if text.startswith('"'): return json.loads(text)
    if text == 'True': return True
    if text == 'False': return False
    if text.startswith('[') and text.endswith(']'): return [expression(x) for x in split(text[1:-1])]
    if text.startswith('{') and text.endswith('}'):
        return {part.split(':', 1)[0].strip(): expression(part.split(':', 1)[1]) for part in split(text[1:-1])}
    if re.fullmatch(r'-?\d+(?:\.\d+)?', text): return float(text) if '.' in text else int(text)
    match = re.fullmatch(r'([\w:]+)\((.*)\)', text, re.S)
    if match: return {'call': match[1], 'args': [expression(x) for x in split(match[2])]}
    if re.fullmatch(r'[\w:.]+', text): return {'symbol': text}
    raise ValueError('unsupported static source expression: '+text[:100])


def constants(text):
    text = clean(text)
    result = {}
    for match in re.finditer(r'^(?:pub )?def (\w+):[^=\n]+\s*=\s*', text, re.M):
        # Top-level semicolons, never punctuation inside quoted descriptions.
        result[match[1]] = split(text[match.end():], ';')[0]
    return result


def resolve(value, env):
    if isinstance(value, list): return [resolve(x, env) for x in value]
    if isinstance(value, dict):
        if set(value) == {'symbol'} and value['symbol'] in env:
            return resolve(expression(env[value['symbol']]), env)
        return {k: resolve(v, env) for k, v in value.items()}
    return value


def symbol(value):
    assert isinstance(value, dict) and set(value) == {'symbol'}, value
    return value['symbol'].split('::')[-1]


def args(text, name, env):
    return [[resolve(expression(x), env) for x in call] for call in calls(text, name)]


def extract(source):
    root = source/'neosight_model'; catalog = json.loads((root/'data/source_catalog.json').read_text())
    common = constants((root/'src/domains/common.telora').read_text())
    common.update(constants((root/'src/measure_concepts.telora').read_text()))
    model = {'version': 1, 'sourceCommit': __import__('subprocess').check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip(), 'sourceHashes': {}, 'datasets': [], 'relations': [], 'paths': [], 'domains': {}, 'catalog': catalog}
    for relative in ['src/domains/common.telora', 'src/measure_concepts.telora', 'data/source_catalog.json']:
        path = root/relative
        model['sourceHashes'][str(path.relative_to(source))] = hashlib.sha256(path.read_bytes()).hexdigest()
    sources = {d['table']: d for d in catalog['datasets']}
    for domain in DOMAINS:
        path = root/f'src/domains/{domain}.telora'; text = path.read_text(); env = common | constants(text)
        model['sourceHashes'][str(path.relative_to(source))] = hashlib.sha256(path.read_bytes()).hexdigest()
        # Domain value declarations are attached to empty carrier structs.
        for match in re.finditer(r'(?P<header>@edsl::value_type\(.*?)^type (?P<name>\w+) = struct \{\};', text, re.S | re.M):
            value = args(match['header'], 'value_type', env)[0]
            model['domains'][match['name']] = {'name': value[0], 'wire': symbol(value[1]).removesuffix('.type'), 'values': value[2], 'halfOpen': bool(calls(match['header'], 'half_open'))}
        for match in ENTITY.finditer(text):
            header, body = match['header'], match['body']; table = args(header, 'entity_source', env)[0][0]
            spec = args(header, 'dataset', env)[0]
            d = {'id': match['id'], 'type': match['type'], 'module': domain, 'table': table, 'kind': symbol(spec[0]), 'grain': spec[1], 'clock': None if spec[2] == {'symbol':'None'} else spec[2]['args'][0], 'internal': bool(calls(header, 'dataset_internal')), 'fields': []}
            cat_fields = {f['name']: f for f in sources[table]['fields']}
            for field in FIELD.finditer(body):
                a = field['attrs']; f = {'name':field['name'], 'column':field['column'], 'storage':field['type'], 'source':cat_fields[field['column']], 'key': bool(calls(a, 'key'))}
                for name in ['dimension','time_field','utc_bucket_dimension','dimension_type','measure','sample_measure','sample_aggregate','measure_family']:
                    f[name] = args(a,name,env)
                d['fields'].append(f)
            assert len(d['fields']) == len(calls(body, 'column')), d['id']
            model['datasets'].append(d)
            for name in ['named_relation_key','named_guarded_relation_key']:
                for values in args(header,name,env):
                    key=values[3]; r={'id':values[0], 'from':d['id'], 'targetType':symbol(values[1]).removesuffix('.type'),'cardinality':{k:symbol(v) for k,v in values[2].items()},'key':key,'guard':values[4] if name=='named_guarded_relation_key' else None}
                    model['paths' if key['call'].endswith('::Via') else 'relations'].append(r)
    types = {d['type']:d['id'] for d in model['datasets']}
    # Cross-domain imports alias only the source type, never the dataset identity.
    for r in model['relations']+model['paths']:
        name=r.pop('targetType'); name=name.removeprefix('Path'); assert name in types, name
        r['to']=types[name]
    assert len(model['datasets']) == 151
    assert len({d['id'] for d in model['datasets']})==151
    assert len({r['id'] for r in model['relations']+model['paths']}) == len(model['relations'])+len(model['paths'])
    return model


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[3]/'ns-ontology');parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'data/source-model.json');a=parser.parse_args()
    result=extract(a.source);a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n'); print(json.dumps({k:len(result[k]) for k in ['datasets','relations','paths','domains']}))

if __name__=='__main__':main()
