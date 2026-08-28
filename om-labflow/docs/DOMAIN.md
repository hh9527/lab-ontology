# OM-Labflow 领域说明与能力边界

本资产是面向 Labflow 运行数据（`events.sqlite` Timeline schema version 2）的
EnterpriseKnowledge。它把领域业务词汇确定性地降低为参数化 SQLite `Query`，供
只读分析链路消费。最终调用形式由 Labflow 侧约定：

```bash
labflow query-om file.json
labflow query-om -            # 从 stdin 读取 JSON
```

Labflow 在内部调用：

```bash
"$TELORA_BIN" -C "$OM_LABFLOW_PATH" run query --source input=file.json
"$TELORA_BIN" -C "$OM_LABFLOW_PATH" run query --source input=stdin+json://
```

本资产只负责 `om-labflow` 领域资产；它不读取、修改或管理 Labflow 数据库，也
不接通最终执行链路。

## 架构分层

```text
src/model.telora      私有物理模型：实体、指标、维度、封闭值域、关系
                      （列名、alias、join 全部封装在这里，不对外）
src/knowledge.telora  一次性准备 PreparedPayload：profile、authorize、路径矩阵
src/query.telora      公共 typed/dynamic query facade（规范实现）
src/facade.telora     facade 的兼容性 re-export
src/bin/query.telora  稳定入口：input Value source -> Query JSON
src/bin/main.telora   typed 路径演示
src/bin/verify.telora 严格验证（确定性/SQL 形状/绑定顺序/codec/JSON 边界）
src/bin/invalid.telora 关键非法场景演示（原子失败语义）
src/bin/probe.telora  知识目录：列出公共业务词汇（知识发现）
tests/query.telora    契约测试（check @test/query）
```

依赖：`query`（QueryBuilder）与 `ontology`（EnterpriseKnowledge eDSL）。物理
mapping 与公共查询面分离，且来自同一个 prepared knowledge root。

## 业务词汇（v1）

以下 id 是调用者可以使用的封闭词汇。`run probe` 会输出机器可读目录。

### 实体

| 实体 | 表 | alias | 说明 |
| --- | --- | --- | --- |
| TimelineEvent | `timeline` | `t` | 每行一个 Timeline 事件 |
| ActionPath | `action_paths` | `ap` | 一个 action 事件的关联文件路径（一对多） |

### 指标（Measure）

| id | 聚合 | 物理列 | 语义 |
| --- | --- | --- | --- |
| `EventCount` | count | `id` | 事件数；`input: distinct` 时为 `count(DISTINCT id)` |
| `DurationSum` | sum | `duration` | 事件耗时合计（毫秒） |
| `DurationAvg` | avg | `duration` | 事件平均耗时 |
| `DurationMax` | max | `duration` | 最长事件耗时（配合 `EventType=thinking` 即最长思考时间） |
| `AtMax` | max | `at` | 最近一次事件时间（毫秒 epoch） |
| `TokenSum` | sum | `tokens` | 通用 tokens 合计（thinking span 的 reasoning token） |
| `InputTokenSum` | sum | `input_tokens` | reply 的 input tokens 合计 |
| `OutputTokenSum` | sum | `output_tokens` | reply 的 output tokens 合计 |
| `ReasoningTokenSum` | sum | `reasoning_tokens` | reply 的 reasoning tokens 合计 |
| `CacheReadTokenSum` | sum | `cache_read_tokens` | cache read tokens 合计 |
| `CacheWriteTokenSum` | sum | `cache_write_tokens` | cache write tokens 合计 |
| `PathCount` | count | `path` | action 关联路径数（grain = path） |

指标的自然 grain：前 11 个为事件（TimelineEvent），`PathCount` 为路径
（ActionPath）。一次请求中的多个指标必须 grain 兼容；grain 冲突原子失败。

### 维度（Dimension）

| id | 类型 | 值域 | 筛选能力 |
| --- | --- | --- | --- |
| `EventType` | enum | 封闭值域（schema v2 全部 14 个 type） | eq |
| `Role` | text | 开放 | eq |
| `Session` | text | 开放 | eq |
| `Turn` | text | 开放 | eq |
| `TaskId` | text | 开放 | eq |
| `TaskKind` | enum | `artifact`, `problem` | eq（封闭值域） |
| `Artifact` | text | 开放 | eq |
| `DagRevision` | text | 开放 | eq |
| `Execution` | text | 开放 | eq |
| `Action` | text | 开放 | eq（工具类别） |
| `Command` | text | 开放 | eq（只对 shell action 有业务意义） |
| `Success` | int | 0/1 | eq |
| `ExitCode` | int | 开放 | eq |
| `AtTime` | int | 开放 | ge, le（毫秒 epoch） |
| `Duration` | int | 开放 | eq, ge, le |
| `Path` | text | 开放 | eq（ActionPath 维度） |

