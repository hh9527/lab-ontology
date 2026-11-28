#!/usr/bin/env python3
"""Execute generated UQL on the SQLite reference harness.

This is not an OneQuery engine gate. The harness registers reference shims for
every UQL-specific function the renderer emits, binds the positional `?`
placeholders from the occurrence-order array, and applies the two exact syntax
normalizations SQLite needs: UQL `<=>` becomes `IS` and the typed
`TIMESTAMP 'x'` literal becomes `CAST('x' AS TIMESTAMP)`. Assertions run
against the original UQL text in the Telora suite; this script only normalizes
right before submitting to SQLite.
"""
import argparse
from collections import Counter
from datetime import datetime, timedelta
import json
import math
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile


EPOCH = datetime(1970, 1, 1)


def _parse(value):
    if isinstance(value, (int, float)):
        return EPOCH + timedelta(seconds=float(value))
    text = str(value).strip()
    if len(text) <= 10:
        return datetime.strptime(text, '%Y-%m-%d')
    return datetime.strptime(text, '%Y-%m-%d %H:%M:%S')


def _has_time(value):
    return isinstance(value, str) and len(value.strip()) > 10


def shim_mod(a, b):
    # Truncated (fmod) semantics: the double-mod offset is invariant under both
    # truncating and flooring engines.
    if a is None or b is None:
        return None
    return math.fmod(a, b)


def shim_concat(*args):
    # Any NULL argument propagates to NULL; this deliberately overrides
    # SQLite's native concat, which skips NULLs.
    if any(a is None for a in args):
        return None
    return ''.join(str(a) for a in args)


def shim_char_length(value):
    return None if value is None else len(value)


def shim_regexp_count(value, pattern):
    if value is None or pattern is None:
        return None
    return len(re.findall(pattern, value))


def shim_date_trunc(unit, value):
    if value is None or unit is None:
        return None
    moment = _parse(value)
    if unit == 'day':
        moment = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    elif unit == 'month':
        moment = moment.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        raise ValueError(f'unsupported date_trunc unit {unit!r}')
    # Dynamic-typing shaping rule: keep the input's datetime/date form.
    if _has_time(value):
        return moment.strftime('%Y-%m-%d %H:%M:%S')
    return moment.strftime('%Y-%m-%d')


def shim_timestampadd(unit, count, value):
    if unit is None or count is None or value is None:
        return None
    if unit != 'DAY':
        raise ValueError(f'unsupported timestampadd unit {unit!r}')
    return (_parse(value) + timedelta(days=count)).strftime('%Y-%m-%d %H:%M:%S')


def shim_timestampdiff(unit, start, end):
    if unit is None or start is None or end is None:
        return None
    if unit != 'SECOND':
        raise ValueError(f'unsupported timestampdiff unit {unit!r}')
    return int((_parse(end) - _parse(start)).total_seconds())


def shim_timestamp_format(value, fmt):
    if value is None or fmt is None:
        return None
    moment = _parse(value)
    # The engine supports % tokens; T/Z literals never enter the format
    # string, so only the documented date/time tokens are needed.
    for token, part in [('%Y', f'{moment.year:04d}'), ('%m', f'{moment.month:02d}'),
                        ('%d', f'{moment.day:02d}'), ('%H', f'{moment.hour:02d}'),
                        ('%i', f'{moment.minute:02d}'), ('%s', f'{moment.second:02d}')]:
        fmt = fmt.replace(token, part)
    return fmt


def shim_time_floor(value, unit):
    if value is None or unit is None:
        return None
    if unit != 'PT1H':
        raise ValueError(f'unsupported time_floor unit {unit!r}')
    return _parse(value).replace(minute=0, second=0, microsecond=0).strftime('%Y-%m-%d %H:%M:%S')


def _unwrap_timestamp_casts(sql):
    # SQLite resolves the unknown TIMESTAMP type to NUMERIC affinity, which
    # truncates datetime text to its numeric prefix ('2026-03-05...' -> 2026);
    # the reference shims parse the datetime text themselves.
    marker = 'CAST('
    j = sql.find(marker)
    if j < 0:
        return sql
    depth = 0
    k = j + len(marker) - 1
    while k < len(sql):
        if sql[k] == '(':
            depth += 1
        elif sql[k] == ')':
            depth -= 1
            if depth == 0:
                break
        k += 1
    inner = _unwrap_timestamp_casts(sql[j + len(marker):k])
    if inner.endswith(' AS TIMESTAMP'):
        inner = inner[:-len(' AS TIMESTAMP')]
        return sql[:j] + inner.strip() + _unwrap_timestamp_casts(sql[k + 1:])
    return sql[:j] + marker + inner + ')' + _unwrap_timestamp_casts(sql[k + 1:])


