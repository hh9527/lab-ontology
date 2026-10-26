#!/usr/bin/env python3
"""复制插件的 jaq 引擎到隔离目录，仅增加纯 sha256，用于保持实验图地址兼容。"""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import json
root=Path(__file__).resolve().parents[3]/'dsh-oks'
# lab-ontology/experiments/knowledge-discovery -> workspace sibling dsh-oks
assert root.is_dir(),root
base=Path(os.environ.get('TMPDIR') or Path.home()/'.cache/tmp');base.mkdir(parents=True,exist_ok=True)
out=Path(tempfile.mkdtemp(prefix='discovery-jq-engine-',dir=base))
for name in ['Cargo.toml','Cargo.lock']:
 shutil.copy2(root/name,out/name)
shutil.copytree(root/'crates',out/'crates')
p=out/'Cargo.toml';p.write_text(p.read_text().replace('[workspace.dependencies]','[workspace.dependencies]\nsha2 = "=0.10.8"'))
p=out/'crates/oks-wti/Cargo.toml';p.write_text(p.read_text()+'\nsha2.workspace = true\n')
p=out/'crates/oks-wti/src/format.rs';s=p.read_text().replace('use base64::','use sha2::{Digest, Sha256};\nuse base64::');s=s.replace('let table: Box<[Filter<RunPtr<D>>]> = Box::new([','''let table: Box<[Filter<RunPtr<D>>]> = Box::new([
        ("sha256", v(0), |cv| {
            bome(map_utf8_str(cv.1, |s| format!("{:x}", Sha256::digest(s))))
        }),''');p.write_text(s)
print(json.dumps({'workspace':str(out)}),flush=True)
subprocess.run(['cargo','build','--release','--offline','-p','oks-wti','--target','wasm32-unknown-unknown'],cwd=out,check=True)
print(json.dumps({'engine':str(out/'target/wasm32-unknown-unknown/release/oks_wti.wasm')}),flush=True)
