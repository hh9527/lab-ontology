# UQL 方言位置参数移植实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Semora UQL 方言（契约 v8.2）的位置参数语义移植到本仓库的 ontology/src/uql.telora 及其测试、执行校验与文档

**Architecture:** 方言层移植——重写 uql.telora 为纯位置 `?` 占位符加出现顺序 bindings 展开，适配本仓库 qb 词汇表（selection 模型、DateTimeUtc/Date/EpochMillis 编码名、fail-closed 多出词汇）；测试与 SQLite 参考执行以 Semora 用例集为骨架。不改动 query/intent/sqlite/postgres 模块，不移植 ComposedTable

**Tech Stack:** Telora（语义查询方言）、Python 3 + sqlite3（参考执行 harness）、Semora 参照源 `/Users/Admin/Desktop/gitcode/semora/ontology/src/uql.telora`（HEAD bf30a9b，下称"参照源"）

**Spec:** `rfcs/0010-uql-dialect-positional-port.md`

## Global Constraints

- 不改动 ontology/src/query.telora、intent.telora、sqlite.telora、postgres.telora
- 不移植 ComposedTable（本仓库无构造方）
- UtcBucketEncoding 沿用本仓库枚举名 `DateTimeUtc/Date/EpochMillis`
- fail-closed 词汇：UtcBucketUnit::Year/Quarter/Week、ZonedTimeBucket、EpochMillisToUtc、Expr::Parameter
- telora 二进制取 `/Users/Admin/Desktop/gitcode/semora/bin/telora`（本仓库无 bin；首次执行前告知用户此环境依赖）
- 验证命令统一：`TELORA=/Users/Admin/Desktop/gitcode/semora/bin/telora`，`"$TELORA" --with-memory-limit 1024 -C ontology test uql`（workdir 为仓库根）；库检查 `"$TELORA" --with-memory-limit 1024 -C ontology check --lib`
- 工作分支 `impl/uql-positional-port`；提交语言中文、conventional 前缀；每任务一条提交，执行前按交付规则与用户确认提交档位
- commit message 与文档遵守 chizi-zhixin：只写本次事实，不写过程

## Review Focus

- 同一句柄跨子表达式重述（ranked key 在 SELECT 与 GROUP BY 各渲染一次）→ 每 `?` 独立计数：Task 4 测试 `ranked_bind_key_expands_per_restatement`
- epoch 边界（-1/-3600001/-86400001、范围两端 ±1、NULL × Hour/Day/Month）→ 守卫 CASE 返回 NULL 或桶起点：Task 2 `epoch_cases` 24 例
- 绑定句柄越界（index > builder_bindings 长度）→ fail "binding handle is not registered"：Task 1 `unregistered_binding_is_rejected`
- 非法标识符（含反引号/注释片段）→ fail "invalid UQL identifier"：Task 1 `invalid_identifier_is_rejected`
- selection order_by 键为绑定表达式 → `?` 计入总 bindings 且计数相等：Task 4 selection 包装测试断言 `placeholder_count == bindings 长度`

---

### Task 1: 占位符与 occurrence 模型

**Files:**
- Modify: `ontology/src/uql.telora`
- Modify: `ontology/tests/uql.telora`

**Interfaces:**
- Produces: `RenderCtx = {builder_bindings, occurrences, reserved_aliases, next_alias}`；`emit_expr: Fn(qb::Expr, RenderCtx) -> Emitted`（AllocatedBind 分支输出 `?` 并 push occurrences）；`render_selection: Fn(Emitted, qb::QueryAst) -> Emitted`（selection 包装，续用主查询 ctx）；`build_query`/`render_expr_with_context` 返回 bindings = occurrences。后续任务在此 ctx 透传模型上叠加语义

