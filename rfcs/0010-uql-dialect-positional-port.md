# RFC 0010：UQL 方言位置参数契约移植

- 状态：设计草案
- 范围：ontology/src/uql.telora、ontology/tests/uql.telora、scripts/check-uql.py、ontology/docs/UQL.md 及既有断言适配；不改动 query/intent/sqlite/postgres 模块

## 目的

UQL 方言面向 OneQuery 引擎。方言以纯位置 `?` 占位符加出现顺序 bindings 展开交付查询：每个渲染出的 `?` 追加其句柄值，重复引用重复出现，未渲染的句柄不进入数组。排序、对齐与分页使用引擎原生语法（`ASC NULLS FIRST`、`DESC NULLS LAST`、`<=>`）。语义与 Semora 的 UQL 方言实现（契约 v8.2）保持一致。

## 方言语义

| 能力 | 渲染 |
| --- | --- |
| 占位符 | 纯位置 `?`；bindings 为出现顺序展开 |
| 排序 NULL 语义 | 原生 `ASC NULLS FIRST` / `DESC NULLS LAST` |
| 大小写折叠 | `lower()`（引擎仅折叠 A-Z，与 AST 契约一致） |
| UtcDaysAgo | `concat(timestamp_format(...,'%Y-%m-%d'),'T',timestamp_format(...,'%H:%i:%s'),'Z')`；子表达式按文本顺序重述，每次重述独立渲染 `?` |
| DatetimeUtc 桶 | Hour→`time_floor(CAST(x AS TIMESTAMP),'PT1H')`；Day/Month→`CAST(date_trunc(...) AS TIMESTAMP)` |
| Date 桶 | Day/Month→`date_trunc('day'/'month', ...)`；Hour→拒绝 |
| EpochMillis 桶 | 日历范围守卫 CASE；守卫与偏移算术各自重述；epoch 锚点为类型化字面量 `TIMESTAMP '1970-01-01 00:00:00'`；月桶走 timestampdiff 秒差 |
| 聚合 filter | `count(CASE WHEN pred THEN arg ELSE NULL END)`；谓词先于参数渲染 |
| 未分组 HAVING | 原生渲染 |
| ranked key 比较 | 直接标量子查询 `outer op (SELECT key ... GROUP BY key ORDER BY ... LIMIT 1)` |
| 对齐键 | NULL-safe `<=>` |
| 分区 Top-N | 语义别名 `__q_pk_<i>`、`__q_ok_<j>`、`__q_rn`、`__q_partitioned`；window 与 GROUP BY 重述表达式 |
| 对齐组 | 固定别名 `__q_left`、`__q_right` |
| 计数包装 | `SELECT count(1) FROM (...) AS __q_count` |
| 裸 OFFSET | 无 selection 时拒绝；selection 提供单层 `LIMIT <take 字面量> OFFSET ?` |
| 内部计数别名 | `__q_<n>`（与保留别名集无冲突） |

## 适配边界

本仓库 QueryAst 采用 selection 模型（`ResultSelection{order_by, take: Int}`，上界 1..500），最终形状由方言内部包装：

- `build_query` 在 selection 为 Some 时输出 `SELECT <output_columns|*> FROM (query) AS __q_result ORDER BY <key> <native nulls> ... LIMIT <take 字面量>`；排序键按出现顺序展开
- take 是字面整数（`result_bound` 已在构造侧验证 1..500），不占 `?`

本仓库 qb 词汇表相对 Semora 契约多出的能力，UQL 一律 fail-closed：

| 词汇 | UQL 行为 |
| --- | --- |
| UtcBucketUnit::Year/Quarter/Week | 拒绝（OneQuery 桶矩阵仅 Hour/Day/Month） |
| ZonedTimeBucket | 拒绝（RFC 0008：UQL 明确拒绝地区桶） |
| EpochMillisToUtc | 拒绝（契约未定义） |
| Expr::Parameter | 拒绝（符号参数须先绑定） |
| ComposedTable | 不移植（本仓库 intent 无 GraphTable 构造方） |

UtcBucketEncoding 枚举名沿用本仓库现名 `DateTimeUtc/Date/EpochMillis`，语义对应 Semora 契约的 `DatetimeUtc/DateUtc/EpochMillis`。

## 改动清单

| 文件 | 改动 |
| --- | --- |
| ontology/src/uql.telora | 按本 RFC 语义重写；RenderCtx 增加 occurrences；删除 ascii_lower 替换链、CASE-null 双列、`$n` 占位符 |
| ontology/tests/uql.telora | 以 Semora 用例集为骨架：全 plan 形状 occurrence 展开、placeholder 计数、文本顺序绑定、直接标量子查询、结构语义别名、epoch 边界 24 例、selection 包装；删除 ComposedTable/cap 用例 |
| scripts/check-uql.py | 位置绑定执行：9 个引用 shim（mod/concat/char_length/regexp_count/date_trunc/timestampadd/timestampdiff/timestamp_format/time_floor）；`<=>`→` IS `、`TIMESTAMP 'x'`→CAST、CAST AS TIMESTAMP 解包归一化 |
| ontology/docs/UQL.md | 重写为位置契约与验证命令 |
| ontology/docs/DIALECT-CONTRACT.md、ontology/docs/QUERY.md | 绑定契约陈述更新：UQL 为纯位置 `?` 加出现序展开，bindings 不再按句柄索引寻址 |
| tests/result_bound.telora | 三方言 bindings 一致断言改为 sqlite==postgres 保留，UQL 单独断言 `?` 计数等于 bindings 长度 |
| tests/uql_intent.telora | 断言字符串更新为 `?` 形态（该文件因 edsl 装饰器迁移已编译失败，修复不在本 RFC 范围） |

## 验收

- `telora -C ontology check --lib` 通过
- `telora -C ontology test uql` 通过
- `python3 scripts/check-uql.py` 全部用例通过
- sqlite/postgres/intent 相关测试不回归（result_bound 等）
