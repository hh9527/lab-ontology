#!/usr/bin/env python3
"""实际执行条件链，验证 SQLite CASE 展开保持三值逻辑与分支优先级。"""
import json
from pathlib import Path
import sqlite3
import subprocess

root = Path(__file__).resolve().parents[1]
result = subprocess.run([
    str(root / "bin/telora"), "-C", str(root / "ontology"), "eval",
    "@test/sqlite_cases:runtime_cases", "--with-memory-limit", "2048",
], capture_output=True, text=True, timeout=120)
assert result.returncode == 0, (result.stdout, result.stderr)
cases = json.loads(result.stdout)
with sqlite3.connect(":memory:") as db:
    for case in cases:
        query = case["query"]
        # 补充投影使未引用编号槽也有名称，可使用 Python 3.14 要求的字典绑定
        handles = ", ".join(f"?{index + 1}" for index in range(len(query["bindings"])))
        actual = db.execute("SELECT " + query["sql"] + ", " + handles, {
            str(index + 1): value for index, value in enumerate(query["bindings"])
        }).fetchone()[0]
        assert actual == case["expected"], (case, actual)
print(f"Passed {len(cases)} SQLite CASE execution checks")