- [ ] **Step 1: 更新测试断言（tests/uql.telora）**

  - `identifiers_aliases_and_binding_handles`：`$` 断言全部改 `?`（`` `select`.`kind` = ? ``、`LIMIT ? OFFSET ?`）；bindings 期望改 occurrence 展开 `[Val::String("active"), Val::Int(2), Val::Int(0)]`
  - `repeated_binding_remains_one_handle` 改名 `repeated_binding_expands_per_occurrence`：期望 `? = ?` 且 bindings `[Val::String("active"), Val::String("active")]`
  - 新增 `selection_wrap_orders_and_limits_literal`：构造 selection Some（order_by 键为 needle.1 绑定、take 2）的 ast，断言 SQL 含 `FROM (`、`AS __q_result`、`ORDER BY ?`（本任务 ordered_sql 仍是 CASE-null 双列，断言只查 `LIMIT 2` 字面量与 `__q_result` 包装）、bindings 含该键的 occurrence、`placeholder_count(sql) == length(bindings)`
  - `unregistered_binding_is_rejected`、`invalid_identifier_is_rejected` 保持不动（fail 消息不变）

- [ ] **Step 2: 跑测试确认失败**

  Run: `"$TELORA" --with-memory-limit 1024 -C ontology test uql`
  Expected: FAIL——旧实现渲染 `$1`/`$2`，占位符断言不匹配

- [ ] **Step 3: 改 src/uql.telora**

  - `RenderCtx` 增加 `occurrences: Array(qb::Val)`；`context` 初始化 `occurrences: []`（参照源 16-27 行）
  - `emit_expr` AllocatedBind 分支：`{sql: "?", ctx: {...ctx, occurrences: array::push(ctx.occurrences, ctx.builder_bindings[binding.index - 1])}}`（参照源 173-176 行）
  - `render_expr_with_context` 返回 `{sql: emitted.sql, bindings: emitted.ctx.occurrences}`
  - 新增 `render_selection: Fn(Emitted, qb::QueryAst) -> Emitted`：selection 为 Some 时输出 `SELECT <output_columns|*> FROM (<query.sql>) AS __q_result ORDER BY <每个 order_by 键经 emit_expr 续 ctx 渲染 + ordered_sql(key.sql, direction)> ... LIMIT <take 字面量>`；take 为 Int 字面量不渲染 `?`；selection None 直通
  - `build_query` 末段替换 `qb::select_result(...)` 调用：`let wrapped = render_selection({sql: rendered.sql, ctx: rendered.ctx}, ast); {sql: wrapped.sql, bindings: wrapped.ctx.occurrences}`

- [ ] **Step 4: 跑测试确认通过**

  Run: `"$TELORA" --with-memory-limit 1024 -C ontology test uql`
  Expected: PASS（全部现有测试 + 新断言）

- [ ] **Step 5: Commit**

  ```bash
  git add ontology/src/uql.telora ontology/tests/uql.telora
  git commit -m "feat(uql): 渲染为纯位置占位符并按出现顺序展开绑定"
  ```

### Task 2: 时间函数 occurrence-aware 渲染

**Files:**
- Modify: `ontology/src/uql.telora`
- Modify: `ontology/tests/uql.telora`

**Interfaces:**
- Consumes: Task 1 的 Emitted ctx 透传模型
- Produces: `utc_days_ago_sql: Fn(Array(qb::Expr), RenderCtx) -> Emitted`；`utc_bucket_sql: Fn(qb::UtcBucketSpec, qb::Expr, RenderCtx) -> Emitted`；`emit_expr` Scalar 分支对 UtcDaysAgo/UtcTimeBucket 的分发（参照源 177-184 行）；scalar_sql 对 UtcDaysAgo/UtcTimeBucket/EpochMillisToUtc/ZonedTimeBucket fail

