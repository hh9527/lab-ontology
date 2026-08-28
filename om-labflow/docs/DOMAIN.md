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
| `HostRequestOpenedCount` | count | `id` | 条件指标：只统计 `host_request_opened` 事件（`FILTER (WHERE t.type = ?)`） |
| `HostRequestResolvedCount` | count | `id` | 条件指标：只统计 `host_request_resolved` 事件 |
| `HostRequestNet` | computed `'Sub` | `id` | 计算指标：`HostRequestOpenedCount - HostRequestResolvedCount`（Host 工件净等待） |
| `TaskStartedCount` | count | `id` | 条件指标：只统计 `task_started` 事件（轮数开始） |
| `TaskCompletedCount` | count | `id` | 条件指标：只统计 `task_completed` 事件（轮数完成） |
| `TaskOutstanding` | computed `'Sub` | `id` | 计算指标：`TaskStartedCount - TaskCompletedCount`（尚未配对的轮数净额） |
| `PathCount` | count | `path` | action 关联路径数（grain = path） |

指标的自然 grain：前 16 个为事件（TimelineEvent），`PathCount` 为路径
（ActionPath）。一次请求中的多个指标必须 grain 兼容；grain 冲突原子失败。

条件指标（`HostRequestOpenedCount`/`HostRequestResolvedCount`/
`TaskStartedCount`/`TaskCompletedCount`）的固有 predicate 只通过
`FILTER (WHERE ...)` 收窄自身聚合，与用户全局 filters 各自独立、不合并；
计算指标（`HostRequestNet`/`TaskOutstanding`）以已声明的条件指标为依赖做受限
`'Sub` 组合，并可作为普通 ordering 或 Top Per Group 分区内排序的目标（依赖会
自动进入 projection）。计数（含 FILTER）永不返回 NULL，因此净额总是定义良好。
动态请求只能选择这些已发布的业务 Measure，不能提交 predicate、operand alias
或算术表达式。

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
| `CommandHead` | text | 开放 | eq（计算维度：command 首词；固有 scope 限定 shell action） |
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

### 计算维度：CommandHead（command 首词）

`CommandHead` 是 `command` 的第一个空白分隔片段（例如把
`./bin/telora -C query run main` 投影为 `./bin/telora`）。语义只是“首个空白
分隔片段”，**不是完整 shell lexer**；不做任何归一化，因此 `./bin/telora` 与
`bin/telora` 保持为不同成员，不会被静默合并。

- 分组、排序与 TOP N 全部由一次 OM 查询在服务端完成：请求 `CommandHead` 维度
  即以首词表达式投影并按它分组。禁止用有限结果加客户端手工聚合冒充完整查询。
- `CommandHead` 通过固有 `scope` 限定 `EventType=action`、`Action=shell`，调用者
  无需手工重复这两个约束；scope 谓词先于用户筛选以 `And` 合并，全部动态值保持
  参数化 `Bind`。失败命令由调用者用 `Success=0` 表达。
- scope 与用户筛选互斥时原子失败（例如请求 `CommandHead` 又筛选
  `EventType=thinking`）；与 scope 取值相同的筛选（如 `EventType=action`）不冲突。
- 底层用封闭标量 `Instr`/`If`/`Sub`/`Substr` 组合实现，语义与 SQLite 一致：
  无分隔符、空字符串、NULL 输入都有确定行为。

### 关系

| from | kind | to | 语义 |
| --- | --- | --- | --- |
| `ActionPath` | Safe | `TimelineEvent` | `ap.event_id = t.id`，不扩张 grain |

`'Safe` 只允许从路径 grain 到达事件维度；反向（事件 grain 请求 `Path` 维度）
是 FanOut，知识层直接拒绝。这保证路径统计不会放大事件指标。

## 分页与活数据

### 安全分页（offset）

公共请求支持 `offset` 安全分页：`limit` 截断结果行数，`offset` 跳过前若干行，
二者都是查询语义的一部分，**都不能证明已经覆盖全量数据**。需要遍历完整分组
结果时必须显式翻页（例如每页 `limit=100`，依次 `offset=0/100/200/...`），并使用
稳定、确定的 `ordering`（如 `EventCount desc, CommandHead asc`）保证分页可重复。
`offset` 存在时必须带稳定排序，否则原子失败；`offset` 必须是非负整数。

`truncated` 是 Labflow 1000 行保护层的标记；`truncated=false` 只表示返回行数未
触达保护层，**不能**证明 SQL 自身没有因 `limit` 丢失分组。分页完整性必须逐页
合并结果并验证没有缺口或重叠。

### 固定 cutoff 的多步分析

`timeline` 是活数据：观察者自己的命令、reply、Host 请求等都会形成后续事件。
多步分析必须先固定一个 cutoff（毫秒 epoch），并为每一步请求都加入
`AtTime <= cutoff` 筛选，保证各步看到的是同一时间快照；否则后续步骤会把分析
过程中新产生的事件也纳入统计，结果不可复现。样例见
`tests/requests/failed-command-heads.json`。

