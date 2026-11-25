# 测评数据

IC 测评数据生成、场景画像、考题和逐题覆盖检查由 [dataseer-ic-exam](https://github.com/hh9527/dataseer-ic-exam) 维护。集成项目将该仓库挂载为 `exam` submodule，固定考题、工具和生成规则的版本。

本仓负责模型与输入契约：

- `icloud_model/data/generation-contract.json`：`icloud-generation-contract/v1` 格式，包含准备模型和源目录 SHA-256
- `icloud_model/data/source_catalog.json`：物理表、字段和来源信息

消费方将同一模型版本的两个 JSON 显式传给生成器；源目录摘要不匹配时拒绝生成。模型源码、契约导出与 SQL 能力验收由本仓维护。

```sh
node "$EXAM_REPO/data/ic/generate.mjs" \
  --contract "$PWD/icloud_model/data/generation-contract.json" \
  --catalog "$PWD/icloud_model/data/source_catalog.json" \
  --output /path/to/output --resources 150 --tenants 30 --days 93 \
  --interval-minutes 60 --exam-profile --anchor-utc 2026-11-25T02:44:00Z
```

`EXAM_REPO` 由调用方指向选定测评仓库版本。生成器只消费 JSON，不读取本仓源码或执行模型；字段、类型、粒度、关系或枚举能力变化时，需同步更新输入契约，并由测评仓库执行数据回归及逐题覆盖检查。固定日期题需使用覆盖题面的生成窗口。

数据库、轨迹、测评记录和临时拆题属于运行产物，不在模型仓库保存。