- [ ] **Step 1: 更新测试断言**

  - `utc_buckets_use_documented_functions` 按 semora 版重写（semora tests/uql.telora 127-156 行），枚举名换本仓库 `DateTimeUtc/Date`：
    - DatetimeUtc Hour 期望 `time_floor(CAST(`select`.`id` AS TIMESTAMP), 'PT1H')`
    - Date Month 期望 `date_trunc('month', CAST(`select`.`id` AS TIMESTAMP))`
    - EpochMillis Month 含 `timestampdiff('SECOND'`、`mod(mod(`select`.`id`, 86400000) + 86400000, 86400000)`、`TIMESTAMP '1970-01-01 00:00:00'`、`ELSE NULL END`
    - days_ago 期望 `concat(timestamp_format(timestampadd('DAY', (0 - CAST(? AS INTEGER)), CAST(? AS TIMESTAMP)), '%Y-%m-%d'), 'T', timestamp_format(timestampadd('DAY', (0 - CAST(? AS INTEGER)), CAST(? AS TIMESTAMP)), '%H:%i:%s'), 'Z')`，bindings `[Int(2), String("2026-03-05 07:25:00"), Int(2), String("2026-03-05 07:25:00")]`
  - 新增 fail-closed 测试 `unsupported_bucket_vocabulary_is_rejected`：UtcTimeBucket({Year|Quarter|Week, …})、ZonedTimeBucket(_)、EpochMillisToUtc、`Expr::Parameter` 各 `should_fail_with`（消息自拟，含"UQL"）
  - 新增 `epoch_boundaries_expand_per_occurrence`：semora epoch_cases 逻辑（425-439 行）——8 个边界值 × 3 单位，render_expr_with_context 断言 bindings == `[value, value, value, value]`
  - 旧测试中 Year/Quarter/Week bucket 的用例（大写 'YEAR' 等）删除

- [ ] **Step 2: 跑测试确认失败**

  Run: `"$TELORA" --with-memory-limit 1024 -C ontology test uql`
  Expected: FAIL——旧 utc_bucket_sql 无重述、无 time_floor

- [ ] **Step 3: 改 src/uql.telora**

  - `utc_bucket_sql` 重写为 `Fn(qb::UtcBucketSpec, qb::Expr, RenderCtx) -> Emitted`（参照源 52-96 行；编码分支用本仓库 `DateTimeUtc/Date/EpochMillis`；unit 分支只留 Hour/Day/Month，其余 `_ => fail!`；Date+Hour fail）
  - 新增 `utc_days_ago_sql`（参照源 104-113 行）
  - `emit_expr` Scalar 分支加 UtcDaysAgo/UtcTimeBucket 分发；其余走 render_args+scalar_sql
  - `scalar_sql`：UtcDaysAgo/UtcTimeBucket 分支改 `fail!("requires occurrence-order rendering")`；Lower 暂保持 ascii_lower（Task 3 处理）
  - 删除现版 `utc_bucket_sql` 与 `EpochMillisToUtc` 实现，ScalarFunction match 补 ZonedTimeBucket/EpochMillisToUtc 的 fail 分支

