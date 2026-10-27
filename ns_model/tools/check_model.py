#!/usr/bin/env python3
"""Run model self-check without service initialization or knowledge publication."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--telora', default=os.environ.get('TELORA', str(ROOT/'bin/telora')))
a = parser.parse_args()
temp_root = Path(os.environ.get('TMPDIR') or Path.home()/'.cache/tmp')
with tempfile.TemporaryDirectory(prefix='ns-self-check-', dir=temp_root) as directory:
    workspace = Path(directory)
    for name in ['ontology', 'ns_model']:
        shutil.copytree(ROOT/name, workspace/name)
    (workspace/'ns_model/src/lib.telora').write_text('''pub mod model;
pub mod identities;
pub mod groups;
pub mod domains;
pub mod datasets;
pub mod units;
mod profile;
use ontology::experimental::world as w;
use std::codec as codec;
use std::value::{Value};
use ontology::experimental::transform as t;
use ontology::experimental::relations as r;
use std::array as array;
pub def checked: Value = do {
    let world = model::model_world;
    let issues = w::coverage(world);
    if issues != [] { fail!("world coverage failed", issues) } else { () };
    let datasets = array::all(world.datasets, fn(d) {
        t::self_check(world.revision, [d], [], [], [], world.profile)
    });
    let prepared = w::prepare(world);
    let relations = r::checked_lower_all(prepared.payload, world.relations);
    codec::encode(datasets && array::length(relations) == array::length(world.relations))
};
''')
    (workspace/'telora-config.json').write_text(json.dumps({'version':1,'members':['ontology','ns_model']}))
    lock = json.loads((ROOT/'telora-lock.json').read_text())
    lock['packages'] = {k:v for k,v in lock['packages'].items() if k in ['ontology','ns_model']}
    (workspace/'telora-lock.json').write_text(json.dumps(lock))
    result = subprocess.run([a.telora, '-C', str(workspace/'ns_model'), 'eval', '@src/lib:checked',
                    '--initialization-fuel','400000','--with-memory-limit','2048'])
    raise SystemExit(result.returncode)
