# 时间覆盖决策

本文是面向模型作者的审计材料。运行时知识发布当前模型契约，不要求 Agent 确认建模假设。

## 声明

- 源 datetime KPI 时钟用已确认 UTC 语义的 DateTimeUtc。SQLite 存规范 YYYY-MM-DDTHH:MM:SSZ，PG 用 UTC 输入输出的 timestamptz。按 #44 替代 #41 Utc1 假设；仅逻辑元数据不能证明时区或物理编码。
- 源 dte.time.format.pattern=YYYY-MM-DD 确立 Date，覆盖备用电源、电源制造日期，以及 PON 三个模型角色共享的制造日期。
- 整数时钟采用已有 EpochMillis 约定。无源单位证据的声明都有待确认 TODO，测试守护此要求；称整数为时钟不等于证明单位。
- 时钟声明不增加采样粒度、唯一性、固定采集周期、时区转换、聚合语义或数据库读时钟。
- SSID 采集时钟除 Eq 外现已授权 Ge／Lt，允许窗口。
- 告警接收 ARRIVEUTC 和网元本地发生 OCCURTIME 保留为辅助编码，无授权窗口维度。发布事件窗口用发生 UTC；审计显式标 RoleOnly，不表示这些时间不存在。

## 复现

```sh
bin/telora -C icloud_model eval @src/source_audit:report \
  --initialization-fuel 100000 --request-fuel 100000 --with-memory-limit 1024 \
  > /tmp/icloud-prepared.json
python3 scripts/audit-icloud-time.py /tmp/icloud-prepared.json
node scripts/check-icloud-time.mjs bin/icloud_model.snapshot.wasm
python3 -m unittest discover -s scripts/tests
bin/telora -C icloud_model test time_coverage \
  --initialization-fuel 100000 --request-fuel 100000 --with-memory-limit 2048
```

`data/time_coverage.json` 记录每个可见数据集，包括无时间列的数据集。
每个时钟报告声明角色、发布角色、逻辑输入、授权操作、窗口处理方式及证据／确认状态。
未声明的源时间、未经审查的排除项，以及与 DateTimeUtc／Rfc3339Text 契约不一致的 datetime 时钟都会使审计失败。
比较源目录和编译准备模型，报告不从字段名或物理 SQL 类型推断运行时逻辑类型。

知识遍历路径为字段／维度 → Ty → 操作。
TimeWindow 是所有支持时间类型的共享操作契约；[start,end) 及 null／省略上界不是 half_open 规范值特性。
日／周／月边界在服务外解析，再原样绑定。