### Top Per Group（partition）

公共请求支持 `partition`：对已按维度聚合的结果按 `by` 中的维度分区，在每个分区
内部按稳定 `ordering` 排序并保留前 `take` 行。例如“每个角色各自最常失败的 3 个
CommandHead”：

```json
{
  "measures": [{"id": "EventCount", "input": "all"}],
  "dimensions": [{"id": "CommandHead"}, {"id": "Role"}],
  "filters": [
    {"id": "Success", "op": "eq", "value": 0},
    {"id": "AtTime", "op": "le", "value": 1750000000000}
  ],
  "ordering": [
    {"target": {"kind": "measure", "id": "EventCount"}, "direction": "desc"},
    {"target": {"kind": "dimension", "id": "CommandHead"}, "direction": "asc"}
  ],
  "limit": null,
  "partition": {"by": ["Role"], "take": 3}
}
```

- partition 维度必须已选择且 grain 兼容；ordering 必须稳定（覆盖所有非 partition
  维度作为 tie-breaker）；`take` 必须是正上限内的正整数；v1 不与全局 `limit`/
  `offset` 组合，违反任一约束都原子失败。
- 全局 `limit` 与每分区 `take` 是不同语义：`limit` 截断全局结果，`take` 是每个
  分区各自的前 N 行；不足 N 行的分区返回其全部行。
- lowering 由 QueryBuilder 的公共 `partition` 能力完成（内部单 `row_number()`
  子查询），不拼接私有 SQL。样例见
  `tests/requests/per-role-failed-command-heads.json`。

## 能力边界（当前无法表达）

以下语义在 v1 中**不能**被单一 Query 表达。它们不会用不安全 SQL、字符串拼接或
虚假业务定义绕过；需要时应在 Labflow 侧显式建模或等待底层能力。

1. **一轮任务的耗时区间**。一轮 = 配对 `task_started` 与同一 `attempt_id` 的
   `task_completed`，耗时 = `task_completed.at - task_started.at`。当前
   QueryBuilder 没有列间算术、没有 self-join + 类型筛选条件、也无法从
   `payload_json` 提取 `attempt_id`，因此不能表达配对区间。可表达的是事件的
   独立时长聚合（`DurationSum`/`DurationAvg`/`DurationMax`）。
2. **逐 attempt 的完成状态 / 控制面状态**。`TaskOutstanding =
   TaskStartedCount - TaskCompletedCount` 现在可以按维度给出轮数净额；但逐
   `attempt_id` 的“当前是否完成”仍需要从 `payload_json` 提取 `attempt_id` 或
   读取 `states.state` / `states.task_records`（状态库以 schema 名 `states`
   ATTACH，QueryBuilder 的标识符不允许 `.`，无法引用 `states.*` 表），因此仍
   不可表达。
3. **JSON 字段**。`payload_json`（`attempt_id`、`status`、`backend_id` 等）不暴露
   为维度；当前 QueryBuilder 无 JSON 函数。
4. **聚合算术边界**。领域声明的条件指标（`FILTER (WHERE ...)`）与受限计算指标
   （`'Add`/`'Sub` 组合已声明聚合）现在可用，例如 `HostRequestNet =
   HostRequestOpenedCount - HostRequestResolvedCount`、`input_tokens +
   output_tokens + reasoning_tokens`（行级 `'Add` 计算维度）。仍不可表达：除法、
   任意条件聚合表达式、聚合内 ordering、非计数聚合间算术的 NULL 自动
   `coalesce`，以及聚合/过滤谓词中引用另一聚合。
5. **Bool 筛选**。`FilterInput` 只有 Text/Number/Int；`success` 用 `0`/`1` 表达。
6. **时间维度的人性化单位**。`at` 是毫秒 epoch Int；没有日期函数，不能按
   小时/天/周分组。`AtTime` 的筛选值是毫秒整数。

### 未来所需的底层能力

`json_extract`/JSON 函数、schema 限定表名、日期时间函数与区间（self-join 或
窗口）、聚合算术的进一步扩展（除法、任意表达式、NULL 自动 coalesce）。行级
列间算术（`Add`/`Sub`）、首词计算维度（`Instr`/`If`/`Substr`）、条件指标
（FILTER）与计算指标（`'Add`/`'Sub`）以及 Top Per Group 已在 v1 中可用。

## 安全与公共边界

- 所有动态值只能进入 Query bindings，不拼接到 SQL。
- 公共请求使用业务词汇，不让调用者提交表名、列名、alias、join、SQL 片段或
  任意表达式。
- grain 不兼容、关系会放大统计、未知词汇、非法筛选或当前能力无法表达时，
  原子失败，不返回看似可信的部分 Query。
- 保持只读分析边界；本资产不直接读取、修改或管理 Labflow 数据库。
- 私有物理 mapping 与公共查询面分离，且来自同一个 prepared knowledge root。
