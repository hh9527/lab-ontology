# OM-Labflow 公共查询设计指南

本文档面向调用 `labflow query-om` 的观察者与 Labflow 集成方，说明如何用业务
词汇构造领域查询请求，以及输出 Query 的语义。领域词汇与能力边界见
`docs/DOMAIN.md`。

## 动态请求 JSON 契约

`run query` 的 `input` source 是完整 JSON 对象。业务词汇位于 `id` 字段；调用者
不得提交表名、列名、alias、join、SQL 片段或任意表达式。

```json
{
  "measures": [
    {"id": "EventCount", "input": "all"},
    {"id": "DurationSum", "input": "all"}
  ],
  "dimensions": [{"id": "Role"}],
  "filters": [
    {"id": "EventType", "op": "eq", "value": "task_started"},
    {"id": "AtTime", "op": "ge", "value": 1750000000000}
  ],
  "ordering": [
    {"target": {"kind": "measure", "id": "EventCount"}, "direction": "desc"},
    {"target": {"kind": "dimension", "id": "Role"}, "direction": "asc"}
  ],
  "limit": 10
}
```

- 授权主体固定为 `analyst`：请求**不能也不应**包含 `subject` key。显式提供
  `subject` 属于未知顶层 key，整体拒绝。
- `measures[].input`：可选，`all`（默认）或 `distinct`。
- `filters[].op`：`eq` / `ge` / `le`；`value` 为 String、Int 或 Float。Bool 不
  是合法筛选值（`Success` 使用 `0`/`1`）。
- `filters[].value`：枚举维度必须是其封闭值域内的稳定值。`EventType` 是封闭
  业务词汇，只接受 schema v2 的全部 14 个 `type`；`TaskKind` 只接受
  `artifact`/`problem`。值域外的字符串原子失败。
- `ordering[].target`：`{"kind": "measure"|"dimension", "id": ...}`；排序目标
  必须已在请求中选择。分页（`offset`）必须搭配稳定、确定的 `ordering`。
- `limit`：可选正整数或 `null`。
- `offset`：可选非负整数（安全分页）。`limit` 与 `offset` 都是查询语义，**都不
  能证明已覆盖全量**；需要遍历完整分组结果时必须显式翻页。
- `partition`：可选 Top Per Group，形状为 `{"by": [维度 id...], "take": 正整数}`。
  `by` 中的维度必须已在 `dimensions` 中选择，`take` 是每分区保留的前 N 行；v1
  不与全局 `limit`/`offset` 组合。
- 未知 key（包括显式 `subject`）、未知 id、非法 op/input、非法值类型、非正
  limit、负 offset、缺稳定排序的 offset、非法 partition 组合都原子失败。
- 动态值只进入 `bindings`，绝不拼接进 SQL。

输出是唯一 JSON 对象（无额外包装）：

```json
{"sql": "SELECT ... WHERE ... = ?", "bindings": ["task_started", 10]}
```

## 查询设计指南

| 业务问题 | 写法 |
| --- | --- |
| 某个角色经历了多少轮（task_started 数） | measure `EventCount`，dimension `Role`，filter `EventType=task_started` |
| 某个任务经历多少轮 | measure `EventCount`，dimension `TaskId`，filter `EventType=task_started` |
| 最近一次 Host 请求解析时间 | measure `AtMax`，filter `EventType=host_request_resolved` |
| 最长思考时间（按角色） | measure `DurationMax`，dimension `Role`，filter `EventType=thinking` |
| 成功/失败 shell action 的耗时与次数 | measure `EventCount`+`DurationSum`，dimension `Command`，filter `EventType=action` + `Action=shell`（可加 `Success=0/1`） |
| 失败 shell action 首词 Top N | measure `EventCount`，dimension `CommandHead`，filter `Success=0`（scope 自动限定 action+shell），ordering `EventCount desc, CommandHead asc` |
| 每个角色各自最常失败的 3 个 CommandHead | measure `EventCount`，dimensions `CommandHead`+`Role`，filter `Success=0`，ordering `EventCount desc, CommandHead asc`，`partition: {"by": ["Role"], "take": 3}` |
| Host 等待净额（open − resolved） | measures `HostRequestOpenedCount`+`HostRequestResolvedCount`+`HostRequestNet`，dimension `Artifact` |
| 每个角色各自的任务轮数 Started/Completed/Outstanding | measures `TaskStartedCount`+`TaskCompletedCount`+`TaskOutstanding`，dimension `Role`，ordering `TaskOutstanding desc` |
| 每个角色各自 Outstanding 最多的任务 TOP 5 | measure `TaskOutstanding`，dimensions `Role`+`TaskId`，ordering `TaskOutstanding desc, TaskId asc`，`partition: {"by": ["Role"], "take": 5}` |
| 最常关联的路径 Top N | measure `PathCount`，dimension `Path`，ordering `PathCount desc` |
| 按角色统计关联路径数（join） | measure `PathCount`，dimension `Role`（经 Safe join 到 timeline） |
| 一轮 reply token | measure `InputTokenSum`/`OutputTokenSum`/`ReasoningTokenSum`，filter `EventType=reply`；合计 = 三者之和 |
| 按时间范围筛选 | dimension `AtTime`，filter `AtTime ge/le <毫秒 epoch>` |

