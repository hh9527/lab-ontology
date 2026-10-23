#!/usr/bin/env python3
"""验收同一 Group 在独立查询和 Graph 中的聚合语义。"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TEMP_ROOT = Path(os.environ.get("TMPDIR") or Path.home() / ".cache/tmp")
for name, mode in [("runtime_cases", []), ("graph_runtime_cases", ["--graph"])]:
    result = subprocess.run([
        str(ROOT / "bin/telora"), "-C", str(ROOT / "relation_model"), "eval",
        f"@test/typed_groups:{name}", "--initialization-fuel", "100000",
        "--request-fuel", "100000", "--with-memory-limit", "1024",
    ], capture_output=True, text=True, check=True, timeout=180)
    with tempfile.TemporaryDirectory(prefix="typed-groups-", dir=TEMP_ROOT) as directory:
        queries = Path(directory) / "queries.json"
        queries.write_text(result.stdout)
        subprocess.run(["node", str(ROOT / "relation_model/tests/typed-groups-runtime.mjs"),
                        str(queries), *mode], check=True)
