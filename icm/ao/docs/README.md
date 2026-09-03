# ao/ 交付物索引

> `ao/` 是对 `icloud/`（UModel 本体 + 查询用例集）的逆向分析交付物，**自包含**：不依赖原始仓库即可使用。
> 原始仓库内容 → ao/ 覆盖对照表见文末。

## 结构

```
ao/
├── schema/schema.sql          # 逆向表结构（45 表：设备/视图/告警/链路/子部件/KPI）
└── docs/
    ├── README.md              # 本文档（索引）
    ├── glossary.md            # 业务词汇表（域/实体/关系/属性/枚举/指标/易错点）
    ├── entity-sets-full.md    # 【权威】27 个 entity_set 全量字段（含全部 value_mapping 原始枚举，无损转存）
    ├── entity-set-links-full.md # 【权威】71 条 entity_set_link 全量（src/dest/类型/字段映射，无损转存）
    ├── event-source-full.md   # 【权威】event_set(1) + entity_source(3) 全量字段（无损转存）
    ├── nl-sql-rules.md        # NL→SQL 翻译规则集（8 条模板→SQL 骨架）
    ├── er-matrix.md           # 实体关系矩阵（关系/基数/关联字段/查询路径）
    ├── sql-idioms.md          # SQL 惯用法与坑清单（43 条）
    ├── vocab-normalization.md # 词汇归一化规则表（中文→字段→物理值）
    ├── query-space-stats.md   # 查询空间统计报告（161 模板分布/覆盖度）
    ├── schema-verification.md # Schema 校验与造数策略
    ├── templates-full.md      # 161 条模板全集（按语义分组，含原始行号）
    ├── ref-cases.md           # 40 条真实参考用例（模板/问题/目标SQL 全量转存）
    ├── query-cases.md         # query-cases.md 全量转存（~200 条填槽用例，9 章）
    ├── metric-sets.md         # 17 个 metric_set 完整定义（labels/指标/聚合/单位）
    └── data-links.md          # 28 条 data_link 明细（src/dest/类型/字段映射）
```

## 使用建议

| 目标 | 看哪个文档 |
|---|---|
| 建库 / 看表结构 | schema/schema.sql |
| 理解业务模型全貌 | glossary.md + er-matrix.md |
| **精确字段/枚举/映射（权威）** | entity-sets-full.md + entity-set-links-full.md + event-source-full.md + metric-sets.md + data-links.md |
| NL→SQL 生成 / 翻译 | nl-sql-rules.md + sql-idioms.md + vocab-normalization.md |
| 造数 / 校验 | schema-verification.md |
| 训练数据 / 用例 | ref-cases.md + query-cases.md + templates-full.md |
| 指标定义 | metric-sets.md |
| 数据血缘 / 关联键 | data-links.md + er-matrix.md |
| 覆盖度评估 | query-space-stats.md |

## 原始仓库 → ao/ 覆盖对照

| 原始内容 | ao/ 覆盖 |
|---|---|
| umodel/entity_set（27） | schema.sql（全部落表）+ entity-sets-full.md（**逐字段无损**）+ glossary.md §2 |
| umodel/entity_set_link（71） | entity-set-links-full.md（**逐条无损**）+ er-matrix.md（归纳） |
| umodel/data_link（28） | data-links.md（逐条无损）+ er-matrix.md |
| umodel/metric_set（17） | metric-sets.md（逐集无损）+ vocab-normalization.md §7 |
| umodel/event_set（1） | event-source-full.md（**逐字段无损**）+ schema.sql T_CURRENT_ALARM |
| umodel/entity_source（3） | event-source-full.md（**逐字段无损**）+ schema.sql X_*_VIEW/X_DEVICE_INDEX |
| queries/tmpl-ref.md（161） | templates-full.md（逐条，分组） |
| queries/query-gen.md | query-space-stats.md（规则与统计） |
| queries/query-cases.md（~200） | query-cases.md（全量转存） |
| queries/user_query_cases_ref（40） | ref-cases.md（全量转存）+ nl-sql-rules.md（翻译规则） |

## 已修正的问题（逆向过程中）

1. **列名**：存储设备型号列以参考 SQL 为准修正为 `productmodel`（全小写）。
2. **主键口径**：终端 `resId`、协作 `sn`、KPI 复合键 `(res_id, ts)`。
3. **挂载键口径**：服务器子部件经 `oriResId`，网络部件经 `refParentNe`/`neResId`，存储经 `parentResId`。