- [ ] **Step 4: 跑测试确认通过**

  Run: `"$TELORA" --with-memory-limit 1024 -C ontology test uql`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add ontology/src/uql.telora ontology/tests/uql.telora
  git commit -m "feat(uql): 时间函数按出现顺序重述子表达式"
  ```

### Task 3: 排序、对齐与结构语义

**Files:**
- Modify: `ontology/src/uql.telora`
- Modify: `ontology/tests/uql.telora`

**Interfaces:**
- Consumes: 前两个任务的 ctx 模型与时间函数
- Produces: `ordered_sql` 原生 NULLS 拼写；`scalar_sql` Lower 直渲；`aggregate` filter 文本顺序；ungrouped HAVING 直渲；`render_ranked_comparison` 直接标量子查询；`emit_joined_groups` 固定别名 + `<=>`；`count_over`（`SELECT count(1) FROM (...) AS __q_count`）

- [ ] **Step 1: 更新测试断言**

  - `documented_string_functions_and_ascii_case_folding` 改名 `documented_string_functions_and_direct_lower`：lower 期望 `lower(?)`（semora 100-113 行，instr/substr/length/regex 断言照搬）
  - `explicit_null_order_is_portable` 改名 `explicit_null_order_is_native`：期望 `ORDER BY `select`.`id` ASC NULLS FIRST` / `DESC NULLS LAST`
  - 新增 `filtered_distinct_aggregate_preserves_local_scope`（semora 82-99 行断言照搬）
  - 新增 `ungrouped_having_renders_natively`：grouping [] 时 `HAVING count(DISTINCT CASE` 存在
  - 新增 `filtered_aggregate_binds_in_text_order`：arg 先绑定、filter 后绑定时 SQL `count(CASE WHEN `select`.`kind` = ? THEN ? ELSE NULL END)` 且 bindings `[String("active"), Int(1)]`（semora 312-332 行）
  - 新增 `ranked_keys_use_direct_scalar_subquery`：含 `` `select`.`category` = (SELECT `select_2`.`category` FROM ``、`GROUP BY ... ORDER BY sum(...) DESC NULLS LAST LIMIT 1)`、不含 `EXISTS (SELECT 1 FROM (SELECT`
  - 新增 `joined_groups_align_null_safe`：`__q_left`/`__q_right`、`` `__q_left`.`category` <=> `__q_right`.`category` ``
  - `group_count` 相关 runtime 期望若含 `AS count` 改 `AS __q_count` 包装（无 `AS count` 列别名）
  - 删除旧 CASE-null 双列、ascii REPLACE 链相关断言

- [ ] **Step 2: 跑测试确认失败**

  Run: `"$TELORA" --with-memory-limit 1024 -C ontology test uql`
  Expected: FAIL——ordered_sql 仍是 CASE-null

- [ ] **Step 3: 改 src/uql.telora**

  - `ordered_sql` 改原生 `ASC NULLS FIRST`/`DESC NULLS LAST`（参照源 117-122 行）
  - 删 `ascii_lower`；`scalar_sql` Lower 分支改 `lower(parts[0])`
  - `aggregate`：filter 分支谓词先渲染（`value = emit_expr(expr, ctx)`、`arg = emit_expr(call.arg, value.ctx)`，参照源 301-309 行）
  - 删 emit_rows_from/render_exists 中 `UQL HAVING requires GROUP BY` 检查（plan.having 与 ex.grouping 两处）
  - `render_ranked_comparison` 改直接标量子查询，grouped 重述渲染（参照源 528-550 行）
  - `emit_joined_groups` 重写：固定 `__q_left`/`__q_right`、`<=>` 键、rank 用 `ordered_sql(`` `comparison_value` ``, direction)`、`LIMIT take.sql`（参照源 859-900 行）
  - build_query 的 GroupCount/SetCount 分支改 `count_over(emit_rows(...))`（`SELECT count(1) FROM (...) AS __q_count`）
  - `internal_alias` 保留（`__q_<n>`），后续 join/派生表场景仍用

- [ ] **Step 4: 跑测试确认通过**

  Run: `"$TELORA" --with-memory-limit 1024 -C ontology test uql`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add ontology/src/uql.telora ontology/tests/uql.telora
  git commit -m "feat(uql): 采用引擎原生排序、对齐与子查询语法"
  ```

### Task 4: 分区 Top-N 语义别名与 OFFSET 规则

**Files:**
- Modify: `ontology/src/uql.telora`
- Modify: `ontology/tests/uql.telora`

**Interfaces:**
- Consumes: Task 3 的 ordered_sql 原生 NULLS
- Produces: partitioned Top-N 固定别名 `__q_pk_<i>`/`__q_ok_<j>`/`__q_rn`/`__q_partitioned`；window PARTITION BY/ORDER BY 与 GROUP BY 重述表达式；`emit_rows_from` 裸 OFFSET 无 selection fail；selection Some 的裸 OFFSET 升级单层 `LIMIT <take 字面量> OFFSET ?`；`execution_queries` 导出值含全量 cases + epoch_cases（Task 5 消费）

- [ ] **Step 1: 更新测试断言**

  - `structural_names_use_the_shared_vocabulary`：覆盖 latest（`AS __latest_stage`、`` `__latest_row` = 1 ``、`DESC NULLS LAST`）、joined（`<=>`）、group_count（`AS __q_count`）、partitioned（`AS __q_partitioned`、`` `__q_rn` <= ? ``、`AS __q_ok_0`）、partitioned_hidden_key（`AS __q_pk_0`）（semora 365-424 行，去掉 composed/capped 项与长度==7 改为长度==5）
  - 新增 `offset_without_limit_is_rejected`：selection None 且 offset Some → fail "UQL OFFSET requires a LIMIT or a final output cap"
  - 新增 `offset_with_selection_uses_single_layer`：selection Some（take 2）且 offset Some → SQL 末尾 `LIMIT 2 OFFSET ?` 且无 `__q_result` 之上的二次包装，placeholder 计数 == bindings 长度
  - `all_plan_shapes_expand_occurrence_bindings`：cases 表对齐 semora 218-305 行（rows/desc/scoped/grouped/distinct/group_count/union/set_count/exists/not_exists/scalar/ranked/latest/partitioned/partitioned_hidden_key/joined/joined_count/joined_ratio/lower/days_ago/days_ago_null/bucket_hour + 本仓库新增 selection case），expectations 按 semora 247-281 行（composed/capped 删除，grouped/joined 展开数组照搬）
  - `execution_queries` 导出 `array::concat([cases, epoch_cases])`

- [ ] **Step 2: 跑测试确认失败**

  Run: `"$TELORA" --with-memory-limit 1024 -C ontology test uql`
  Expected: FAIL——partitioned 仍是 `__q_<n>` 计数别名

- [ ] **Step 3: 改 src/uql.telora**

  - `emit_partitioned` 重写（参照源 685-742 行）：`ExprBinding` 去掉 sql 字段；`partition_key`/`partition_order_key` 带 Int index 参数，未投影键物化 `__q_pk_<index>`/`__q_ok_<index>`；window_partition/window_order/grouping 全部 `render_exprs` 重述；外层 `__q_partitioned`、`__q_rn <= take.sql`
  - `render_ranked_comparison` 若 Task 3 已含 bind-key 重述测试则此处仅核对（`ranked_bind_key_expands_per_restatement`，semora 334-352 行，含 `= (SELECT ? FROM`、`GROUP BY ? ORDER BY ... LIMIT 1)`、bindings `[active, active]`）
  - `emit_rows_from`（无 cap 参数）：match (limit, offset)——(None, Some) 时查 ast 的 selection：None → fail "UQL OFFSET requires a LIMIT or a final output cap"；Some → 单层 `LIMIT <take 字面量> OFFSET ?`（emit_rows_from 需接 selection 信息：把 selection take 作为参数传入或在 build_query 层预写 plan.limit——选择前者，签名加 `Option(Int)`）
  - `render_selection`（Task 1 版）与 OFFSET 单层规则协调：offset 分支已产 LIMIT/OFFSET 时 selection 包装仅去 ORDER BY 键与 take 已就位，避免双重 LIMIT——以 `LIMIT 2 OFFSET ?` 末态为准
  - `build_query` 各分支维持（无 cap/apply_output_limit——本仓库 selection 承担最终限幅）

- [ ] **Step 4: 跑测试确认通过**

  Run: `"$TELORA" --with-memory-limit 1024 -C ontology test uql`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add ontology/src/uql.telora ontology/tests/uql.telora
  git commit -m "feat(uql): 分区 Top-N 语义别名与 selection 分页"
  ```

### Task 5: check-uql.py 位置绑定执行

**Files:**
- Modify: `scripts/check-uql.py`
- Modify: `ontology/tests/uql.telora`（仅 execution_queries 集成核对）

**Interfaces:**
- Consumes: Task 4 的 `execution_queries`（`eval '@src/uql_cases:execution_queries'` 输出 `{name, query:{sql, bindings}}` 列表）

- [ ] **Step 1: 重写 scripts/check-uql.py**

  以 semora scripts/check-uql.py（1-240 行）为基：
  - 9 个 shim：`mod`（math.fmod 截断语义）、`concat`（NULL 传播）、`char_length`、`regexp_count`、`date_trunc`、`timestampadd`、`timestampdiff`、`timestamp_format`（%Y/%m/%d/%H/%i/%s）、`time_floor`
  - `normalize`：`<=>`→` IS `、`TIMESTAMP 'x'`→`CAST('x' AS TIMESTAMP)`、递归解包 `CAST(... AS TIMESTAMP)`
  - 位置绑定：`query['sql'].count('?') == len(query['bindings'])` 断言后直接作参数
  - 期望表：semora 189-207 行去掉 `composed`/`capped`（本仓库无 ComposedTable/result_limit）；`capped` 场景由 selection case 顶替（期望与 `rows` LIMIT 行为等价：`[(1,)]`）
  - epoch_* 分支照搬（215-230 行）
  - 表结构与数据照搬（events 7 行含 'ÉACTIVE' 大小写与 NULL category）

- [ ] **Step 2: 跑脚本确认失败或通过**

  Run: `python3 scripts/check-uql.py --telora "$TELORA"`
  Expected: 首轮可能因 cases/期望错位 FAIL（case/expectation mismatch），按缺集调整

- [ ] **Step 3: 迭代至通过**

  Run: `python3 scripts/check-uql.py --telora "$TELORA"`
  Expected: `Passed N generated UQL queries on the SQLite reference harness; OneQuery engine semantics remain the Tier2 gate.`

- [ ] **Step 4: Commit**

  ```bash
  git add scripts/check-uql.py ontology/tests/uql.telora
  git commit -m "test(uql): SQLite 参考执行位置绑定查询"
  ```

### Task 6: 文档同步

**Files:**
- Modify: `ontology/docs/UQL.md`
- Modify: `ontology/docs/DIALECT-CONTRACT.md`
- Modify: `ontology/docs/QUERY.md`

**Interfaces:**
- Consumes: Task 1-5 的最终方言行为

- [ ] **Step 1: 重写 UQL.md**

  内容：UQL 面向 OneQuery；纯位置 `?` + occurrence 展开（重复引用重复值、未渲染句柄不进数组）；方言语义表（照 RFC 0010 表格）；fail-closed 词汇表；selection 包装与 OFFSET 规则；验证命令（telora test uql、check-uql.py）。中文、现状陈述、标题/列表末尾无句末标点

- [ ] **Step 2: 更新 DIALECT-CONTRACT.md / QUERY.md 中 UQL 绑定陈述**

  grep `$1`/`$n`/`UQL` 相关绑定陈述，改为"UQL 为纯位置 `?` 加出现序展开，bindings 不按句柄索引寻址"；其余方言陈述不动

- [ ] **Step 3: 验证文档无遗留失真**

  Run: `grep -rn 'uql' ontology/docs/ -i` 人工核对
  Expected: 无 `$n` 模型残留陈述

- [ ] **Step 4: Commit**

  ```bash
  git add ontology/docs/UQL.md ontology/docs/DIALECT-CONTRACT.md ontology/docs/QUERY.md
  git commit -m "docs(uql): 同步位置参数契约"
  ```

### Task 7: 下游断言适配与全量回归

**Files:**
- Modify: `ontology/tests/result_bound.telora:305-320`
- Modify: `ontology/tests/uql_intent.telora:60-70`

**Interfaces:**
- Consumes: 最终 `uql::build_query`（occurrence bindings）

- [ ] **Step 1: 改 result_bound.telora 断言**

  `dialects_preserve_bindings`（312 行附近）：sqlite==postgres 等价断言保留；uql 改独立断言——`string::split(uql_query.sql, "?")` 计数 - 1 == length(bindings)

- [ ] **Step 2: 改 uql_intent.telora 断言字符串**

  65 行附近：`$1`/`$2` 断言改 `?` 形态；`rendered.bindings == sqlite(...).bindings` 三方言一致断言改为 uql 展开正确性断言（placeholder 计数 == 长度）。注：该文件因 edsl 装饰器迁移（716a4e6）编译失败，本次仅更新断言语义，不修复 API

- [ ] **Step 3: 全量回归**

  Run: `"$TELORA" --with-memory-limit 1024 -C ontology check --lib`；`"$TELORA" --with-memory-limit 1024 -C ontology test uql`；`python3 scripts/check-uql.py --telora "$TELORA"`；`"$TELORA" --with-memory-limit 1024 -C ontology test result_bound`（注意 fuel，失败时加大 `--with-memory-limit`）
  Expected: 库检查 ok；uql 全过；check-uql.py 全过；result_bound 通过（uql_intent 编译失败为 716a4e6 遗留，不阻塞）

- [ ] **Step 4: Commit**

  ```bash
  git add ontology/tests/result_bound.telora ontology/tests/uql_intent.telora
  git commit -m "test(uql): 适配下游方言断言"
  ```