重复 lowering 逐字节稳定：同一个合法请求总是产生完全相同的 SQL 与 bindings。

## CommandHead 首词分析

`CommandHead` 是 `command` 的第一个空白分隔片段，语义**不是**完整 shell lexer，
也不做归一化：`./bin/telora` 与 `bin/telora` 保持为不同成员，不会被合并。分组、
排序与 TOP N 全部在服务端由一次 OM 查询完成；不要用有限结果加客户端手工聚合
冒充完整查询。

`CommandHead` 自带固有 scope（`EventType=action`、`Action=shell`），请求它时无需
（也不应）手工重复这两个筛选；失败命令用 `Success=0` 表达。scope 与用户筛选
互斥（例如同时筛选 `EventType=thinking`）时原子失败。

```json
{
  "measures": [{"id": "EventCount", "input": "all"}],
  "dimensions": [{"id": "CommandHead"}],
  "filters": [
    {"id": "Success", "op": "eq", "value": 0},
    {"id": "AtTime", "op": "le", "value": 1750000000000}
  ],
  "ordering": [
    {"target": {"kind": "measure", "id": "EventCount"}, "direction": "desc"},
    {"target": {"kind": "dimension", "id": "CommandHead"}, "direction": "asc"}
  ],
  "limit": 3
}
```

样例：`tests/requests/failed-command-heads.json`（第 1 页）与
`tests/requests/command-heads-page-2.json`（`offset: 3`）。

## Top Per Group 与条件/计算指标

### Top Per Group（每分区 Top N）

`partition` 回答“每个角色各自最常失败的 3 个 CommandHead”这类问题。对已聚合结果
按 `by` 维度分区，每个分区内按稳定 `ordering` 保留前 `take` 行。样例见
`tests/requests/per-role-failed-command-heads.json`：

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

`partition` 与全局 `limit` 语义不同：`limit` 截断全局结果，`take` 是每个分区各自
的前 N 行；不足 N 行的分区返回其全部行。v1 的 `partition` 不与全局 `limit`/
`offset` 组合。

### 任务轮数净额（条件计数 + 计算指标）

`TaskStartedCount`/`TaskCompletedCount` 是领域声明的条件指标，`TaskOutstanding =
TaskStartedCount - TaskCompletedCount` 是计算指标。全局 `AtTime <= cutoff` 只进入
全局 WHERE；`task_started`/`task_completed` 两个条件只留在各自聚合的
`FILTER (WHERE ...)`，不会展平成互斥的全局 AND。`TaskOutstanding` 可作为普通
ordering 或 Top Per Group 分区内排序目标。样例见
`tests/requests/task-outstanding-by-role.json` 与
`tests/requests/task-outstanding-top5-by-role.json`。

### 条件指标与计算指标

条件指标（`HostRequestOpenedCount`/`HostRequestResolvedCount`）带领域声明的固有
predicate，只通过 `FILTER (WHERE ...)` 收窄自身聚合，不与用户全局 filters 合并。
计算指标（`HostRequestNet = HostRequestOpenedCount - HostRequestResolvedCount`）以
已声明指标为依赖做受限 `'Sub` 组合，可直接作为普通排序目标。样例见
`tests/requests/host-request-net.json`：

```json
{
  "measures": [
    {"id": "HostRequestOpenedCount", "input": "all"},
    {"id": "HostRequestResolvedCount", "input": "all"},
    {"id": "HostRequestNet", "input": "all"}
  ],
  "dimensions": [{"id": "Artifact"}],
  "filters": [{"id": "AtTime", "op": "le", "value": 1750000000000}],
  "ordering": [],
  "limit": null
}
```

## 分页、truncated 与固定 cutoff

### 安全分页

用 `limit` + `offset` 显式翻页遍历完整分组结果，并搭配稳定 `ordering`
（例如 `EventCount desc, CommandHead asc`）保证分页确定可重复。`offset` 存在时
必须带稳定排序；`offset` 必须是非负整数；负 offset 或缺排序的 offset 原子失败。

### `truncated` 与 `limit` 的区分

