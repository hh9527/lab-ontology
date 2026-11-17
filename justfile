# 模型定义与验收。
#
# 编译器不随仓库附带：优先用 TELORA_BIN，其次用 PATH 上的 telora。
# 构建参数取自各领域的构建与验收文档，见 USAGE.md 与 icloud_model/docs/TYPED_MIGRATION.md。

set shell := ["bash", "-euo", "pipefail", "-c"]

telora := env_var_or_default("TELORA_BIN", "telora")

_check_telora:
    #!/usr/bin/env bash
    set -euo pipefail
    command -v "{{telora}}" >/dev/null || { echo "找不到 telora：设置 TELORA_BIN 或把它放进 PATH" >&2; exit 1; }

# 默认制品：IC 领域的统一模型服务，产物为 dist/ic-model.wasm。
build: _check_telora
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p dist
    "{{telora}}" -C icloud_model build @src/lib --staged \
      --initialization-fuel 400000 --request-fuel 100000 --with-memory-limit 2048 \
      -o dist/ic-model.wasm
    ls -l dist/ic-model.wasm

# 清理构建产物。
clean:
    rm -rf dist