def normalize(sql):
    # Exact equivalence rewrites, applied one-for-one to the original text;
    # both spellings are syntax errors on SQLite, so no shim can cover them.
    sql = sql.replace('<=>', ' IS ')
    sql = re.sub(r"TIMESTAMP '([^']*)'", r"CAST('\1' AS TIMESTAMP)", sql)
    return _unwrap_timestamp_casts(sql)


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
    db.create_function('mod', 2, shim_mod)
    db.create_function('concat', -1, shim_concat)
    db.create_function('char_length', 1, shim_char_length)
    db.create_function('regexp_count', 2, shim_regexp_count)
    db.create_function('date_trunc', 2, shim_date_trunc)
    db.create_function('timestampadd', 3, shim_timestampadd)
    db.create_function('timestampdiff', 3, shim_timestampdiff)
    db.create_function('timestamp_format', 2, shim_timestamp_format)
    db.create_function('time_floor', 2, shim_time_floor)
    db.executescript('CREATE TABLE events(id INTEGER, category TEXT, kind TEXT, amount INTEGER, ts INTEGER);')
    db.executemany('INSERT INTO events VALUES (?, ?, ?, ?, ?)', [
        (1, 'A', 'active', 10, 100), (2, 'A', 'active', None, 200),
        (3, 'A', 'idle', 30, 200), (4, 'B', 'active', 20, 100),
        (5, 'B', 'active', 50, 200), (6, 'C', 'ÉACTIVE', 0, None),
        (7, None, 'active', 0, 300),
    ])
    ids = [(n,) for n in range(1, 8)]
    ago = '2026-03-03T07:25:00Z'
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
        'partitioned_hidden_key': [(7,), (3,), (1,), (5,), (4,), (6,)],
        'joined': [(1, 1), (1, 1), (2, 2), (0, 0)], 'joined_count': [(4,)],
        'joined_ratio': [(1, 1, 1.0), (1, 1, 1.0)],
        'capped': [(1,)],
        'lower': [('active',), ('active',), ('idle',), ('active',), ('active',), ('Éactive',), ('active',)],
        'days_ago': [(ago,)] * 7, 'days_ago_null': [(None,)] * 7,
        'bucket_hour': [('2026-03-05 07:00:00',)] * 7,
    }
    unordered = {'grouped', 'distinct', 'union', 'latest', 'joined'}
    assert {case['name'] for case in cases if not case['name'].startswith('epoch_')} == set(expected), 'runtime case/expectation mismatch'
    for case in cases:
        query = case['query']
        # Pure positional `?`: the occurrence-order array binds directly.
        assert query['sql'].count('?') == len(query['bindings']), case['name']
        actual = db.execute(normalize(query['sql']), query['bindings']).fetchall()
        if case['name'].startswith('epoch_'):
            value = query['bindings'][0]
            if case['name'] == 'epoch_hour':
                width = 3600000
                result = value - (value % width) if value is not None and -62135596800000 <= value < 253402300800000 else None
            elif case['name'] == 'epoch_day':
                width = 86400000
                result = value - (value % width) if value is not None and -62135596800000 <= value < 253402300800000 else None
            else:
                if value is None or not -62135596800000 <= value < 253402300800000:
                    result = None
                else:
                    moment = EPOCH + timedelta(milliseconds=value)
                    month_start = moment.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                    result = int((month_start - EPOCH).total_seconds()) * 1000
            wanted = [(result,)]
        else:
            wanted = expected[case['name']]
        if case['name'] in unordered:
            actual, wanted = Counter(actual), Counter(wanted)
        assert actual == wanted, f"{case['name']}: {actual!r} != {wanted!r}\n{query['sql']}"
    print(f"Passed {len(cases)} generated UQL queries on the SQLite reference harness; OneQuery engine semantics remain the Tier2 gate.")


if __name__ == '__main__':
    main()
