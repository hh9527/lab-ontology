#!/usr/bin/env python3
"""Execute the portable subset of generated UQL on SQLite (not a UQL engine gate)."""
import argparse
from collections import Counter
import json
import math
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--telora', type=Path, default=root / 'bin/telora')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='ontology-uql-') as directory:
        workspace = Path(directory)
        shutil.copytree(root / 'ontology', workspace / 'ontology')
        (workspace / 'telora-lock.json').write_text(json.dumps({'version': 1, 'packages': {
            'ontology': {'source': {'workspace': 'ontology'}, 'dependencies': []},
        }}))
        (workspace / 'telora-config.json').write_text(json.dumps({'version': 1, 'members': ['ontology']}))
        shutil.copyfile(root / 'ontology/tests/uql.telora', workspace / 'ontology/src/uql_cases.telora')
        cases = json.loads(subprocess.check_output([
            str(args.telora.resolve()), '-C', str(workspace / 'ontology'), 'eval',
            '@src/uql_cases:execution_queries',
        ], text=True))
    db = sqlite3.connect(':memory:')
    db.create_function('mod', 2, lambda a, b: None if a is None or b is None else math.fmod(a, b))
    db.create_function('char_length', 1, lambda value: None if value is None else len(value))
    db.create_function('regexp_count', 2, lambda value, pattern:
                       None if value is None or pattern is None else len(re.findall(pattern, value)))
    db.executescript('CREATE TABLE events(id INTEGER, category TEXT, kind TEXT, amount INTEGER, ts INTEGER);')
    db.executemany('INSERT INTO events VALUES (?, ?, ?, ?, ?)', [
        (1, 'A', 'active', 10, 100), (2, 'A', 'active', None, 200),
        (3, 'A', 'idle', 30, 200), (4, 'B', 'active', 20, 100),
        (5, 'B', 'active', 50, 200), (6, 'C', 'ÉACTIVE', 0, None),
        (7, None, 'active', 0, 300),
    ])
    ids = [(n,) for n in range(1, 8)]
    expected = {
        'rows': ids, 'desc': [(5,), (3,), (4,), (1,), (6,), (7,), (2,)],
        'scoped': [(1,), (2,), (4,), (5,), (7,)],
        'grouped': [('B', 2, 4), (None, 1, 2), ('A', 1, 2), ('C', 0, 0)],
        'distinct': [(None,), ('A',), ('B',), ('C',)],
        'group_count': [(4,)], 'union': ids, 'set_count': [(7,)],
        'exists': [(1,), (2,), (3,), (4,), (5,)], 'not_exists': [(6,), (7,)],
        'scalar': [(3,), (4,), (5,)], 'ranked': [(4,), (5,)],
        'latest': [(None, 0), ('A', None), ('B', 50), ('C', None)],
        'partitioned': [(None, 7), ('A', 3), ('A', 1), ('B', 5), ('B', 4), ('C', 6)],
        'joined': [(1, 1), (1, 1), (2, 2), (0, 0)], 'joined_count': [(4,)],
        'joined_ratio': [(1, 1, 1.0), (1, 1, 1.0)],
        'capped': [(1,)],
        'lower': [('active',), ('active',), ('idle',), ('active',), ('active',), ('Éactive',), ('active',)],
    }
    unordered = {'grouped', 'distinct', 'union', 'latest', 'joined'}
    assert {case['name'] for case in cases if not case['name'].startswith('epoch_')} == set(expected), 'runtime case/expectation mismatch'
    for case in cases:
        query = case['query']
        # SQLite understands named $n parameters; a mapping also handles unused
        # context bindings without altering the generated SQL or binding handles.
        bindings = {str(n): value for n, value in enumerate(query['bindings'], 1)}
        actual = db.execute(query['sql'], bindings).fetchall()
        if case['name'].startswith('epoch_'):
            value = query['bindings'][0]
            width = 3600000 if case['name'] == 'epoch_hour' else 86400000
            result = value - value % width if value is not None and -62135596800000 <= value < 253402300800000 else None
            wanted = [(result,)]
        else:
            wanted = expected[case['name']]
        if case['name'] in unordered:
            actual, wanted = Counter(actual), Counter(wanted)
        assert actual == wanted, f"{case['name']}: {actual!r} != {wanted!r}\n{query['sql']}"
    print(f"Passed {len(cases)} generated UQL queries on SQLite; UQL-specific time/regex functions require an engine integration gate.")


if __name__ == '__main__':
    main()