所有维度 v1 均 `authorized` 且 `filterable`。授权主体由 `authorize` 决定
（v1 固定接受 `analyst`）。dynamic 入口（`run query`）在内部固定 subject 为
`analyst`，公共 JSON 不接受也不要求 `subject` key，显式提交的 `subject` 会被
当作未知 key 拒绝；typed 入口保留 `QueryRequest.subject` 并经过同一 authorize
检查。

### 封闭值域：事件类型（EventType）

`EventType` 覆盖 Timeline schema version 2 的全部合法 `type`。值域外的字符串
（例如 `not_a_real_event`）原子失败，不生成 SQL：

| 稳定值 | 含义 |
| --- | --- |
| `thinking` | 一次 assistant message 中未被 tool action 占用的时间段 |
| `action` | 一次已结束的 tool 调用 |
| `reply` | assistant 的文本回复 |
| `session_started` / `session_ended` | 会话开始/结束 |
| `turn_started` / `turn_ended` | assistant message 边界（turn 是 message id） |
| `task_started` / `task_completed` | 任务开始/完成 |
| `artifact_refreshed` / `artifact_deleted` | Host 工件 marker 被刷新/删除 |
| `host_request_opened` / `host_request_resolved` | Host 工件进入/离开等待集合 |
| `dag_revised` | 新的 DAG revision 被 Supervisor 应用 |

`Command` 只对 shell action 有业务意义：实际数据中 shell action 的 `command`
均非空，而 read/edit/glob/write 等 action 的 `command` 为空。因此按 command
分析时应同时过滤 `EventType=action` 与 `Action=shell`，避免把非 shell action
的空 command 行纳入统计。

### 关系

| from | kind | to | 语义 |
| --- | --- | --- | --- |
| `ActionPath` | Safe | `TimelineEvent` | `ap.event_id = t.id`，不扩张 grain |

`'Safe` 只允许从路径 grain 到达事件维度；反向（事件 grain 请求 `Path` 维度）
是 FanOut，知识层直接拒绝。这保证路径统计不会放大事件指标。

## 能力边界（当前无法表达）

以下语义在 v1 中**不能**被单一 Query 表达。它们不会用不安全 SQL、字符串拼接或
虚假业务定义绕过；需要时应在 Labflow 侧显式建模或等待底层能力。

1. **一轮任务的耗时区间**。一轮 = 配对 `task_started` 与同一 `attempt_id` 的
   `task_completed`，耗时 = `task_completed.at - task_started.at`。当前
   QueryBuilder 没有列间算术、没有 self-join + 类型筛选条件、也无法从
   `payload_json` 提取 `attempt_id`，因此不能表达配对区间。可表达的是事件的
   独立时长聚合（`DurationSum`/`DurationAvg`/`DurationMax`）。
2. **当前是否完成 / 当前等待集合**。需要比较 `task_started` 与 `task_completed`
   的计数差，或读取 `states.state` / `states.task_records`。状态库以 schema 名
   `states` ATTACH，而 QueryBuilder 的标识符不允许 `.`（`is_sql_identifier`），
   无法引用 `states.*` 表。
3. **host 请求的 open/resolved 净额**。`host_request_opened - host_request_resolved`
   是聚合间差，QueryBuilder 无聚合算术；可表达的是两侧各自计数与最近时间。
4. **JSON 字段**。`payload_json`（`attempt_id`、`status`、`backend_id` 等）不暴露
   为维度；当前 QueryBuilder 无 JSON 函数。
5. **列间算术与条件聚合**。`input_tokens + output_tokens + reasoning_tokens` 不能
   合成单列；`FILTER`/`CASE` 条件聚合不存在。
6. **Bool 筛选**。`FilterInput` 只有 Text/Number/Int；`success` 用 `0`/`1` 表达。
7. **时间维度的人性化单位**。`at` 是毫秒 epoch Int；没有日期函数，不能按
   小时/天/周分组。`AtTime` 的筛选值是毫秒整数。

### 未来所需的底层能力

列间算术、`json_extract`/JSON 函数、schema 限定表名、条件聚合（FILTER/CASE）、
日期时间函数与区间（self-join 或窗口）支持。

## 安全与公共边界

- 所有动态值只能进入 Query bindings，不拼接到 SQL。
- 公共请求使用业务词汇，不让调用者提交表名、列名、alias、join、SQL 片段或
  任意表达式。
- grain 不兼容、关系会放大统计、未知词汇、非法筛选或当前能力无法表达时，
  原子失败，不返回看似可信的部分 Query。
- 保持只读分析边界；本资产不直接读取、修改或管理 Labflow 数据库。
- 私有物理 mapping 与公共查询面分离，且来自同一个 prepared knowledge root。
