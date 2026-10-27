"""Compare graph meaning while expanding anonymous type representations inline."""


def normalize_graph(graph):
    by_key = {fact['key']: fact for fact in graph['facts']}
    assert len(by_key) == len(graph['facts'])
    for fact in by_key.values():
        assert set(fact['references']) <= by_key.keys(), fact
    anonymous = {key for key, fact in by_key.items()
                 if key.startswith('types/') and '#' not in key and fact['value'].get('name') is None}

    def text(value):
        if value not in anonymous:
            return value
        info = by_key[value]['value']
        kind = info['kind']
        if kind == 'Struct':
            return '{' + ', '.join(f"{f['name']}: {text(f['type'])}" for f in info['field_types']) + '}'
        if kind == 'Enum':
            return 'Enum{' + ', '.join(v['name'] if v['payload'] is None else
                                      f"{v['name']}({text(v['payload'])})" for v in info['variants']) + '}'
        name = 'Fn' if kind == 'Func' else kind
        arguments = [text(arg) for arg in info['arguments']]
        return name + ('(' + ', '.join(arguments) + ')' if arguments else '')

    def references(key, seen):
        if key not in anonymous:
            return [key]
        if key in seen:
            return []
        return [ref for child in by_key[key]['references'] for ref in references(child, seen | {key})]

    facts = []
    for key, fact in by_key.items():
        if key in anonymous:
            continue
        value = dict(fact['value'])
        if key.startswith('types/') and '#' not in key:
            if value.get('representation') is not None:
                value['representation'] = text(value['representation'])
            value['arguments'] = [text(arg) for arg in value['arguments']]
            value['field_types'] = [{**field, 'type': text(field['type'])} for field in value['field_types']]
            value['variants'] = [{**variant, 'payload': None if variant['payload'] is None else text(variant['payload'])}
                                 for variant in value['variants']]
        refs = sorted({ref for child in fact['references'] for ref in references(child, set())})
        facts.append({**fact, 'value': value, 'references': refs})
    return {**graph, 'facts': sorted(facts, key=lambda fact: fact['key'])}