`truncated` 是 Labflow 1000 行保护层的标记，不属于 Query JSON。`truncated=false`
只表示返回行数未触达保护层，**不能**证明 SQL 自身没有因 `limit` 丢失分组。
要确认已覆盖全量分组，必须逐页合并结果并核对没有缺口或重叠。

### 固定 cutoff 的多步查询

`timeline` 是活数据，观察者自身的命令、reply、Host 请求也会形成后续事件。多步
分析先固定一个 cutoff（毫秒 epoch），并为每一步都加 `AtTime <= cutoff`，保证各
步看到同一时间快照。例如上文的失败首词 TOP N 与按 role 的失败首词统计都应携带
同一个 `AtTime <= cutoff` 筛选。

## 失败语义

以下情况原子失败，不发布部分 Query：

- grain 不兼容（事件 grain 指标与路径 grain 指标/维度混用）；
- 关系会放大统计（事件 grain 请求 `Path` 维度，FanOut-only）；
- 未知词汇（未知指标 id、未知维度 id、未知顶层 key，包括显式 `subject`）；
- 非法筛选（封闭值域外的枚举值，如 `EventType=not_a_real_event`、Bool 值、
  未知 op、非法值类型）；
- 非正 limit；
- 负 offset / offset 缺稳定排序；
- `CommandHead` 固有 scope 与用户筛选互斥（如同时筛选 `EventType=thinking`）；
- Top Per Group 非法组合：partition 维度未选择、非稳定 partition 排序、非正或
  超上限的 `take`、partition 与全局 `limit`/`offset` 组合；
- 未授权 subject（仅 typed 入口可触发：dynamic 入口固定为 `analyst`）；
- 排序目标未在请求中选择。

演示：`bin/telora -C om-labflow run invalid --best-effort`。

## 验证命令

在仓库根目录运行（或任意子目录，`-C om-labflow` 指定 crate）：

```bash
./bin/telora -C om-labflow run main
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/rounds-per-role.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/action-duration-by-command.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/host-latest-resolved.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/top-paths.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/failed-command-heads.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/command-heads-page-2.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/per-role-failed-command-heads.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/host-request-net.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/task-outstanding-by-role.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/task-outstanding-top5-by-role.json
./bin/telora -C om-labflow run query --source input=stdin+json:// < om-labflow/tests/requests/task-outstanding-by-role.json
./bin/telora -C om-labflow run probe
./bin/telora -C om-labflow run verify
./bin/telora -C om-labflow run invalid --best-effort
./bin/telora -C om-labflow check @test/query
./bin/telora -C om-labflow check @src/model
./bin/telora -C om-labflow check @src/knowledge
./bin/telora -C om-labflow check @src/query
./bin/telora -C om-labflow query exports @bin/query
```

- `verify` 覆盖确定性、SQL 形状、绑定顺序、筛选/分组/Top N、Distinct、join
  grain 保持、codec round-trip、dynamic JSON 边界（固定 subject / EventType
  封闭值域）、CommandHead 首词分组与固有 scope、offset 分页、固定 cutoff 的
  多步查询、Host/Task 净额（filtered + computed measures）、Top Per Group
  （row_number 子查询与绑定顺序）以及 Outstanding 参与分区内排序，并含动态
  路径端到端。
- `invalid --best-effort` 演示上述失败语义（非零退出、无 output），包括
  `EventType=not_a_real_event`、显式 `subject`、负 offset、offset 缺排序、
  `CommandHead` scope 冲突、Top Per Group 非法组合（与 limit 组合、非正 take、
  partition 维度未选择）。
- `check @test/query` 是契约测试：成功路径的确定性断言，含 EventType 全部合法
  值、shell action 绑定顺序、缺少 subject 成功与显式 subject 拒绝、CommandHead
  TOP N、分页完整性（`LIMIT ? OFFSET ?` 与绑定收尾）、固定 cutoff 多步查询、
  Host/Task 净额与 Top Per Group 的精确 SQL/bindings。
- Host 验收 fixtures：`per-role-failed-command-heads.json`（每个 Role 各自失败
  CommandHead TOP 3，`partition: {"by": ["Role"], "take": 3}`）与
  `task-outstanding-by-role.json`（按 Role 的 Started/Completed/Outstanding），
  两者都带固定 cutoff `AtTime <= 1750000000000`；文件输入与 stdin (`-`) 生成
  相同的 `sql`/`bindings`。Host 可用 `labflow query-om --explain` 核对后，对同一
  `events.sqlite`、同一 cutoff 执行物理 SQL 对照。
- `query-om` 只捕获 stdout 作为参数化 Query，并检查进程退出状态；stderr 直接
  继承调用终端，使 diagnostics 透明输出。stdin 入口
  `--source input=stdin+json://` 继承调用进程的 stdin，供 `labflow query-om -`
  使用。
